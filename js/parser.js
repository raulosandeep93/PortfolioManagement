/**
 * parser.js — CAS PDF parser v3
 * Handles both "detailed" and "demat" CAMS/KFintech formats.
 */
(function (global) {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ══════════════════════════════════════════════ DATE PARSING */
  const MONTH = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
    january:0,february:1,march:2,april:3,june:5,july:6,august:7,
    september:8,october:9,november:10,december:11,
  };
  function parseDate(s) {
    if (!s) return null;
    s = s.trim().replace(/[\u2013\u2014]/g, '-');
    let m = s.match(/^(\d{1,2})[-\/ ](\w{3,9})[-\/ ](\d{4})$/i);
    if (m) { const mo = MONTH[m[2].toLowerCase()]; if (mo !== undefined) return new Date(+m[3], mo, +m[1]); }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1]);
    return null;
  }

  /* ════════════════════════════════════════ NUMBER UTILITIES */
  function cleanNum(s) {
    s = String(s).trim();
    const neg = s.startsWith('(') || s.startsWith('-');
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }
  function isNumTok(s) {
    s = s.trim();
    return /^[-\(]?[\d,]+\.?\d*\)?$/.test(s);
  }

  /* ══════════════════════════════════════════ ISIN EXTRACTION */
  // Handles spaced ISINs like "INF 209 K 01 VP 1" → "INF209K01VP1"
  function extractISIN(text) {
    const m = text.match(/ISIN\s*[:\-]\s*(I[\s]*N[\s]*(?:[A-Z0-9][\s]*){10})/i);
    if (!m) return '';
    return m[1].replace(/\s+/g, '').toUpperCase().slice(0, 12);
  }

  /* ═══════════════════════════════ SCHEME NAME FROM COMBINED LINE */
  // "B 205 GZ - Aditya Birla Sun Life Arbitrage Fund - Growth - Direct Plan ( Demat ) - ISIN : ..."
  // Also plain: "HDFC Flexi Cap Fund - Direct Plan - Growth"
  function extractSchemeNameFromLine(tl) {
    // Demat format: CODE - NAME ( Demat ) - ISIN
    let m = tl.match(/^[\w\s]+?\s*-\s*(.+?)\s*(?:\(\s*(?:De|Non-De)?mat\s*\)|\s*-\s*ISIN\s*[:\-])/i);
    if (m) return m[1].trim();
    // Fallback: everything before " - ISIN" or " ( ISIN"
    m = tl.match(/^(.+?)\s*(?:[-–]\s*ISIN\s*[:\-]|\(\s*ISIN\s*[:\-])/i);
    if (m) return m[1].replace(/^\s*[\w\s]+?\s*-\s*/, '').trim(); // strip leading code
    return '';
  }

  /* ════════════════════════════════════ TRANSACTION TYPE */
  function classifyTxn(desc) {
    const d = (desc || '').toUpperCase();
    if (/REINVEST/.test(d) && /DIVIDEND|IDCW/.test(d)) return 'DIVIDEND_REINVEST';
    if (/SIP|SYSTEMATIC\s+INVEST/.test(d))              return 'PURCHASE_SIP';
    if (/SWITCH\s*IN(?!.*OUT)/.test(d))                 return 'SWITCH_IN';
    if (/SWITCH\s*OUT/.test(d))                         return 'SWITCH_OUT';
    if (/REDEMPTION|REDEEM|WITHDRAWAL/.test(d))         return 'REDEMPTION';
    if (/DIVIDEND|IDCW/.test(d))                        return 'DIVIDEND';
    if (/BONUS/.test(d))                                return 'BONUS';
    if (/STT/.test(d))                                  return 'STT';
    if (/STAMP/.test(d))                                return 'STAMP_DUTY';
    if (/PURCHASE|INVEST|SUBSCRI|ALLOT|NFO|LUMPSUM|ONLINE/.test(d)) return 'PURCHASE';
    return 'OTHER';
  }

  /* ════════════════════════════════════ TRANSACTION LINE PARSER */
  const DATE_RE = /^(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4})\b/;

  function parseTxnLine(text) {
    const dm = text.match(DATE_RE);
    if (!dm) return null;
    const date = parseDate(dm[1]);
    if (!date || isNaN(date.getTime())) return null;
    const rest = text.slice(dm[0].length).trim();
    if (/Opening\s+Balance/i.test(rest)) return null;

    // Split by 2+ spaces (column delimiter)
    const cols = rest.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
    const desc = [], nums = [];
    for (const c of cols) {
      if (isNumTok(c) && c !== '-' && c !== '*') nums.push(cleanNum(c));
      else if (c !== '-' && c !== '*') desc.push(c);
    }
    // Fallback: regex extract all numbers
    if (nums.length === 0) {
      for (const m of rest.matchAll(/[\(]?[\d,]{1,12}\.?\d{0,4}[\)]?/g)) {
        const v = cleanNum(m[0]); if (v !== 0) nums.push(v);
      }
    }
    let description = desc.join(' ').trim();
    if (!description) {
      description = rest.replace(/[\(]?[\d,]{1,12}\.?\d{0,4}[\)]?/g,'').replace(/\s+/g,' ').trim();
    }
    const type = classifyTxn(description);
    let amount=0, units=0, nav=0, balance=0;
    if      (nums.length>=4) [amount,units,nav,balance]=nums.slice(-4);
    else if (nums.length===3) [units,nav,balance]=nums;
    else if (nums.length===2) [nav,balance]=nums;
    else if (nums.length===1) balance=nums[0];
    return { date, description: description.replace(/\s+/g,' ').trim(), type, rawAmount:Math.abs(amount), units, nav, balance };
  }

  /* ════════════════════════════════════════════ EXTRACT LINES */
  async function extractLines(pdf) {
    const allItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp   = page.getViewport({ scale: 1.0 });
      const ct   = await page.getTextContent({ normalizeWhitespace: true });
      for (const item of ct.items) {
        const str = (item.str || '').replace(/\s+/g,' ').trim();
        if (!str) continue;
        allItems.push({ str, x: item.transform[4], y: vp.height - item.transform[5], page: p, w: Math.max(item.width||0,1) });
      }
    }
    allItems.sort((a,b) => a.page!==b.page ? a.page-b.page : Math.abs(a.y-b.y)>6 ? a.y-b.y : a.x-b.x);
    const lines = [];
    for (const item of allItems) {
      const last = lines[lines.length-1];
      if (last && last.page===item.page && Math.abs(last.y-item.y)<=6) last.items.push(item);
      else lines.push({ y:item.y, page:item.page, items:[item] });
    }
    for (const line of lines) {
      line.items.sort((a,b)=>a.x-b.x);
      let text='';
      for (let i=0; i<line.items.length; i++) {
        if (i>0) { const gap=line.items[i].x-(line.items[i-1].x+line.items[i-1].w); text+=gap>=18?'  ':' '; }
        text+=line.items[i].str;
      }
      line.text=text.trim();
    }
    return lines.filter(l=>l.text.length>0);
  }

  /* ════════════════════════════════════════════ MAIN PARSER */
  function parseLines(lines) {
    const log = (...a) => console.log('[CASParser]', ...a);
    const result = { investor:{}, statementPeriod:{}, fileType:'UNKNOWN', folios:[] };

    let currentAMC    = '';
    let pendingScheme = '';
    let currentFolio  = null;
    let currentScheme = null;
    let inTxnTable    = false;
    let investorName  = '';  // track to avoid using it as scheme name

    const saveScheme = () => {
      if (currentScheme && currentFolio) {
        // DEDUPE: Check if scheme exists in this folio
        const existing = currentFolio.schemes.find(s => 
          (s.isin && s.isin === currentScheme.isin) || 
          (s.name && s.name === currentScheme.name)
        );

        if (existing) {
          log('Merge duplicate scheme:', currentScheme.name);
          // Merge transactions
          existing.transactions = [...existing.transactions, ...currentScheme.transactions];
          // Prefer non-zero units
          if (currentScheme.closingUnits > 0) existing.closingUnits = currentScheme.closingUnits;
          // Merge valuations
          Object.assign(existing.valuation, currentScheme.valuation);
        } else {
          log('Save scheme:', currentScheme.name, '| txns:', currentScheme.transactions.length, '| units:', currentScheme.closingUnits);
          currentFolio.schemes.push(currentScheme);
        }
        currentScheme = null;
      }
    };

    for (let i=0; i<lines.length; i++) {
      const tl = lines[i].text.trim();
      if (!tl) continue;

      /* ── File type ──────────────────────────────────────────── */
      if (/CAMS|Computer Age/i.test(tl))  result.fileType='CAMS';
      if (/KFin|Karvy/i.test(tl))        result.fileType='KFINTECH';

      /* ── Statement period ───────────────────────────────────── */
      if (!result.statementPeriod.from) {
        // "01-Jan-2025 To 08-Apr-2026" (bare format) or "For the period XX To XX"
        const pm = tl.match(/(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4})\s+[Tt]o\s+(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4})/);
        if (pm) { result.statementPeriod.from=parseDate(pm[1]); result.statementPeriod.to=parseDate(pm[2]); }
      }

      /* ── Investor info ──────────────────────────────────────── */
      if (/^(?:Investor\s*)?Name\s*[:\-]/i.test(tl) && !result.investor.name) {
        investorName = result.investor.name = tl.replace(/^(?:Investor\s*)?Name\s*[:\-]\s*/i,'').trim();
        log('Investor:', investorName);
      }
      const emailM = tl.match(/(?:E[-\s]?Mail(?:\s+Id)?|Email)\s*[:\-]\s*([\w.+\-]+@[\w.\-]+\.\w+)/i);
      if (emailM) result.investor.email = emailM[1];
      const mobileM = tl.match(/Mobile\s*(?:No\.?)?\s*[:\-]\s*(\+?[\d\s\-]{10,14})/i);
      if (mobileM) result.investor.mobile = mobileM[1].replace(/[\s\-]/g,'');
      const panM = tl.match(/\bPAN\s*[:\-]\s*([A-Z]{5}\d{4}[A-Z])\b/);
      if (panM && !result.investor.pan) result.investor.pan = panM[1];

      /* ── ISIN line (key: combined scheme+ISIN line in demat format) ── */
      // Also handles standard "ISIN: INF179KB1HB2  AMFI: 122639" line
      if (/ISIN\s*[:\-]/i.test(tl)) {
        saveScheme();
        inTxnTable = false;

        const isin      = extractISIN(tl);
        let schemeName  = extractSchemeNameFromLine(tl); // try to get from line
        if (!schemeName) schemeName = pendingScheme;     // fallback to tracked name
        if (!schemeName) {                               // look back
          for (let j=i-1; j>=Math.max(0,i-5); j--) {
            const lt=lines[j].text.trim();
            if (lt && lt!==investorName && !/Folio|KYC|PAN\s*[:\-]|ISIN|AMFI|Advisor|Registrar|\bRTA\b|Nominee|^-+$/i.test(lt) && lt.length>4) { schemeName=lt; break; }
          }
        }

        // AMFI code — present in standard format, absent in demat
        let amfiCode = '';
        for (const re of [/AMFI\s*Code\s*[:\-]\s*(\d{4,9})/i, /AMFI\s*[:\-]\s*(\d{4,9})/i, /AMFI\s+(\d{4,9})/i]) {
          const m=tl.match(re); if (m) { amfiCode=m[1]; break; }
        }
        // Check next line too
        if (!amfiCode && i+1<lines.length) {
          const nm=lines[i+1].text.match(/AMFI\s*(?:Code)?\s*[:\-]\s*(\d{4,9})/i);
          if (nm) amfiCode=nm[1];
        }

        const rtaM = tl.match(/(?:Registrar|RTA)\s*[:\-]\s*(\w+)/i);
        log('Scheme:', schemeName||'?', '| ISIN:', isin||'-', '| AMFI:', amfiCode||'-');

        currentScheme = { name: schemeName||'Unknown Scheme', isin, amfiCode, rta:rtaM?.[1]||'', transactions:[], closingUnits:0, valuation:{} };
        pendingScheme = '';
        inTxnTable = true; // transactions follow immediately (demat format has no per-scheme header)
        continue;
      }

      /* ── Folio line ─────────────────────────────────────────── */
      const folioM = tl.match(/Folio\s*(?:No\.?|Number)?\s*[:\-]\s*([\w\/\-\s]+?)(?:\s{2,}|\s+P[Aa][Nn]|\s+KYC|$)/);
      if (folioM) {
        saveScheme();
        inTxnTable = false;
        const folioNum = folioM[1].trim().replace(/\s+\/\s+/,'/');
        const folioPAN = (tl.match(/PAN(?:\d)?\s*[:\-]\s*([A-Z]{5}\d{4}[A-Z])/i)||[])[1]||'';
        
        // DEDUPE: Reuse existing folio if seen earlier in same file
        const existing = result.folios.find(f => f.folio === folioNum);
        if (existing) {
          log('Reuse Folio:', folioNum);
          currentFolio = existing;
        } else {
          log('New Folio:', folioNum, 'AMC:', currentAMC);
          currentFolio = { folio:folioNum, amc:currentAMC, pan:folioPAN, schemes:[] };
          result.folios.push(currentFolio);
        }
        pendingScheme = '';
        continue;
      }

      /* ── Transaction table header ───────────────────────────── */
      if (/\bDate\b.*\b(?:Transaction|Description)\b/i.test(tl)) {
        inTxnTable = true;
        log('Txn table start line', i);
        continue;
      }

      /* ── Closing balance (and inline NAV/value in demat format) ── */
      // IMPROVED: Avoid matching "Folio Total" summary lines while allowing "as on" dates
      const isTotalLine = /Folio\s+Total|Folio\s+Balance|Grand\s+Total|Summary\s+Total/i.test(tl);
      const closingM = tl.match(/(?:Closing|Balance)\s+(?:Unit\s+)?Balance\s*[:\-]?\s*([\d,]+\.?\d*)/i);
      
      if (closingM && currentScheme && !isTotalLine) {
        currentScheme.closingUnits = Math.abs(parseFloat(closingM[1].replace(/,/g,'')));
        log('Closing units:', currentScheme.closingUnits, 'for', currentScheme.name);
        // Demat format: "...NAV on 07-Apr-2026: INR 30.0774  Total Cost Value: ...  Market Value on 07-Apr-2026: INR 205,487.95"
        const navI  = tl.match(/NAV\s+on\s+[\w\-]+\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d+)/i);
        const valI  = tl.match(/Market\s+Value\s+on\s+[\w\-]+\s*[:\-]?\s*(?:INR|Rs\.?|₹)\s*([\d,]+\.?\d+)/i);
        const costI = tl.match(/Total\s+Cost\s+Value\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d+)/i);
        // Standard format: "NAV: Rs 95.68"
        const navS  = tl.match(/(?:Closing\s+)?NAV\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d+)/i);
        const valS  = tl.match(/(?:Market\s+Value|Value)\s*[:\-]\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d+)/i);
        if (navI)  currentScheme.valuation.nav   = parseFloat(navI[1].replace(/,/g,''));
        else if (navS) currentScheme.valuation.nav = parseFloat(navS[1].replace(/,/g,''));
        if (valI)  currentScheme.valuation.value  = parseFloat(valI[1].replace(/,/g,''));
        else if (valS) currentScheme.valuation.value = parseFloat(valS[1].replace(/,/g,''));
        if (costI) currentScheme.valuation.cost   = parseFloat(costI[1].replace(/,/g,''));
        log('Valuation:', currentScheme.valuation);
        inTxnTable = false;
        continue;
      }

      /* ── Standard valuation line ────────────────────────────── */
      if (currentScheme && /(?:Market\s+Value|Valuation)\s+(?:on|as\s+on)/i.test(tl)) {
        const navV  = tl.match(/(?:Closing\s+)?NAV\s*[:\-]?\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d+)/i);
        const valV  = tl.match(/(?:Market\s+Value|Value)\s*[:\-]\s*(?:Rs\.?|₹)?\s*([\d,]+\.?\d+)/i);
        const dateV = tl.match(/(?:on|as\s+on)\s+(\d{1,2}[-\/]\w{3}[-\/]\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4})/i);
        if (navV)  currentScheme.valuation.nav  = parseFloat(navV[1].replace(/,/g,''));
        if (valV)  currentScheme.valuation.value = parseFloat(valV[1].replace(/,/g,''));
        if (dateV) currentScheme.valuation.date  = parseDate(dateV[1]);
        inTxnTable = false;
        continue;
      }

      /* ── Transaction rows ───────────────────────────────────── */
      if (inTxnTable && currentScheme) {
        const txn = parseTxnLine(tl);
        if (txn) { currentScheme.transactions.push(txn); continue; }
        if (/Closing|Market\s+Value|ISIN|Folio|^-{5,}/i.test(tl)) inTxnTable = false;
      }

      /* ── AMC name detection ─────────────────────────────────── */
      // Only match clean AMC names — no digits, no "Folio", not too long
      // FIX: exclude lines with 3+ consecutive digits (portfolio summary has amounts)
      if (/Mutual\s+Fund|Asset\s+Manag/i.test(tl)
          && tl.length < 70
          && !/\d{3,}/.test(tl)                  // no large numbers (portfolio summary rows)
          && !/Folio|ISIN|AMFI|KYC|Date\s+Trans/i.test(tl)) {
        currentAMC = tl.trim();
        log('AMC:', currentAMC);
        pendingScheme = '';
        continue;
      }

      /* ── Pending scheme name ────────────────────────────────── */
      if (currentFolio && !inTxnTable
          && tl.length > 4 && tl.length < 120
          && tl !== investorName                 // FIX: skip investor name
          && !/^(?:Folio|ISIN|AMFI|Date|Advisor|Registrar|\bRTA\b|KYC|PAN\s*[:\-]|Opening|Closing|Market|Valuation|Nominee|STT|STAMP|E-Mail|Mobile|Name\s*[:\-]|Address|Consolidated|Statement|Tax|Demat|Nomination|CAS\s+Type|Entry\s+Load|Exit\s+Load|Page\s+\d|CAMS)/i.test(tl)
          && !/^\-+$/.test(tl)
          && !/^\d+$/.test(tl)
          && !/\d{5,}/.test(tl)                 // skip lines with large numbers
      ) {
        pendingScheme = tl.trim();
      }
    }

    saveScheme();
    log('Done. Folios:', result.folios.length, '| Schemes:', result.folios.reduce((s,f)=>s+f.schemes.length,0));
    console.log('[CASParser] Full JSON:', JSON.stringify(result, null, 2));
    return result;
  }

  /* ════════════════════════════════════ PUBLIC API */
  async function parsePDF(file, password) {
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data:new Uint8Array(buffer), password:password||'' }).promise;
    const lines  = await extractLines(pdf);
    console.log('[CASParser] Lines:', lines.length, '| Pages:', pdf.numPages);
    console.log('[CASParser] First 60:\n' + lines.slice(0,60).map((l,i)=>`${i}: ${l.text}`).join('\n'));
    const data = parseLines(lines);
    data._filename  = file.name;
    data._parsedAt  = new Date().toISOString();
    data._pageCount = pdf.numPages;
    data._rawLines  = lines.map(l=>l.text);
    return data;
  }

  global.CASParser = { parsePDF };
})(window);
