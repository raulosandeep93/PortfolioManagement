/**
 * epf-parser.js — EPFO Passbook PDF parser
 * Strategy: Extract textual lines -> detect headers -> extract contributions and summary.
 * Exposes: window.EPFParser
 */
(function (global) {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ══════════════════════════════════════════════ HELPERS */
  function cleanNum(s) {
    s = String(s || '').trim().replace(/,/g, '');
    const neg = s.startsWith('(') || s.startsWith('-');
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }

  function isNumTok(s) {
    s = String(s).trim();
    return /^[-\(]?[\d,]+\.?\d*\)?$/.test(s);
  }

  /* ══════════════════════════════════════ EXTRACT PDF LINES */
  async function extractLines(pdf) {
    const allItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp   = page.getViewport({ scale: 1.0 });
      const ct   = await page.getTextContent({ normalizeWhitespace: true });
      for (const item of ct.items) {
        const str = (item.str || '').replace(/\s+/g, ' ').trim();
        if (!str) continue;
        allItems.push({ str, x: item.transform[4], y: vp.height - item.transform[5], page: p, w: Math.max(item.width || 0, 1) });
      }
    }
    allItems.sort((a, b) => a.page !== b.page ? a.page - b.page : Math.abs(a.y - b.y) > 6 ? a.y - b.y : a.x - b.x);
    const lines = [];
    for (const item of allItems) {
      const last = lines[lines.length - 1];
      if (last && last.page === item.page && Math.abs(last.y - item.y) <= 6) last.items.push(item);
      else lines.push({ y: item.y, page: item.page, items: [item] });
    }
    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let text = '';
      for (let i = 0; i < line.items.length; i++) {
        if (i > 0) { const gap = line.items[i].x - (line.items[i-1].x + line.items[i-1].w); text += gap >= 18 ? '  ' : ' '; }
        text += line.items[i].str;
      }
      line.text = text.trim();
    }
    return lines.filter(l => l.text.length > 0);
  }

  /* ══════════════════════════════════ BUILD EMPTY RESULT */
  function emptyResult() {
    return { type: 'EPF', investor: {}, establishment: {}, accounts: [], summary: { employeeShare: 0, employerShare: 0, pensionShare: 0, total: 0 } };
  }

  /* ════════════════════════════════════════════ MAIN PARSER */
  function parseLines(lines) {
    const log = (...a) => console.log('[EPFParser]', ...a);
    const result = emptyResult();
    
    let inTable = false;
    let tableHeadersFound = false;

    log(`First 50 lines:\n` + lines.slice(0, 50).map((l, i) => `${i}: ${l.text}`).join('\n'));

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text.trim();
      if (!tl) continue;

      // ── Investor Meta ──
      if (!result.investor.name) {
        const nm = tl.match(/(?:Member\s*Name|Name(?:\s*of\s*the\s*Member)?)\s*[:\-]\s*(.+)/i);
        if (nm) result.investor.name = nm[1].trim();
      }
      if (!result.investor.uan) {
        const um = tl.match(/UAN\s*[:\-]\s*(\d{12})/i);
        if (um) result.investor.uan = um[1];
      }
      if (!result.investor.memberId) {
        const mi = tl.match(/(?:Member\s*ID|Member\s*Id|MID)\s*[:\-]\s*([A-Z0-9\/]{10,})/i);
        if (mi) result.investor.memberId = mi[1].trim();
      }

      // ── Establishment Meta ──
      if (!result.establishment.name) {
        const em = tl.match(/(?:Establishment\s*Name|Employer\s*Name)\s*[:\-]\s*(.+)/i);
        if (em) {
            result.establishment.name = em[1].trim();
        } else if (/ESTABLISHMENT\s*NAME\s*$/i.test(tl)) {
            // Some PDFs have "Establishment Name" on line i and value on line i+1
            const next = lines[i+1]?.text.trim();
            if (next && !next.includes(':')) result.establishment.name = next;
        }
      }

      // ── Balances Detection (More robust patterns) ──
      // Pattern 1: Table format "Total   123,456   45,678   78,901"
      if (/Total\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/.test(tl)) {
          const m = tl.match(/Total\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)/);
          result.summary.employeeShare = cleanNum(m[1]);
          result.summary.employerShare = cleanNum(m[2]);
          result.summary.pensionShare = cleanNum(m[3]);
          log('Found total via pattern 1:', tl);
      }

      // Pattern 2: Explicit labels
      const eeMatch = tl.match(/(?:Employee\s*Share|EE\s*Contribution|Contribution\s*\(Employee\))\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (eeMatch) { result.summary.employeeShare = cleanNum(eeMatch[1]); log('Found EE via pattern 2:', eeMatch[1]); }
      
      const erMatch = tl.match(/(?:Employer\s*Share|ER\s*Contribution|Contribution\s*\(Employer\))\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (erMatch) { result.summary.employerShare = cleanNum(erMatch[1]); log('Found ER via pattern 2:', erMatch[1]); }

      const penMatch = tl.match(/(?:Pension\s*(?:Share|Fund|Contribution)|Fund\s*Pension)\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (penMatch) { result.summary.pensionShare = cleanNum(penMatch[1]); log('Found Pension via pattern 2:', penMatch[1]); }

      // Pattern 3: Summary table "Opening Balance ... Sub-total ... Interest ... Closing Balance"
      if (/(?:Closing|Total|Grand)\s*Balance/i.test(tl)) {
          const nums = tl.match(/[\d,]+\d+/g) || [];
          if (nums.length >= 3) {
              // EPFO standard: [..., EE, ER, Pension]
              const ee = cleanNum(nums[nums.length-3]);
              const er = cleanNum(nums[nums.length-2]);
              const pen = cleanNum(nums[nums.length-1]);
              
              if (ee > 0 || er > 0 || pen > 0) {
                  result.summary.employeeShare = ee;
                  result.summary.employerShare = er;
                  result.summary.pensionShare = pen;
                  log('Found Shares via pattern 3:', ee, er, pen);
              }
          } else if (nums.length === 2 && !result.summary.pensionShare) {
              result.summary.employeeShare = cleanNum(nums[0]);
              result.summary.employerShare = cleanNum(nums[1]);
          }
      }
    }

    // Final sanity check: if any value was found, calculate total
    result.summary.total = result.summary.employeeShare + result.summary.employerShare + result.summary.pensionShare;
    log('Final result:', result.summary);
    return result;
  }

  /* ════════════════════════════════════ PUBLIC API */
  async function parsePDF(file, password) {
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), password: password || '' }).promise;
    const lines  = await extractLines(pdf);
    const data   = parseLines(lines);
    data._filename = file.name;
    data._parsedAt = new Date().toISOString();
    return data;
  }

  global.EPFParser = { parsePDF };
})(window);
