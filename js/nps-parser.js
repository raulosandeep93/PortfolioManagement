/**
 * nps-parser.js — Protean CRA / NPS Holdings Statement PDF parser (v2)
 * Multi-strategy parser: structured → asset-class scanner → numeric fallback.
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
    m = s.match(/^(\w{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,\s+(\d{4})$/i);
    if (m) { const mo = MONTH[m[1].toLowerCase()]; if (mo !== undefined) return new Date(+m[3], mo, +m[2]); }
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
    if (/\bA\b|ALT|ALTERNATIVE/.test(n)) return 'A';
    if (/\bC\b|CORP|CORPORATE|BOND/.test(n)) return 'C';
    if (/\bG\b|GOVT|GOVERNMENT|GILT/.test(n)) return 'G';
    return 'E'; // Default equity
  }

  const ASSET_NAMES = { E: 'Equity', C: 'Corporate Bonds', G: 'Govt. Securities', A: 'Alternative Assets' };

  function assetClassName(code) { return ASSET_NAMES[code] || code; }

  /* ══════════════════════════════════════ CLASSIFY NPS TXN */
  function classifyNPSTxn(desc) {
    const d = (desc || '').toUpperCase();
    if (/EMPLOYER|EMP\s*CONTR|EMPLOYER\s*CONTR/.test(d))  return 'EMPLOYER_CONTRIBUTION';
    if (/EMPLOYEE|EMP\s*C|EMPLOYEE\s*CONTR/.test(d))       return 'EMPLOYEE_CONTRIBUTION';
    if (/SELF|VOLUNTARY|VOL\s*CONTR|REGULAR\s*CONTR|BY\s*SUBS/.test(d)) return 'VOLUNTARY_CONTRIBUTION';
    if (/CONTR(?:IBUTION)?|DEPOSIT|SUBSCRIPTION/i.test(d)) return 'CONTRIBUTION';
    if (/WITHDRAW|REDEMP|EXIT/.test(d))                    return 'WITHDRAWAL';
    if (/SWITCH|REBALANCE/.test(d))                        return 'SWITCH';
    if (/CHARGES?|FEE|ADMIN/.test(d))                      return 'CHARGES';
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

  /* ══════════════════════════════════ BUILD EMPTY RESULT */
  function emptyResult() {
    return { type: 'NPS', investor: {}, pfm: '', tiers: [], _summary: {} };
  }

  function getOrCreateTier(result, label) {
    let t = result.tiers.find(x => x.tier === label);
    if (!t) { t = { tier: label, schemes: [] }; result.tiers.push(t); }
    return t;
  }

  function getOrCreateScheme(tier, assetClass) {
    let s = tier.schemes.find(x => x.assetClass === assetClass);
    if (!s) {
      s = { name: `NPS - ${assetClassName(assetClass)}`, assetClass, units: 0, nav: 0, currentValue: 0, totalContributions: 0, transactions: [], analytics: null };
      tier.schemes.push(s);
    }
    return s;
  }

  /* ═══════════════════════════════════════════ EXTRACT COMMON META */
  function extractMeta(lines, result) {
    for (const line of lines) {
      const tl = line.text;
      if (!result.investor.name) {
        const nm = tl.match(/(?:Subscriber\s*|Account\s*Holder\s*)?Name\s*[:\-]\s*(.+)/i);
        if (nm) result.investor.name = nm[1].trim();
      }
      if (!result.investor.pran) {
        const pm = tl.match(/PRAN\s*[:\-]?\s*(\d{10,12})/i);
        if (pm) result.investor.pran = pm[1];
      }
      if (!result.pfm) {
        const pfm = tl.match(/(?:Pension\s+Fund\s+Manager|PFM)\s*[:\-]\s*(.+)/i)
                 || tl.match(/((?:SBI|HDFC|ICICI|UTI|KOTAK|LIC|Aditya\s+Birla|Tata|DSP|Max|Principal|Birla|Bajaj|CAMS)\s*(?:Pension|NPS|Fund)[^\n]{0,50})/i);
        if (pfm) result.pfm = (pfm[1] || pfm[0]).trim();
      }
      // Global contribution discovery
      const invM = tl.match(/(?:Total\s+)?(?:Contribution|Invested|Cost)\s*(?:Amount)?\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (invM && !result._summary.totalInvested) {
        result._summary.totalInvested = cleanNum(invM[1]);
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
   * STRATEGY 1 — Structured header-driven parsing
   * Works when PDF has clear "Tier I / Tier II" and table headers.
   * ════════════════════════════════════════════════════════════════════*/
  function parseStructured(lines) {
    const log = (...a) => console.log('[NPSParser-S1]', ...a);
    const result = emptyResult();
    extractMeta(lines, result);

    let currentTier   = null;
    let currentScheme = null;
    let inHoldingsTable = false;
    let inTxnTable      = false;
    let pendingName     = '';

    log('First 80 lines:\n' + lines.slice(0, 80).map((l,i) => `${i}: ${l.text}`).join('\n'));

    const saveCurrent = () => {
      if (currentTier && currentScheme) {
        if (!currentTier.schemes.find(s => s.assetClass === currentScheme.assetClass))
          currentTier.schemes.push(currentScheme);
        currentScheme = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text.trim();
      if (!tl) continue;

      // ── Tier header ───────────────────────────────────────
      const tierM = tl.match(/Tier\s*[-\s]?\s*(I{1,2}|1|2)\b/i);
      if (tierM) {
        saveCurrent();
        const raw = tierM[1].replace(/1/, 'I').replace(/2/, 'II').toUpperCase();
        const tierLabel = `Tier ${raw === 'II' || raw === '2' ? 'II' : 'I'}`;
        currentTier = getOrCreateTier(result, tierLabel);
        inHoldingsTable = /holding|balance|unit|portfolio/i.test(tl);
        inTxnTable      = /transaction|statement/i.test(tl);
        pendingName     = '';
        log('Tier:', tierLabel);
        continue;
      }

      // ── Holdings table trigger ────────────────────────────
      if (/Scheme\s*Name.*(?:Unit|NAV|Value)|Asset\s*Class.*(?:NAV|Unit)|Fund\s*Name.*(?:Balance|Unit|Value)|Account\s*Summary\s*For\s*Current|Holding\s*.*?Details|Units?\s*held|Total\s*Units?\s*held/i.test(tl)) {
        inHoldingsTable = true; inTxnTable = false; pendingName = '';
        if (!currentTier) currentTier = getOrCreateTier(result, 'Tier I');
        log('Holdings table at line', i);
        continue;
      }

      // ── Transaction table trigger ─────────────────────────
      if (/\bDate\b.*(?:Transaction|Contribut|Description|Particulars|Narration)/i.test(tl) || /Transaction\s*Details/i.test(tl)) {
        inTxnTable = true; inHoldingsTable = false;
        if (!currentTier) currentTier = getOrCreateTier(result, 'Tier I');
        log('Txn table at line', i);
        continue;
      }

      // ── Holdings row parsing ──────────────────────────────
      if (inHoldingsTable && currentTier) {
        const parts = tl.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
        const nums  = parts.filter(p => isNumTok(p) && p !== '-').map(cleanNum);
        const label = parts.filter(p => !isNumTok(p)).join(' ');

        // Pure name line (no numbers)
        if (nums.length === 0 && label.length > 3 && !/total|grand|amount|nav|units|value|summary|account|blocked|free|scheme\s*name|asset\s*class/i.test(label)) {
          pendingName = pendingName ? pendingName + ' ' + label : label;
          continue;
        }

        if (nums.length >= 2 && (label.length > 1 || pendingName.length > 1) && !/total|grand|sub\s*total/i.test(label)) {
          const schemeLabel = label.length > 1 ? (pendingName ? pendingName + ' ' + label : label) : pendingName;
          pendingName = '';

          const assetClass = inferAssetClass(schemeLabel);
          let units = 0, nav = 0, current = 0, cost = 0;
          if (nums.length >= 5) {
            // Blocked | Free | Total | NAV | Market Value
            units = nums[2]; nav = nums[3]; current = nums[4] || (units * nav);
          } else {
            units = nums[0]; nav = nums[1]; current = nums[2] || (units * nav); cost = nums[3] || 0;
            if (nav > units && units > 0 && units < 500) { const tmp = units; units = nav; nav = tmp; }
          }

          log(`Holdings: ${schemeLabel} AC:${assetClass} u:${units} nav:${nav} cur:${current}`);

          saveCurrent();
          currentScheme = getOrCreateScheme(currentTier, assetClass);
          if (units)   currentScheme.units = units;
          if (nav)     currentScheme.nav   = nav;
          if (current) currentScheme.currentValue = current;
          if (cost)    currentScheme.totalContributions = cost;
          continue;
        }

        // Total line — end holdings mode
        if (/(?:total|grand|sub\s*total)/i.test(tl) && !/(?:total\s*units|free\s*units|blocked\s*units)/i.test(tl)) {
          if (nums.length > 0 || /total\s*value|grand\s*total/i.test(tl)) {
            inHoldingsTable = false; pendingName = ''; saveCurrent();
          }
        }
      }

      // ── Transaction row parsing ───────────────────────────
      if (inTxnTable && currentTier && currentScheme) {
        // Support Date formats: 08-Apr-2026, 08/04/2026, 2026-04-08, Apr 08, 2026
        const dateM = tl.match(/^(\d{1,2}[-\/]\w{3,9}[-\/]\d{4}|\w{3}\s+\d{1,2}(?:st|nd|rd|th)?,\s+\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4}|\d{4}[-\/]\d{2}[-\/]\d{2})/i);
        if (dateM) {
          const date = parseDate(dateM[1]);
          if (date && !isNaN(date.getTime())) {
            const rest = tl.slice(dateM[0].length).trim();
            const cols = rest.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
            const nums = cols.filter(c => isNumTok(c) && c !== '-').map(cleanNum);
            const desc = cols.filter(c => !isNumTok(c)).join(' ').trim();
            const type = classifyNPSTxn(desc);

            let amount = 0, units = 0, nav = 0, balance = 0;
            
            if (nums.length >= 3) {
              // Heuristic: NAV is usually between 5 and 600
              // Amount is usually the largest or first/last
              // Balance is usually the last one
              if (nums.length >= 4) {
                // [Amount, Units, NAV, Balance] or [Units, NAV, Amount, Balance]
                balance = nums[nums.length - 1];
                const others = nums.slice(0, -1);
                // Find NAV (closest to 30-100 range)
                let navIdx = others.findIndex(n => n > 5 && n < 600);
                if (navIdx === -1) navIdx = others.length - 1; // Fallback to last of others
                nav = others[navIdx];
                const rem = others.filter((_, idx) => idx !== navIdx);
                // Typically high value is Amount, lower is Units
                if (rem.length >= 2) {
                  if (rem[0] > rem[1]) { amount = rem[0]; units = rem[1]; }
                  else { units = rem[0]; amount = rem[1]; }
                } else if (rem.length === 1) {
                  amount = rem[0];
                }
              } else {
                // [Amount, Units, NAV]
                let navIdx = nums.findIndex(n => n > 5 && n < 600);
                if (navIdx === -1) navIdx = 2; // Default last
                nav = nums[navIdx];
                const rem = nums.filter((_, idx) => idx !== navIdx);
                if (rem.length >= 2) {
                  if (rem[0] > rem[1]) { amount = rem[0]; units = rem[1]; }
                  else { units = rem[0]; amount = rem[1]; }
                } else {
                   amount = rem[0] || 0;
                }
              }
            } else if (nums.length === 2) {
              // Might be Amount and Units, or Units and NAV
              if (nums[0] < 600 && nums[0] > 5) { nav = nums[0]; units = nums[1]; }
              else if (nums[1] < 600 && nums[1] > 5) { nav = nums[1]; units = nums[0]; }
              else { amount = nums[0]; units = nums[1]; }
            } else if (nums.length === 1) {
              amount = nums[0];
            }

            currentScheme.transactions.push({ 
              date, 
              description: desc, 
              type, 
              rawAmount: Math.abs(amount), 
              units: Math.abs(units), 
              nav, 
              balance 
            });
            continue;
          }
        }

        // Asset class switch in txn section
        const acSwitch = tl.match(/(?:Asset\s+Class|Scheme|Fund)\s*[-:]?\s*([ECGA])\b/i);
        if (acSwitch) {
          saveCurrent();
          currentScheme = getOrCreateScheme(currentTier, acSwitch[1].toUpperCase());
          log('AC switch to:', acSwitch[1]);
          continue;
        }
      }

      // ── Total corpus / contribution summary ───────────────────────────────
      const totM = tl.match(/(?:Total\s+)?(?:Corpus|Portfolio\s+Value|Net\s+Asset|Total\s+Value|Grand\s+Total)\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (totM) { result._summary.totalValue = cleanNum(totM[1]); saveCurrent(); }
      
      const invM = tl.match(/(?:Total\s+)?(?:Contribution|Invested|Cost)\s*(?:Amount)?\s*[:\-]?\s*(?:INR|Rs\.?|₹)?\s*([\d,]+\.?\d*)/i);
      if (invM) { result._summary.totalInvested = cleanNum(invM[1]); }
    }

    saveCurrent();
    return result;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * STRATEGY 2 — Asset-class row brute-force scanner
   * Scans every line for "Asset Class [E/C/G/A]" or "Scheme [E/C/G/A]"
   * followed by numeric columns. Doesn't need table headers to be found.
   * ════════════════════════════════════════════════════════════════════*/
  function parseAssetClassScan(lines) {
    const log = (...a) => console.log('[NPSParser-S2]', ...a);
    const result = emptyResult();
    extractMeta(lines, result);

    // Determine current tier from context
    let currentTierLabel = 'Tier I';

    // Regex patterns for asset class row detection
    // Matches: "Asset Class E", "Asset class E (Equity)", "Scheme E", "E - Equity", "AC - E"
    const AC_ROW = /(?:Asset\s*Class|Scheme|AC|Fund)\s*[-:–]?\s*([ECGA])\b/i;
    // Also matches: standalone "E", "C", "G" when followed by numbers
    const AC_STANDALONE = /^\s*([ECGA])\s*[-–]?\s*(?:\(.*?\))?\s*([\d,]+)/i;
    // Matches Protean CRA format: "E (Equity)" at start of line
    const AC_PARENS = /^\s*([ECGA])\s*\(\w+\)/i;

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text.trim();

      // Track tier from context
      const tierM = tl.match(/Tier\s*[-\s]?\s*(I{1,2}|1|2)\b/i);
      if (tierM) {
        const raw = tierM[1];
        currentTierLabel = (raw === 'II' || raw === '2') ? 'Tier II' : 'Tier I';
      }

      // Test for asset-class row
      let assetClass = null;
      const acM = tl.match(AC_ROW) || tl.match(AC_PARENS);
      if (acM) assetClass = acM[1].toUpperCase();

      if (!assetClass) {
        const sa = tl.match(AC_STANDALONE);
        if (sa) assetClass = sa[1].toUpperCase();
      }

      if (!assetClass) continue;

      // Collect all numbers from this line (and possibly next 1-2 lines if they continue)
      let numLine = tl;
      // If the current line has < 2 numbers, peek at next line
      const numsHere = tl.match(/[\d,]+\.?\d*/g) || [];
      if (numsHere.length < 2 && i + 1 < lines.length) {
        const nextNums = (lines[i+1].text.match(/[\d,]+\.?\d*/g) || []);
        if (nextNums.length >= 2) { numLine = tl + '  ' + lines[i+1].text; i++; }
      }

      const allNums = (numLine.match(/[\d,]+\.?\d*/g) || []).map(s => cleanNum(s)).filter(n => n > 0);
      if (allNums.length < 1) continue;

      log(`AC row [${assetClass}] tier=${currentTierLabel}: ${allNums.join(', ')}`);

      const tier   = getOrCreateTier(result, currentTierLabel);
      const scheme = getOrCreateScheme(tier, assetClass);

      // Column inference:
      // Common NPS table: Blocked Units | Free Units | Total Units | NAV | Market Value
      // Or simpler: Units | NAV | Market Value
      // NAV for NPS is typically 10–100 range; market value is large
      if (allNums.length >= 5) {
        // 5+ columns: Blocked, Free, Total, NAV, MarketVal
        scheme.units        = allNums[2];
        scheme.nav          = allNums[3];
        scheme.currentValue = allNums[4];
      } else if (allNums.length === 4) {
        // Could be: Blocked, Free, Total, NAV  OR  Units, NAV, MarketVal, Cost
        // Heuristic: if[3] is small (NAV ~10-120), it's the NAV
        if (allNums[3] < 500) {
          scheme.units = allNums[2];
          scheme.nav   = allNums[3];
          scheme.currentValue = scheme.units * scheme.nav;
        } else {
          scheme.units        = allNums[0];
          scheme.nav          = allNums[1];
          scheme.currentValue = allNums[2];
          scheme.totalContributions = allNums[3];
        }
      } else if (allNums.length === 3) {
        scheme.units        = allNums[0];
        scheme.nav          = allNums[1];
        scheme.currentValue = allNums[2];
      } else if (allNums.length === 2) {
        scheme.units = allNums[0];
        scheme.nav   = allNums[1];
        scheme.currentValue = allNums[0] * allNums[1];
      } else {
        // Only 1 number — likely market value
        scheme.currentValue = allNums[0];
      }

      // Sanity-correct if nav looks too big compared to units
      if (scheme.nav > 50000 && scheme.units < scheme.nav) {
        const tmp = scheme.units; scheme.units = scheme.nav; scheme.nav = tmp;
      }
    }

    return result;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * STRATEGY 3 — Numeric cluster fallback
   * Last resort: finds rows with a big cluster of numbers and a label
   * that contains any NPS-like keyword, then attempts to assign values.
   * ════════════════════════════════════════════════════════════════════*/
  function parseNumericFallback(lines) {
    const log = (...a) => console.log('[NPSParser-S3]', ...a);
    const result = emptyResult();
    extractMeta(lines, result);

    // Whitelist keywords that strongly indicate NPS scheme rows
    const SCHEME_KW = /equity|corporate|govt|government|gilt|alternative|asset\s*class|scheme\s*[ecga]|[ecga]\s*-\s*(equity|corp|govt|alt)/i;

    let currentTierLabel = 'Tier I';

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text.trim();

      const tierM = tl.match(/Tier\s*[-\s]?\s*(I{1,2}|1|2)\b/i);
      if (tierM) currentTierLabel = (tierM[1] === 'II' || tierM[1] === '2') ? 'Tier II' : 'Tier I';

      if (!SCHEME_KW.test(tl)) continue;

      const nums = (tl.match(/[\d,]+\.?\d*/g) || []).map(s => cleanNum(s)).filter(n => n > 0);
      if (nums.length < 2) continue;

      const assetClass = inferAssetClass(tl);
      log(`Fallback numeric row [${assetClass}]: ${tl} -> nums: ${nums.join(', ')}`);

      const tier   = getOrCreateTier(result, currentTierLabel);
      const scheme = getOrCreateScheme(tier, assetClass);

      if (nums.length >= 3) {
        scheme.units        = nums[0];
        scheme.nav          = nums[1];
        scheme.currentValue = nums[2];
      } else {
        scheme.units = nums[0];
        scheme.nav   = nums[1];
        scheme.currentValue = nums[0] * nums[1];
      }
    }

    return result;
  }

  /* ══════════════════════════════════ COMPUTE ANALYTICS */
  function computeNPSSchemeAnalytics(scheme) {
    const current = scheme.currentValue || (scheme.units * scheme.nav);
    let totalInvested = scheme.totalContributions || 0;
    const cashflows = [];

    for (const txn of (scheme.transactions || [])) {
      const isContrib  = ['CONTRIBUTION','EMPLOYEE_CONTRIBUTION','EMPLOYER_CONTRIBUTION','VOLUNTARY_CONTRIBUTION'].includes(txn.type);
      const isWithdraw = txn.type === 'WITHDRAWAL';
      const amt = Math.abs(txn.rawAmount || 0);
      if (isContrib && amt > 0) {
        totalInvested += amt;
        cashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: -amt });
      } else if (isWithdraw && amt > 0) {
        totalInvested = Math.max(0, totalInvested - amt);
        cashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: amt });
      }
    }

    if (current > 0 && cashflows.length > 0) {
      cashflows.push({ date: new Date(), amount: current });
    }

    const gainLoss      = current - totalInvested;
    const absoluteReturn = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;
    let xirrVal = null;
    if (global.Analytics?.xirr && cashflows.length >= 2) {
      xirrVal = global.Analytics.xirr(cashflows.filter(f => Math.abs(f.amount) > 0.01));
    }
    return { totalInvested, currentValue: current, gainLoss, absoluteReturn, xirr: xirrVal, units: scheme.units, nav: scheme.nav };
  }

  /* ══════════════════════════════ MERGE & VALIDATE RESULTS */
  function countSchemes(r) {
    return r.tiers.reduce((s, t) => s + t.schemes.filter(sc => sc.units > 0 || sc.currentValue > 0).length, 0);
  }

  function mergeResults(primary, secondary) {
    // Fill missing meta from secondary
    if (!primary.investor.name && secondary.investor.name) primary.investor.name = secondary.investor.name;
    if (!primary.pfm && secondary.pfm) primary.pfm = secondary.pfm;

    // Merge schemes: if primary already has a scheme for a given asset class + tier, skip
    for (const st of secondary.tiers) {
      const pt = getOrCreateTier(primary, st.tier);
      for (const ss of st.schemes) {
        const ps = pt.schemes.find(x => x.assetClass === ss.assetClass);
        if (!ps) pt.schemes.push(ss);
        else {
          // Fill in missing values
          if (!ps.units && ss.units)   ps.units = ss.units;
          if (!ps.nav && ss.nav)       ps.nav   = ss.nav;
          if (!ps.currentValue && ss.currentValue) ps.currentValue = ss.currentValue;
        }
      }
    }
    return primary;
  }

  function finalise(result) {
    // Compute analytics
    result.tiers.forEach(tier => {
      tier.schemes.forEach(scheme => {
        scheme.analytics = computeNPSSchemeAnalytics(scheme);
      });
    });

    const schemeCount = result.tiers.reduce((s, t) => s + t.schemes.length, 0);
    console.log('[NPSParser] Final — Tiers:', result.tiers.length, '| Schemes:', schemeCount);
    return result;
  }

  /* ════════════════════════════════════ PUBLIC API */
  async function parsePDF(file, password) {
    const buffer = await file.arrayBuffer();
    const pdf    = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), password: password || '' }).promise;
    const lines  = await extractLines(pdf);
    console.log('[NPSParser] Lines:', lines.length, '| Pages:', pdf.numPages);

    // Strategy 1: structured header-driven
    const s1 = parseStructured(lines);
    let best = s1;
    console.log('[NPSParser] S1 scheme count:', countSchemes(s1));

    if (countSchemes(s1) === 0) {
      // Strategy 2: asset-class brute-force
      const s2 = parseAssetClassScan(lines);
      console.log('[NPSParser] S2 scheme count:', countSchemes(s2));
      if (countSchemes(s2) > 0) best = mergeResults(s2, s1);
    }

    if (countSchemes(best) === 0) {
      // Strategy 3: numeric keyword fallback
      const s3 = parseNumericFallback(lines);
      console.log('[NPSParser] S3 scheme count:', countSchemes(s3));
      if (countSchemes(s3) > 0) best = mergeResults(s3, s1);
    }

    // If still nothing found, create a Tier I placeholder from any total value found
    if (countSchemes(best) === 0 && best._summary?.totalValue) {
      console.log('[NPSParser] Using total value fallback:', best._summary.totalValue);
      const tier   = getOrCreateTier(best, 'Tier I');
      const scheme = getOrCreateScheme(tier, 'E');
      scheme.currentValue = best._summary.totalValue;
    }

    finalise(best);
    best._filename  = file.name;
    best._parsedAt  = new Date().toISOString();
    best._pageCount = pdf.numPages;
    best._rawLines  = lines.map(l => l.text);
    return best;
  }

  global.NPSParser = { parsePDF };
})(window);
