/**
 * nps-parser.js v6 — USE SUMMARY VALUES FROM PDF DIRECTLY
 * 
 * Strategy: Stop trying to compute invested/current from transactions.
 * The PDF already tells us the exact numbers. Just READ them.
 *
 * Key lines in every NPS statement:
 *   Line ~42: "₹ 9,64,068.64  98  ₹ 8,35,523.80  ₹ 0.00  ₹ 1,28,544.84"
 *     = [Total Value, Num Contributions, Total Contributed, Total Withdrawn, Total Gain]
 *   Lines ~48: "SCHEME E - TIER I POP  7,31,174.50  13,702.2597  53.3616"
 *     = [Value, Units, NAV] per scheme
 *
 * Exposes: window.NPSParser
 */
(function (global) {
  'use strict';

  if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }

  const VERSION = 'v6';
  const log = (...a) => console.log(`[NPSParser ${VERSION}]`, ...a);

  /* ══════════════════════════════════════════════ HELPERS */
  const MONTH = {
    jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
    january:0,february:1,march:2,april:3,june:5,july:6,august:7,
    september:8,october:9,november:10,december:11,
  };

  function parseDate(s) {
    if (!s) return null;
    s = s.trim().replace(/[\u2013\u2014]/g, '-');
    let m;
    m = s.match(/^(\d{1,2})[-\/ ](\w{3,9})[-\/ ](\d{4})$/i);
    if (m) { const mo = MONTH[m[2].toLowerCase()]; if (mo !== undefined) return new Date(+m[3], mo, +m[1]); }
    m = s.match(/^(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i);
    if (m) { const mo = MONTH[m[1].toLowerCase()]; if (mo !== undefined) return new Date(+m[3], mo, +m[2]); }
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return new Date(+m[3], +m[2]-1, +m[1]);
    return null;
  }

  function cleanNum(s) {
    s = String(s || '').trim().replace(/,/g, '');
    const neg = s.startsWith('(') || s.startsWith('-');
    const n = parseFloat(s.replace(/[^\d.]/g, ''));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }

  function isNumTok(s) { return /^[-\(]?[\d,]+\.?\d*\)?$/.test(String(s).trim()); }

  const ASSET_NAMES = { E: 'Equity', C: 'Corporate Bonds', G: 'Govt. Securities', A: 'Alternative Assets' };
  function assetClassName(code) { return ASSET_NAMES[code] || code; }

  const DATE_RE = /^(\d{1,2}[-\/]\w{3,9}[-\/]\d{4}|\d{1,2}[-\/]\d{2}[-\/]\d{4})/i;

  function classifyTxn(desc) {
    const d = (desc || '').toUpperCase();
    if (/EMPLOYER/.test(d)) return 'EMPLOYER_CONTRIBUTION';
    if (/EMPLOYEE/.test(d)) return 'EMPLOYEE_CONTRIBUTION';
    if (/VOLUNTARY|VOL\s*CONTR/.test(d)) return 'VOLUNTARY_CONTRIBUTION';
    if (/CONTR|DEPOSIT|SUBSCRI|BY\s*SUBS/.test(d)) return 'CONTRIBUTION';
    if (/WITHDRAW|REDEMP|EXIT/.test(d)) return 'WITHDRAWAL';
    if (/SWITCH|REBALANC/.test(d)) return 'SWITCH';
    if (/BILLING|CHARGES?|FEE|ADMIN/.test(d)) return 'CHARGES';
    if (/OPENING\s+BALANCE|CLOSING\s+BALANCE/.test(d)) return 'BALANCE';
    if (/ARREAR/.test(d)) return 'CONTRIBUTION';
    return 'OTHER';
  }

  function isContribution(type) {
    return ['CONTRIBUTION','EMPLOYEE_CONTRIBUTION','EMPLOYER_CONTRIBUTION','VOLUNTARY_CONTRIBUTION'].includes(type);
  }

  /* ══════════════════════════════════════ EXTRACT PDF LINES */
  async function extractLines(pdf) {
    const allItems = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1.0 });
      const ct = await page.getTextContent({ normalizeWhitespace: true });
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

  /* ══════════════════════════════════════════════════════════════════════
   * PARSE A SINGLE PDF
   * ════════════════════════════════════════════════════════════════════*/
  function parseLines(lines) {
    const result = {
      type: 'NPS',
      investor: {},
      pfm: '',
      statementPeriod: {},
      holdings: {},       // { 'E': { value, units, nav }, ... }
      transactions: [],   // per-scheme transactions only
      summary: {          // AUTHORITATIVE values from the PDF
        totalValue: 0,
        totalInvested: 0,
        totalGain: 0,
      },
    };

    // ═══════ PHASE 1: Scan all lines for metadata, summary, holdings, transactions ═══════

    // Track which section we're in
    let section = 'HEADER';
    // HEADER → before any data section
    // HOLDINGS → "Investment Details - Scheme Wise Summary" section
    // CONTRIB_SUMMARY → "Contribution/Redemption Details" (SKIP these — they're totals, not per-scheme)
    // TXN_DETAILS → "Transaction Details" (per-scheme breakdown)
    let currentAC = null;

    for (let i = 0; i < lines.length; i++) {
      const tl = lines[i].text;

      // ── Metadata ───────────────────────────────────────────────
      if (!result.investor.pran) {
        const pm = tl.match(/PRAN\s+(\d{10,12})/i);
        if (pm) result.investor.pran = pm[1];
      }
      if (!result.investor.name) {
        const nm = tl.match(/Subscriber\s+Name\s+(.+?)(?:\s+Tier|\s*$)/i);
        if (nm) result.investor.name = nm[1].replace(/^SHRI\s+|^SMT\s+/i, '').trim();
      }

      // Statement period: "April 01, 2021 to March 31, 2022"
      if (!result.statementPeriod.to) {
        const pm = tl.match(/(\w+\s+\d{1,2},?\s+\d{4})\s+to\s+(\w+\s+\d{1,2},?\s+\d{4})/i);
        if (pm) {
          result.statementPeriod.from = parseDate(pm[1]);
          result.statementPeriod.to = parseDate(pm[2]);
          log('Period:', pm[1], 'to', pm[2]);
        }
      }

      // ── SUMMARY LINE: "₹ 9,64,068.64  98  ₹ 8,35,523.80  ₹ 0.00  ₹ 1,28,544.84" ──
      // Pattern: ₹ NUMBER  NUMBER  ₹ NUMBER  ₹ NUMBER  ₹ NUMBER
      // Matches the investment summary row with: [Value, Count, Invested, Withdrawn, Gain]
      const rupeeNums = tl.match(/₹\s*([\d,]+\.?\d*)/g);
      if (rupeeNums && rupeeNums.length >= 4) {
        const vals = rupeeNums.map(s => cleanNum(s.replace(/₹\s*/, '')));
        // Heuristic: the first ₹ value is Total Value, the second is Total Contribution
        // Only accept if first value > 10000 (reasonable NPS corpus)
        if (vals[0] > 10000) {
          // Check if there's a plain number (count) between first and second ₹ values
          // Format: ₹ VALUE  COUNT  ₹ VALUE  ₹ VALUE  ₹ VALUE
          const v = vals[0], inv = vals[1], gain = vals.length >= 4 ? vals[3] : 0;
          // Only update if this looks bigger than what we had (latest statement has largest values)
          if (v > result.summary.totalValue) {
            result.summary.totalValue = v;
            result.summary.totalInvested = inv;
            result.summary.totalGain = gain;
            log('SUMMARY found at line', i, ':', JSON.stringify(result.summary));
          }
        }
      }

      // ── SECTION DETECTION ──────────────────────────────────────
      if (/Investment\s+Details.*Scheme\s+Wise/i.test(tl) || /Scheme\s+wise\s+Value/i.test(tl)) {
        section = 'HOLDINGS';
        log('→ HOLDINGS section at line', i);
        continue;
      }
      if (/Contribution\/Redemption\s+Details/i.test(tl)) {
        section = 'CONTRIB_SUMMARY';
        log('→ CONTRIB_SUMMARY section at line', i, '(skipping)');
        continue;
      }
      if (/^Transaction\s+Details\s*$/i.test(tl)) {
        section = 'TXN_DETAILS';
        log('→ TXN_DETAILS section at line', i);
        continue;
      }
      if (/^Notes\s*$/i.test(tl)) {
        section = 'FOOTER';
        continue;
      }

      // ── SCHEME/AC detection: "SCHEME E - TIER I POP ..." ───────
      const schemeM = tl.match(/SCHEME\s+([ECGA])\s*[-–]/i);
      if (schemeM) {
        currentAC = schemeM[1].toUpperCase();

        // If we're in HOLDINGS section, extract value/units/nav from this line
        if (section === 'HOLDINGS') {
          // Extract ALL numbers from the line
          const allNums = [];
          const numRE = /[\d,]+\.\d+|[\d,]{2,}/g;
          let nm;
          while ((nm = numRE.exec(tl)) !== null) {
            const v = cleanNum(nm[0]);
            if (v > 1) allNums.push(v); // skip "1" from "TIER I"
          }
          if (allNums.length >= 3) {
            result.holdings[currentAC] = {
              value: allNums[0],
              units: allNums[1],
              nav: allNums[2],
            };
            log('HOLDING:', currentAC, '| val:', allNums[0], '| units:', allNums[1], '| nav:', allNums[2]);
          }
        }
        continue;
      }

      // ── CONTRIB_SUMMARY: skip all lines ────────────────────────
      if (section === 'CONTRIB_SUMMARY') continue;

      // ── TXN_DETAILS: parse per-scheme transaction rows ─────────
      if (section === 'TXN_DETAILS' && currentAC) {
        // Skip header lines
        if (/^Date\s+Description/i.test(tl)) continue;

        const dateM = tl.match(DATE_RE);
        if (!dateM) continue;
        const date = parseDate(dateM[1]);
        if (!date || isNaN(date.getTime())) continue;

        const rest = tl.slice(dateM[0].length).trim();
        if (rest.length < 2) continue;

        // Split into text and number columns
        const cols = rest.split(/\s{2,}|\t/).map(s => s.trim()).filter(Boolean);
        const nums = [];
        const descParts = [];
        for (const c of cols) {
          if (isNumTok(c) && c !== '-') nums.push(cleanNum(c));
          else descParts.push(c);
        }
        const desc = descParts.join(' ').trim();
        const type = classifyTxn(desc);

        // Skip balance & charges lines
        if (type === 'BALANCE' || type === 'CHARGES') continue;

        // Column order: Amount (in ₹) | NAV | Units
        let amount = 0, nav = 0, units = 0;
        if (nums.length >= 3) { amount = nums[0]; nav = nums[1]; units = nums[2]; }
        else if (nums.length === 2) { amount = nums[0]; nav = nums[1]; }
        else if (nums.length === 1) { amount = nums[0]; }

        amount = Math.abs(amount);
        nav = Math.abs(nav);
        units = Math.abs(units);

        if (amount < 0.01 && units < 0.001) continue;

        result.transactions.push({
          date, description: desc || type, type,
          assetClass: currentAC, amount, nav, units,
        });
      }
    }

    log('PARSED:', result.transactions.length, 'txns |',
        Object.keys(result.holdings).length, 'holdings |',
        'summary:', JSON.stringify(result.summary), '|',
        'period:', result.statementPeriod.from, '-', result.statementPeriod.to);

    return result;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * BUILD PORTFOLIO — uses summary values as source of truth
   * ════════════════════════════════════════════════════════════════════*/
  function buildPortfolio(parsedFiles) {
    if (!parsedFiles || parsedFiles.length === 0) return null;

    log('Building portfolio from', parsedFiles.length, 'files');

    const portfolio = {
      type: 'NPS',
      investor: {},
      pfm: '',
      statementPeriod: {},
      tiers: [],
      _summary: {},
      _parsedAt: new Date().toISOString(),
    };

    // Find the LATEST statement (by period end date)
    let latestFile = parsedFiles[0];
    let latestDate = null;

    for (const pf of parsedFiles) {
      if (pf.investor?.name) portfolio.investor.name = pf.investor.name;
      if (pf.investor?.pran) portfolio.investor.pran = pf.investor.pran;
      if (pf.pfm) portfolio.pfm = pf.pfm;

      const to = pf.statementPeriod?.to ? new Date(pf.statementPeriod.to) : null;
      if (to && (!latestDate || to > latestDate)) {
        latestDate = to;
        latestFile = pf;
        portfolio.statementPeriod = { ...pf.statementPeriod };
      }
    }

    // ── USE LATEST STATEMENT'S SUMMARY FOR OVERVIEW CARDS ────────
    const latestSummary = latestFile.summary || {};
    const latestHoldings = latestFile.holdings || {};

    portfolio._summary = {
      totalValue: latestSummary.totalValue || 0,
      totalInvested: latestSummary.totalInvested || 0,
      totalGain: latestSummary.totalGain || 0,
    };

    log('LATEST STATEMENT:', latestFile._filename, '| period to:', latestDate);
    log('SUMMARY from latest:', JSON.stringify(portfolio._summary));
    log('HOLDINGS from latest:', JSON.stringify(latestHoldings));

    // ── Collect + dedup all transactions ──────────────────────────
    const allTxns = [];
    for (const pf of parsedFiles) allTxns.push(...(pf.transactions || []));
    allTxns.sort((a, b) => new Date(a.date) - new Date(b.date));

    const seen = new Set();
    const uniqueTxns = [];
    for (const txn of allTxns) {
      const dt = txn.date instanceof Date ? txn.date.getTime() : new Date(txn.date).getTime();
      const key = `${dt}_${txn.amount.toFixed(2)}_${txn.assetClass}_${txn.type}`;
      if (!seen.has(key)) { seen.add(key); uniqueTxns.push(txn); }
    }
    log('DEDUP:', allTxns.length, '→', uniqueTxns.length, 'unique txns');

    // ── Group txns by asset class ─────────────────────────────────
    const acGroups = {};
    for (const txn of uniqueTxns) {
      if (!acGroups[txn.assetClass]) acGroups[txn.assetClass] = [];
      acGroups[txn.assetClass].push(txn);
    }
    for (const ac of Object.keys(latestHoldings)) {
      if (!acGroups[ac]) acGroups[ac] = [];
    }

    // ── Build schemes ─────────────────────────────────────────────
    const tier = { tier: 'Tier I', schemes: [] };

    for (const [ac, txns] of Object.entries(acGroups)) {
      const hd = latestHoldings[ac] || {};

      // Current value from holdings
      const currentValue = hd.value || 0;

      // Invested: sum contributions from transactions
      let txnInvested = 0;
      const cashflows = [];
      for (const txn of txns) {
        if (isContribution(txn.type) && txn.amount > 0) {
          txnInvested += txn.amount;
          cashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: -txn.amount });
        } else if (txn.type === 'WITHDRAWAL' && txn.amount > 0) {
          txnInvested = Math.max(0, txnInvested - txn.amount);
          cashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: txn.amount });
        }
      }

      // XIRR
      let xirrVal = null;
      if (currentValue > 0 && cashflows.length > 0 && global.Analytics?.xirr) {
        const cf = [...cashflows, { date: new Date(), amount: currentValue }];
        xirrVal = global.Analytics.xirr(cf);
      }

      const gainLoss = currentValue - txnInvested;
      const absReturn = txnInvested > 0 ? (gainLoss / txnInvested) * 100 : 0;

      tier.schemes.push({
        name: `NPS - ${assetClassName(ac)}`,
        assetClass: ac,
        units: hd.units || 0,
        nav: hd.nav || 0,
        currentValue,
        totalContributions: txnInvested,
        transactions: txns,
        analytics: {
          totalInvested: txnInvested,
          currentValue,
          gainLoss,
          absoluteReturn: absReturn,
          xirr: xirrVal,
          units: hd.units || 0,
          nav: hd.nav || 0,
        },
      });

      log('SCHEME:', ac, '| invested:', txnInvested.toFixed(2), '| current:', currentValue.toFixed(2), '| gain:', gainLoss.toFixed(2));
    }

    portfolio.tiers.push(tier);

    // ── FINAL LOG ─────────────────────────────────────────────────
    const schemeTotInvested = tier.schemes.reduce((s, sc) => s + sc.analytics.totalInvested, 0);
    const schemeTotCurrent = tier.schemes.reduce((s, sc) => s + sc.analytics.currentValue, 0);
    log('PORTFOLIO DONE:',
        '| scheme-invested:', schemeTotInvested.toFixed(2),
        '| scheme-current:', schemeTotCurrent.toFixed(2),
        '| summary-invested:', portfolio._summary.totalInvested,
        '| summary-current:', portfolio._summary.totalValue);

    return portfolio;
  }

  /* ════════════════════════════════════ PUBLIC API */
  async function parsePDF(file, password) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), password: password || '' }).promise;
    const lines = await extractLines(pdf);
    log('=== Parsing', file.name, '| Lines:', lines.length, '| Pages:', pdf.numPages, '===');
    log('First 60 lines:\n' + lines.slice(0, 60).map((l,i) => `  ${i}: ${l.text}`).join('\n'));
    const parsed = parseLines(lines);
    parsed._filename = file.name;
    parsed._parsedAt = new Date().toISOString();
    parsed._rawLines = lines.map(l => l.text);
    return parsed;
  }

  function mergeAndBuild(existingPortfolio, newParsedFiles) {
    const allParsed = [];
    if (existingPortfolio && existingPortfolio._parsedFiles) allParsed.push(...existingPortfolio._parsedFiles);
    allParsed.push(...newParsedFiles);
    const portfolio = buildPortfolio(allParsed);
    if (portfolio) portfolio._parsedFiles = allParsed;
    return portfolio;
  }

  global.NPSParser = { parsePDF, buildPortfolio, mergeAndBuild };
  log('Loaded', VERSION);
})(window);
