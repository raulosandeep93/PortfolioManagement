/**
 * nps-parser.js — Protean CRA / NPS Holdings Statement PDF parser
 * Handles both "Statement of Holdings" and "Statement of Transaction" formats.
 * Exposes: window.NPSParser
 */
(function (global) {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  /* ══════════════════════════════════════════════ HELPERS */
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
    m = s.match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})$/);
    if (m) return new Date(+m[1], +m[2]-1, +m[3]);
    return null;
  }

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

  /* ═══════════════════════════════════════════ ASSET CLASS */
  function inferAssetClass(name) {
    const n = (name || '').toUpperCase();
    if (/\bC\b|CORP|CORPORATE|BOND/.test(n)) return 'C';
    if (/\bG\b|GOVT|GOVERNMENT|GILT/.test(n)) return 'G';
    if (/\bA\b|ALT|ALTERNATIVE/.test(n)) return 'A';
    return 'E'; // Default equity
  }

  function assetClassName(code) {
    const map = { E: 'Equity', C: 'Corporate Bonds', G: 'Govt. Securities', A: 'Alternative Assets' };
    return map[code] || code;
  }

  /* ══════════════════════════════════════ CLASSIFY NPS TXN */
  function classifyNPSTxn(desc) {
    const d = (desc || '').toUpperCase();
    if (/EMPLOYER|EMP\s*CONTR|EMPLOYER\s*CONTR/.test(d))        return 'EMPLOYER_CONTRIBUTION';
    if (/EMPLOYEE|EMP\s*C|EMPLOYEE\s*CONTR/.test(d))             return 'EMPLOYEE_CONTRIBUTION';
    if (/SELF|VOLUNTARY|VOL\s*CONTR/.test(d))                    return 'VOLUNTARY_CONTRIBUTION';
    if (/CONTR(?:IBUTION)?/.test(d))                             return 'CONTRIBUTION';
    if (/WITHDRAW|REDEMP|EXIT/.test(d))                          return 'WITHDRAWAL';
    if (/SWITCH|REBALANCE/.test(d))                              return 'SWITCH';
    if (/CHARGES?|FEE|ADMIN/.test(d))                            return 'CHARGES';
    return 'OTHER';
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

  /* ══════════════════════════════════════════════ MAIN PARSER */
  function parseLines(lines) {
    const log = (...a) => console.log('[NPSParser]', ...a);

    const result = {
      type:     'NPS',
      investor: {},
      pfm:      '',
      tiers:    [], // [{tier:'Tier I', schemes:[...]}]
      _summary: {}  // raw totals from statement if found
    };

    let currentTier   = null;
    let currentScheme = null;
    let inTxnTable    = false;
    let inHoldingsTable = false;

    // Print first 80 lines for debug
    log('First 80 lines:\n' + lines.slice(0, 80).map((l, i) => `${i}: ${l.text}`).join('\n'));

    const saveTier = () => {
      if (currentTier && currentScheme) {
        currentTier.schemes.push(currentScheme);
        currentScheme = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text.trim();
      if (!tl) continue;

      // ── Subscriber Name ──────────────────────────────────
      if (!result.investor.name) {
        const nm = tl.match(/(?:Subscriber\s*)?Name\s*[:\-]\s*(.+)/i);
        if (nm) { result.investor.name = nm[1].trim(); log('Name:', result.investor.name); continue; }
      }

      // ── PRAN ─────────────────────────────────────────────
      if (!result.investor.pran) {
        const pm = tl.match(/PRAN\s*[:\-]?\s*(\d{10,12})/i);
        if (pm) { result.investor.pran = pm[1]; log('PRAN:', result.investor.pran); continue; }
      }

      // ── PFM / Fund Manager ────────────────────────────────
      if (!result.pfm) {
        const pfm = tl.match(/(?:Pension\s+Fund\s+Manager|PFM)\s*[:\-]\s*(.+)/i)
                 || tl.match(/((?:SBI|HDFC|ICICI|UTI|KOTAK|LIC|Aditya\s+Birla|Tata|DSP\s+BlackRock|Max|Principal|Birla)\s*(?:Pension|NPS|Fund)[^\n]{0,40})/i);
        if (pfm) { result.pfm = (pfm[1] || pfm[0]).trim(); log('PFM:', result.pfm); }
      }

      // ── Tier section header ───────────────────────────────
      const tierM = tl.match(/Tier\s*[-\s]?\s*(I{1,2}|1|2)\b/i);
      if (tierM) {
        saveTier();
        const tierNum = tierM[1].replace(/1/,'I').replace(/2/,'II').replace(/i{2}/i,'II').replace(/i{1}$/i,'I').toUpperCase();
        const tierLabel = `Tier ${tierNum}`;
        // reuse or create
        let existing = result.tiers.find(t => t.tier === tierLabel);
        if (!existing) {
          existing = { tier: tierLabel, schemes: [] };
          result.tiers.push(existing);
        }
        currentTier = existing;
        inHoldingsTable = /holding|balance|unit|portfolio/i.test(tl);
        inTxnTable = /transaction|statement/i.test(tl);
        log('Tier:', tierLabel, '| holdingTable:', inHoldingsTable, '| txnTable:', inTxnTable);
        continue;
      }

      // ── Holdings table header (triggers scheme reading) ───
      if (/Scheme\s*Name.*Unit|Asset\s*Class.*NAV|Fund\s*Name.*Balance/i.test(tl)) {
        inHoldingsTable = true;
        inTxnTable = false;
        log('Holdings table header at line', i);
        continue;
      }

      // ── Transaction table header ──────────────────────────
      if (/\bDate\b.*(?:Transaction|Contribut|Description)/i.test(tl) && currentTier) {
        inTxnTable = true;
        inHoldingsTable = false;
        log('Txn table start at line', i);
        continue;
      }

      // ── Holdings row parsing ──────────────────────────────
      // Typical: "Scheme E - SBI Pension  1234.567  48.2300  59,543.23  48,000.00"
      // or:      "E - Equity   1234.5678  48.23  59543.23"
      if (inHoldingsTable && currentTier) {
        // Try to detect scheme row: name token + 2-5 numeric columns
        const parts = tl.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
        const nums = parts.filter(p => isNumTok(p) && p !== '-').map(cleanNum);
        const label = parts.filter(p => !isNumTok(p)).join(' ');

        if (nums.length >= 2 && label.length > 1 && !/total|grand|sub\s*total/i.test(label)) {
          // Determine asset class
          const assetClass = inferAssetClass(label);
          const schemeName = `NPS - ${assetClassName(assetClass)}`;

          // Column order: Units, NAV, Market Value (Current), [Purchase Cost]
          const units   = nums[0] || 0;
          const nav     = nums[1] || 0;
          const current = nums[2] || (units * nav);
          const cost    = nums[3] || 0;

          log(`Holdings row: ${label} | AC:${assetClass} | Units:${units} | NAV:${nav} | CurrentVal:${current} | Cost:${cost}`);

          // Check if scheme already started (switch from txn-parsing back to holdings)
          if (currentScheme && currentScheme.assetClass !== assetClass) saveTier();

          if (!currentScheme) {
            currentScheme = {
              name: schemeName,
              assetClass,
              units,
              nav,
              currentValue: current || units * nav,
              totalContributions: cost,
              transactions: [],
              analytics: null,
            };
          } else {
            // update values if already exists (holdings line may appear before txn)
            currentScheme.units = units;
            currentScheme.nav   = nav;
            currentScheme.currentValue = current || units * nav;
            if (cost) currentScheme.totalContributions = cost;
          }
          continue;
        }

        // Blank/separator — end holdings mode if we see totals
        if (/total|grand|sub\s*total/i.test(tl)) {
          inHoldingsTable = false;
          saveTier();
        }
      }

      // ── Transaction row parsing ───────────────────────────
      // Typical: "01-Apr-2024  Employee Contribution  5000.00  103.672  48.2265  1234.5678"
      if (inTxnTable && currentTier && currentScheme) {
        const dateM = tl.match(/^(\d{1,2}[-\/]\w{3,9}[-\/]\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4}|\d{4}[-\/]\d{2}[-\/]\d{2})/);
        if (dateM) {
          const date = parseDate(dateM[1]);
          if (date && !isNaN(date.getTime())) {
            const rest = tl.slice(dateM[0].length).trim();
            const cols = rest.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
            const nums = cols.filter(c => isNumTok(c) && c !== '-').map(cleanNum);
            const desc = cols.filter(c => !isNumTok(c)).join(' ').trim() || rest.replace(/[\d,. ]+/g, ' ').trim();
            const type = classifyNPSTxn(desc);

            // cols: [amount, units, nav, balanceUnits] or some subset
            let amount = 0, units = 0, nav = 0, balance = 0;
            if      (nums.length >= 4) [amount, units, nav, balance] = nums.slice(-4);
            else if (nums.length === 3) [amount, units, nav] = nums;
            else if (nums.length === 2) [amount, units] = nums;
            else if (nums.length === 1)  amount = nums[0];

            const txn = { date, description: desc, type, rawAmount: Math.abs(amount), units: Math.abs(units), nav, balance };
            currentScheme.transactions.push(txn);
            // Update totalContributions if not set from holdings
            if (!currentScheme.totalContributions && ['CONTRIBUTION','EMPLOYEE_CONTRIBUTION','EMPLOYER_CONTRIBUTION','VOLUNTARY_CONTRIBUTION'].includes(type) && amount > 0) {
              currentScheme.totalContributions = (currentScheme.totalContributions || 0) + Math.abs(amount);
            }
            log(`  TXN: ${date.toDateString()} | ${type} | amt:${amount} | units:${units} | nav:${nav}`);
            continue;
          }
        }

        // Asset class switch in transaction section (e.g. "Asset Class E", "Scheme C")
        const acSwitch = tl.match(/(?:Asset\s+Class|Scheme|Fund)\s*[-:]?\s*([ECGA])\b/i);
        if (acSwitch) {
          saveTier();
          const assetClass = acSwitch[1].toUpperCase();
          const existing = currentTier.schemes.find(s => s.assetClass === assetClass);
          if (existing) currentScheme = existing;
          else {
            currentScheme = {
              name: `NPS - ${assetClassName(assetClass)}`,
              assetClass, units: 0, nav: 0, currentValue: 0, totalContributions: 0,
              transactions: [], analytics: null,
            };
          }
          log('Switched asset class to:', assetClass);
          continue;
        }
      }

      // ── Total/summary lines ───────────────────────────────
      const totM = tl.match(/(?:Total\s+)?(?:Corpus|Portfolio\s+Value|Net\s+Asset|Total\s+Value|Grand\s+Total)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (totM) {
        result._summary.totalValue = cleanNum(totM[1]);
        log('Total portfolio value from statement:', result._summary.totalValue);
        saveTier();
      }
    }

    // Save any remaining
    saveTier();

    // Compute analytics for each scheme
    result.tiers.forEach(tier => {
      tier.schemes.forEach(scheme => {
        scheme.analytics = computeNPSSchemeAnalytics(scheme);
      });
    });

    log('Parsed result — Tiers:', result.tiers.length, '| Schemes:', result.tiers.reduce((s, t) => s + t.schemes.length, 0));
    log('Full result:', JSON.stringify(result, null, 2));
    return result;
  }

  /* ════════════════════════════════ PER-SCHEME ANALYTICS */
  function computeNPSSchemeAnalytics(scheme) {
    const current = scheme.currentValue || (scheme.units * scheme.nav);
    let totalInvested = scheme.totalContributions || 0;
    const cashflows = [];

    for (const txn of (scheme.transactions || [])) {
      const isContrib = ['CONTRIBUTION','EMPLOYEE_CONTRIBUTION','EMPLOYER_CONTRIBUTION','VOLUNTARY_CONTRIBUTION'].includes(txn.type);
      const isWithdraw = txn.type === 'WITHDRAWAL';
      const amt = Math.abs(txn.rawAmount || 0);
      if (isContrib && amt > 0) {
        if (!totalInvested) totalInvested += amt;
        cashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: -amt });
      } else if (isWithdraw && amt > 0) {
        if (!totalInvested) totalInvested = Math.max(0, totalInvested - amt);
        cashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: amt });
      }
    }

    if (current > 0 && cashflows.length > 0) {
      cashflows.push({ date: new Date(), amount: current });
    }

    const gainLoss = current - totalInvested;
    const absoluteReturn = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

    // XIRR via Analytics if available (shared helper)
    let xirrVal = null;
    if (global.Analytics?.xirr && cashflows.length >= 2) {
      xirrVal = global.Analytics.xirr(cashflows.filter(f => Math.abs(f.amount) > 0.01));
    }

    return { totalInvested, currentValue: current, gainLoss, absoluteReturn, xirr: xirrVal, units: scheme.units, nav: scheme.nav };
  }

  /* ════════════════════════════════════ PUBLIC API */
  async function parsePDF(file, password) {
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), password: password || '' }).promise;
    const lines  = await extractLines(pdf);
    console.log('[NPSParser] Lines:', lines.length, '| Pages:', pdf.numPages);
    const data = parseLines(lines);
    data._filename  = file.name;
    data._parsedAt  = new Date().toISOString();
    data._pageCount = pdf.numPages;
    return data;
  }

  global.NPSParser = { parsePDF };
})(window);
