/**
 * barclays-parser.js — Parser for Barclays ESOP / SVP Statements (PDF)
 */
(function (global) {
  'use strict';

  async function parseFile(file, password = '') {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
        return parsePDF(file, password);
    } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
        return parseExcel(file);
    }
    throw new Error('Unsupported file format');
  }

  async function parseExcel(file) {
    const data = await file.arrayBuffer();
    const workbook = (global.XLSX || XLSX).read(new Uint8Array(data), { type: 'array', cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = (global.XLSX || XLSX).utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });

    const result = { grants: [], _rawRows: rows };

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 50); i++) {
        if (!Array.isArray(rows[i])) continue;
        const rowStr = rows[i].filter(x => x != null).join(' ').toLowerCase();
        if (rowStr.includes('allocation date') || rowStr.includes('grant date') || rowStr.includes('shares awarded')) {
            headerIdx = i;
            break;
        }
    }

    if (headerIdx === -1) headerIdx = 0; // Fallback to first row

    if (!global.XLSX) throw new Error('XLSX library not loaded. Please check your internet connection.');

    const headers = rows[headerIdx].map(h => String(h || '').toLowerCase().trim());
    const colMap = {
        date:   headers.findIndex(h => h.includes('allocation date') || h.includes('award date') || h.includes('grant date') || h.includes('date')),
        qty:    headers.findIndex(h => h.includes('allocation quantity') || h.includes('outstanding quantity') || h.includes('shares awarded') || h.includes('qty') || h.includes('quantity')),
        strike: headers.findIndex(h => h.includes('strike price') || h.includes('cost basis') || h.includes('grant price') || h.includes('strike') || h.includes('price')),
        vesting: headers.findIndex(h => h.includes('vesting date') || h.includes('vesting')),
        plan:   headers.findIndex(h => h.includes('plan'))
    };

    // Strict Fallbacks based on common Barclays layout
    if (colMap.date === -1) colMap.date = 0;
    if (colMap.qty  === -1) colMap.qty  = 12; 
    if (colMap.strike === -1) colMap.strike = 6;
    if (colMap.vesting === -1) colMap.vesting = 9;
    if (colMap.plan === -1) colMap.plan = 2;

    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length < 2) continue;

        const dateVal = row[colMap.date];
        const qtyVal  = row[colMap.qty];
        if (!dateVal || !qtyVal) continue;

        let status = 'Vested';
        if (colMap.vesting !== -1) {
            const vDateRaw = row[colMap.vesting];
            if (vDateRaw) {
                const vDate = new Date(vDateRaw);
                if (vDate && vDate > new Date()) status = 'Unvested';
            }
        }

        const planName = colMap.plan !== -1 ? String(row[colMap.plan] || '') : '';

        const cleanNum = (val) => {
            if (val == null) return 0;
            const s = String(val).replace(/[^\d.]/g, '');
            return parseFloat(s) || 0;
        };

        result.grants.push({
            date: String(dateVal),
            qty: cleanNum(qtyVal),
            strike: colMap.strike !== -1 ? cleanNum(row[colMap.strike]) : 0,
            status: status,
            plan: planName
        });
    }

    return result;
  }

  async function parsePDF(file, password = '') {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = global.pdfjsLib.getDocument({
      data: arrayBuffer,
      password: password,
      enableXfa: true
    });

    const pdf = await loadingTask.promise;
    let allLines = [];

    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({ scale: 1.0 });
        
        const lines = textContent.items.map(item => ({
            text: item.str,
            x: item.transform[4],
            y: viewport.height - item.transform[5],
            w: item.width,
            h: item.height
        }));

        // Group into lines by y-coordinate
        const threshold = 5;
        const grouped = [];
        lines.sort((a,b) => a.y - b.y || a.x - b.x).forEach(item => {
            const last = grouped[grouped.length-1];
            if (last && Math.abs(item.y - last.y) < threshold) {
                last.text += ' ' + item.text;
                last.items.push(item);
            } else {
                grouped.push({ y: item.y, text: item.text, items: [item] });
            }
        });
        allLines.push(...grouped);
    }

    return extractData(allLines);
  }

  function extractData(lines) {
    const result = {
      grants: [],
      _rawLines: lines.map(l => l.text)
    };

    let inTable = false;

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text.trim();

      // Look for table headers
      if (/\bAward\s+Date\b|\bGrant\s+Date\b|\bGrant\s+Price\b|\bShares\s+Awarded\b/i.test(tl)) {
        inTable = true;
        continue;
      }

      if (inTable) {
        // Stop if we hit a signature or total
        if (/Regards|Total|Yours\s+sincerely/i.test(tl) && tl.length < 50) {
            // But sometimes there are multiple tables. We'll stay inTable unless it's clearly the end.
        }

        // Try to find a grant row
        // Format common: [Date] [Description] [Shares] [Price] [Status]
        // Example: 01/03/2021 Barclays SVP 2021 500 1.85 Vested
        const dateM = tl.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
        if (dateM) {
            const dateStr = dateM[1];
            const nums = tl.match(/[\d,]+\.?\d*/g) || [];
            // Remove the date from nums if it was caught
            const filteredNums = nums.filter(n => !dateStr.includes(n));
            
            if (filteredNums.length >= 1) {
                const qty = parseFloat(filteredNums[0].replace(/,/g, ''));
                const strike = filteredNums.length >= 2 ? parseFloat(filteredNums[1].replace(/,/g, '')) : 0;
                const status = /Vested|Holding|Released/i.test(tl) ? 'Vested' : 'Unvested';

                result.grants.push({
                    date: dateStr,
                    qty: qty,
                    strike: strike,
                    status: status
                });
            }
        }
      }
    }

    return result;
  }

  global.BarclaysParser = { parseFile, parsePDF, parseExcel };
})(window);
