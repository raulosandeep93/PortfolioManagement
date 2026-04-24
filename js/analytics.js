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
    const flows = [...cashflows].sort((a, b) => {
      // Defensive: ensure we have Date objects
      const da = (a.date instanceof Date) ? a.date : new Date(a.date);
      const db = (b.date instanceof Date) ? b.date : new Date(b.date);
      return da - db;
    });

    if (!(flows[0].date instanceof Date) || isNaN(flows[0].date.getTime())) {
      console.warn('[Analytics] xirr: Invalid first date');
      return null;
    }

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
    
    // More granular Equity categories for smarter benchmarking
    if (n.match(/ELSS|TAX\s*SAVER/)) return 'EQUITY_ELSS';
    if (n.match(/SMALL\s*CAP/)) return 'EQUITY_SMALLCAP';
    if (n.match(/MID\s*CAP/)) return 'EQUITY_MIDCAP';
    if (n.match(/LARGE\s*CAP|BLUECHIP|TOP\s*100/)) return 'EQUITY_LARGECAP';
    if (n.match(/FLEXI\s*CAP|MULTI\s*CAP|FOCUSED/)) return 'EQUITY_FLEXICAP';
    
    if (n.match(/INDEX|ETF|SENSEX|NIFTY|GOLD|SILVER|INTERNATIONAL|GLOBAL|NASDAQ|S&P|FOF|FUND OF FUND/))
      return 'OTHER';
    
    return 'EQUITY';
  }

  function getBenchmark(category) {
    const maps = {
      'EQUITY_LARGECAP': { name: 'Nifty 50 TRI', return: 14.2 },
      'EQUITY_MIDCAP':   { name: 'Nifty Midcap 150 TRI', return: 18.5 },
      'EQUITY_SMALLCAP': { name: 'Nifty Smallcap 250 TRI', return: 21.0 },
      'EQUITY_FLEXICAP': { name: 'Nifty 500 TRI', return: 15.8 },
      'EQUITY_ELSS':     { name: 'Nifty 500 TRI', return: 15.8 },
      'EQUITY':          { name: 'Nifty 500 TRI', return: 15.5 },
      'HYBRID':          { name: 'CRISIL Hybrid 35+65', return: 12.8 },
      'DEBT':            { name: 'CRISIL Composite Bond Index', return: 7.2 },
      'OTHER':           { name: 'Nifty 50 TRI', return: 14.2 }
    };
    return maps[category] || maps['EQUITY'];
  }

  /* ── Compute per-scheme analytics ─────────────────────────────── */
  function computeSchemeAnalytics(scheme, liveNavEntry) {
    const liveNav    = liveNavEntry?.nav    || null;
    const liveNavDate= liveNavEntry?.date   || null;
    const casNav     = scheme.valuation?.nav || 0;
    const useNav     = liveNav || casNav;
    const units      = scheme.closingUnits || 0;
    const currentValue = units * useNav;

    // Cost Basis (Weighted Average Cost)
    let totalInvested = 0;
    let runningUnits  = 0;
    const cashflows   = [];

    // Sort transactions by date to calculate cost basis sequentially
    const sortedTxns = [...(scheme.transactions || [])].sort((a, b) => {
      const da = (a.date instanceof Date) ? a.date : new Date(a.date);
      const db = (b.date instanceof Date) ? b.date : new Date(b.date);
      return da - db;
    });

    for (const txn of sortedTxns) {
      const type = txn.type || classifyTxn(txn.description);
      const amt  = Math.abs(txn.rawAmount || 0);
      const u    = Math.abs(txn.units || 0);

      if (['PURCHASE', 'PURCHASE_SIP', 'SWITCH_IN', 'DIVIDEND_REINVEST'].includes(type) && amt > 0) {
        totalInvested += amt;
        runningUnits += u;
        // Dividend reinvestment is not a "pocket" cashflow for XIRR
        if (type !== 'DIVIDEND_REINVEST') {
          cashflows.push({ date: txn.date, amount: -amt });
        }
      } else if (['REDEMPTION', 'SWITCH_OUT'].includes(type) && u > 0) {
        // Reduction in cost basis based on average cost
        if (runningUnits > 0) {
          const avgCost = totalInvested / runningUnits;
          totalInvested = Math.max(0, totalInvested - (u * avgCost));
          runningUnits = Math.max(0, runningUnits - u);
        }
        cashflows.push({ date: txn.date, amount: amt });
      } else if (type === 'DIVIDEND' && amt > 0) {
        // Dividend payout is a positive cashflow for XIRR
        cashflows.push({ date: txn.date, amount: amt });
      }
    }

    // Add current value as terminal cashflow
    if (currentValue > 0 && cashflows.length > 0) {
      cashflows.push({ date: new Date(), amount: currentValue });
    }

    // Calculate Holding Period (from first purchase)
    const firstTxn = [...(scheme.transactions || [])]
      .filter(t => ['PURCHASE', 'PURCHASE_SIP', 'SWITCH_IN'].includes(t.type || classifyTxn(t.description)))
      .sort((a, b) => {
        const da = (a.date instanceof Date) ? a.date : new Date(a.date);
        const db = (b.date instanceof Date) ? b.date : new Date(b.date);
        return da - db;
      })[0];
    const firstDate = (firstTxn?.date instanceof Date) ? firstTxn.date : (firstTxn?.date ? new Date(firstTxn.date) : null);
    const holdingYears = (firstDate && !isNaN(firstDate.getTime())) ? (new Date() - firstDate) / (1000 * 3600 * 24 * 365.25) : 0;
    
    // Personal CAGR (Point-to-Point)
    const personalCagr = (totalInvested > 0 && holdingYears > 0.01) 
      ? (Math.pow(currentValue / totalInvested, 1 / holdingYears) - 1) * 100
      : null;

    const gainLoss        = currentValue - totalInvested;
    const absoluteReturn  = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;
    const xirrVal         = xirr(cashflows.filter(f => Math.abs(f.amount) > 0.01));

    return {
      totalInvested,
      currentValue,
      gainLoss,
      absoluteReturn,
      xirr: xirrVal,
      personalCagr,
      holdingYears,
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
          if ((scheme.closingUnits || 0) <= 0.001) continue;
          
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
            else if (['REDEMPTION', 'SWITCH_OUT', 'DIVIDEND'].includes(type) && amt > 0)
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

  /* ── Infer active SIP from transaction history ─────────────────── */
  /**
   * Returns the estimated active monthly SIP amount for a scheme.
   * Strategy: look at PURCHASE_SIP transactions from the last 12 months,
   * round each amount to nearest 100 to group near-identical installments,
   * pick the amount that appears most frequently (mode).
   * Returns 0 if no recurring PURCHASE_SIP is found.
   */
  function computeActiveSIP(transactions) {
    if (!transactions || transactions.length === 0) return 0;

    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    const recentSIPs = transactions.filter(t => {
      const type = t.type || classifyTxn(t.description);
      if (type !== 'PURCHASE_SIP') return false;
      const d = t.date instanceof Date ? t.date : new Date(t.date);
      return d >= twelveMonthsAgo && Math.abs(t.rawAmount || 0) > 0;
    });

    if (recentSIPs.length === 0) return 0;

    // Group by amount rounded to nearest ₹100
    const freq = {};
    recentSIPs.forEach(t => {
      const bucket = Math.round(Math.abs(t.rawAmount) / 100) * 100;
      freq[bucket] = (freq[bucket] || 0) + 1;
    });

    // Return the most frequent bucket (mode)
    const mode = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
    return mode ? Number(mode[0]) : 0;
  }

  /* ── Goal Planning Utilities ──────────────────────────────────── */
  function computeFutureValue(pv, annualRate, years) {
    return pv * Math.pow(1 + annualRate, years);
  }

  /**
   * Calculates required monthly SIP to reach a future target
   * @param {number} targetFV - Inflation adjusted target
   * @param {number} currentPV - Current invested value
   * @param {number} annualRate - Expected annual return (e.g. 0.12)
   * @param {number} years - Years remaining
   */
  function computeMonthlySIP(targetFV, currentPV, annualRate, years) {
    if (years <= 0) return 0;
    const r = annualRate / 12;
    const n = years * 12;
    
    // Future value of current investment
    const fvOfPV = pvFV(currentPV, r, n);
    const gap = targetFV - fvOfPV;
    
    if (gap <= 0) return 0;
    
    // SIP = Gap * r / ((1+r)^n - 1)
    return (gap * r) / (Math.pow(1 + r, n) - 1);
  }

  // Helper for periodic FV
  function pvFV(pv, rate, periods) {
    return pv * Math.pow(1 + rate, periods);
  }

  global.Analytics = { 
    xirr, classifyTxn, inferCategory, getBenchmark, computeSchemeAnalytics, computePortfolioSummary,
    computeFutureValue, computeMonthlySIP, computeActiveSIP
  };
})(window);
