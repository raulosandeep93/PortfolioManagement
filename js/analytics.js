/**
 * analytics.js — XIRR computation & portfolio analytics
 * Exposes: window.Analytics
 */
(function (global) {
  'use strict';

  /* ── XIRR: Newton-Raphson ─────────────────────────────────────── */
  function xirr(cashflows) {
    if (!cashflows || cashflows.length < 2) return null;

    // Sort by date ascending
    const flows = [...cashflows].sort((a, b) => a.date - b.date);
    const t0 = flows[0].date.getTime();
    const MS_PER_YEAR = 365.25 * 24 * 3600 * 1000;

    // Year-fraction for each cashflow
    const t = flows.map(f => (f.date.getTime() - t0) / MS_PER_YEAR);

    const npv = (r) =>
      flows.reduce((sum, f, i) => sum + f.amount / Math.pow(1 + r, t[i]), 0);

    const dnpv = (r) =>
      flows.reduce((sum, f, i) =>
        t[i] === 0 ? sum : sum - t[i] * f.amount / Math.pow(1 + r, t[i] + 1), 0);

    const guesses = [0.1, 0.5, 1.5, -0.05, 0.01];
    for (const guess of guesses) {
      let r = guess;
      for (let i = 0; i < 1000; i++) {
        const n = npv(r);
        const dn = dnpv(r);
        if (Math.abs(dn) < 1e-12) break;
        const delta = n / dn;
        r -= delta;
        if (Math.abs(delta) < 1e-8) {
          if (r > -1 && isFinite(r)) return r;
          break;
        }
      }
    }
    return null;
  }

  /* ── Classify transaction type ─────────────────────────────────── */
  function classifyTxn(description) {
    const d = (description || '').toUpperCase();
    if (d.match(/SIP|SYSTEMATIC\s+INVEST/))         return 'PURCHASE_SIP';
    if (d.match(/SWITCH\s*IN|SWITCH-IN/))            return 'SWITCH_IN';
    if (d.match(/SWITCH\s*OUT|SWITCH-OUT/))          return 'SWITCH_OUT';
    if (d.match(/REDEMPTION|REDEEM|WITHDRAWAL/))     return 'REDEMPTION';
    if (d.match(/DIVIDEND\s+REINVEST|IDCW\s+REINVEST/)) return 'DIVIDEND_REINVEST';
    if (d.match(/DIVIDEND|IDCW/))                    return 'DIVIDEND';
    if (d.match(/BONUS/))                            return 'BONUS';
    if (d.match(/PURCHASE|INVEST|SUBSCRI|ALLOT|NFO/)) return 'PURCHASE';
    if (d.match(/STT/))                              return 'STT';
    if (d.match(/STAMP/))                            return 'STAMP_DUTY';
    return 'OTHER';
  }

  /* ── Category from scheme name ─────────────────────────────────── */
  function inferCategory(schemeName) {
    const n = (schemeName || '').toUpperCase();
    if (n.match(/LIQUID|OVERNIGHT|MONEY\s*MARKET|ULTRA\s*SHORT|LOW\s*DURATION|SHORT\s*DURATION|CORPORATE\s*BOND|GILT|BANKING\s*AND\s*PSU|FLOATER|MEDIUM|CREDIT\s*RISK|DYNAMIC\s*BOND|DEBT/))
      return 'DEBT';
    if (n.match(/HYBRID|BALANCED|EQUITY\s*SAVINGS|ARBITRAGE|MULTI\s*ASSET|CONSERVATIVE|AGGRESSIVE\s*HYBRID|FLEXI\s*HYBD/))
      return 'HYBRID';
    if (n.match(/INDEX|ETF|SENSEX|NIFTY|GOLD|SILVER|INTERNATIONAL|GLOBAL|NASDAQ|S&P|FOF|FUND OF FUND/))
      return 'OTHER';
    return 'EQUITY';
  }

  /* ── Compute per-scheme analytics ─────────────────────────────── */
  function computeSchemeAnalytics(scheme, liveNavEntry) {
    const liveNav    = liveNavEntry?.nav    || null;
    const liveNavDate= liveNavEntry?.date   || null;
    const casNav     = scheme.valuation?.nav || 0;
    const useNav     = liveNav || casNav;
    const units      = scheme.closingUnits || 0;
    const currentValue = units * useNav;

    // Net invested = Σ purchases - Σ redemptions (absolute amounts)
    let totalInvested = 0;
    const cashflows   = [];

    for (const txn of (scheme.transactions || [])) {
      const type = txn.type || classifyTxn(txn.description);
      const amt  = Math.abs(txn.rawAmount || 0);

      if (['PURCHASE', 'PURCHASE_SIP', 'SWITCH_IN'].includes(type) && amt > 0) {
        totalInvested += amt;
        cashflows.push({ date: txn.date, amount: -amt });
      } else if (['REDEMPTION', 'SWITCH_OUT'].includes(type) && amt > 0) {
        totalInvested = Math.max(0, totalInvested - amt);
        cashflows.push({ date: txn.date, amount: amt });
      }
    }

    // Add current value as terminal cashflow
    if (currentValue > 0 && cashflows.length > 0) {
      cashflows.push({ date: new Date(), amount: currentValue });
    }

    const gainLoss        = currentValue - totalInvested;
    const absoluteReturn  = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;
    const xirrVal         = xirr(cashflows.filter(f => Math.abs(f.amount) > 0.01));

    return {
      totalInvested,
      currentValue,
      gainLoss,
      absoluteReturn,
      xirr: xirrVal,
      units,
      casNav,
      liveNav,
      liveNavDate,
      useNav,
      isLiveNav: !!liveNav,
      category: inferCategory(scheme.name),
    };
  }

  /* ── Compute portfolio-level summary ──────────────────────────── */
  function computePortfolioSummary(portfolios, liveNavMap) {
    let totalInvested    = 0;
    let totalCurrentValue= 0;
    const allCashflows   = [];

    for (const portfolio of portfolios) {
      for (const folio of (portfolio.folios || [])) {
        for (const scheme of (folio.schemes || [])) {
          const liveEntry = liveNavMap?.[scheme.amfiCode];
          scheme.analytics = computeSchemeAnalytics(scheme, liveEntry);
          totalInvested    += scheme.analytics.totalInvested;
          totalCurrentValue+= scheme.analytics.currentValue;

          // Gather cashflows for portfolio XIRR
          for (const txn of (scheme.transactions || [])) {
            const type = txn.type || classifyTxn(txn.description);
            const amt  = Math.abs(txn.rawAmount || 0);
            if (['PURCHASE', 'PURCHASE_SIP', 'SWITCH_IN'].includes(type) && amt > 0)
              allCashflows.push({ date: txn.date, amount: -amt });
            else if (['REDEMPTION', 'SWITCH_OUT'].includes(type) && amt > 0)
              allCashflows.push({ date: txn.date, amount: amt });
          }
        }
      }
    }

    let portfolioXIRR = null;
    if (allCashflows.length > 0 && totalCurrentValue > 0) {
      portfolioXIRR = xirr([
        ...allCashflows,
        { date: new Date(), amount: totalCurrentValue }
      ].filter(f => Math.abs(f.amount) > 0.01));
    }

    return {
      totalInvested,
      totalCurrentValue,
      totalGainLoss: totalCurrentValue - totalInvested,
      absoluteReturn: totalInvested > 0
        ? ((totalCurrentValue - totalInvested) / totalInvested) * 100
        : 0,
      portfolioXIRR,
    };
  }

  global.Analytics = { xirr, classifyTxn, inferCategory, computeSchemeAnalytics, computePortfolioSummary };
})(window);
