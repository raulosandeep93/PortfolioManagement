/**
 * navfetch.js — Live NAV fetching via api.mfapi.in
 * Also resolves AMFI codes for demat CAS (which lacks them) via name search.
 */
(function (global) {
  'use strict';

  const navCache    = Object.create(null);  // amfiCode → { nav, date, schemeName }
  const searchCache = Object.create(null);  // key → amfiCode
  const TIMEOUT     = 12000;

  function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
  }

  /* ── Fetch NAV by AMFI code ─────────────────────────────────── */
  async function fetchOne(amfiCode) {
    if (!amfiCode) return null;
    const key = String(amfiCode).trim();
    if (!key || key==='0') return null;
    if (navCache[key]) return navCache[key];
    try {
      const res  = await withTimeout(fetch(`https://api.mfapi.in/mf/${key}/latest`), TIMEOUT);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.data?.[0]) return null;
      const entry = { nav:parseFloat(json.data[0].nav), date:json.data[0].date, schemeName:json?.meta?.scheme_name||'' };
      navCache[key] = entry;
      return entry;
    } catch (_) { return null; }
  }

  /* ── Search AMFI code by scheme name (for demat CAS) ───────── */
  async function searchAmfiCode(schemeName, isin) {
    // try ISIN first (more precise)
    if (isin) {
      const key = 'isin:' + isin;
      if (searchCache[key]) return searchCache[key];
      try {
        const res  = await withTimeout(fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(isin)}`), TIMEOUT);
        if (res.ok) {
          const data = await res.json();
          if (data && data.length > 0) { searchCache[key] = String(data[0].schemeCode); return searchCache[key]; }
        }
      } catch (_) {}
    }

    // fallback: search by scheme name (first 50 chars)
    if (!schemeName) return null;
    const q   = schemeName.trim().replace(/\s*-\s*Direct\s+Plan.*/i,'').replace(/\s*-\s*Growth.*/i,'').trim().slice(0, 50);
    const key = 'name:' + q.toLowerCase();
    if (searchCache[key]) return searchCache[key];
    try {
      const res  = await withTimeout(fetch(`https://api.mfapi.in/mf/search?q=${encodeURIComponent(q)}`), TIMEOUT);
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.length === 0) return null;
      // Pick best match: prefer Direct & Growth in scheme name
      const sorted = [...data].sort((a, b) => {
        const aS = a.schemeName.toUpperCase();
        const bS = b.schemeName.toUpperCase();
        const score = (s) =>
          (s.includes('DIRECT') ? 4 : 0) +
          (s.includes('GROWTH') ? 2 : 0) +
          (s.includes('REGULAR') ? -2 : 0);
        return score(bS) - score(aS);
      });
      searchCache[key] = String(sorted[0].schemeCode);
      return searchCache[key];
    } catch (_) { return null; }
  }

  /* ── Fetch all NAVs (with AMFI code resolution for demat) ───── */
  async function fetchAll(schemes, onProgress) {
    // schemes: array of { amfiCode, name, isin }
    const CONCURRENCY = 5;
    const results     = {};
    let done          = 0;

    // Resolve missing AMFI codes first (batch)
    const needsSearch = schemes.filter(s => !s.amfiCode && (s.name || s.isin));
    for (let i = 0; i < needsSearch.length; i += CONCURRENCY) {
      const batch = needsSearch.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(async s => {
        const code = await searchAmfiCode(s.name, s.isin);
        if (code) s.amfiCode = code;
      }));
    }

    // Now fetch NAVs
    const withCode = schemes.filter(s => s.amfiCode);
    const unique   = [...new Map(withCode.map(s => [s.amfiCode, s])).values()];

    for (let i = 0; i < unique.length; i += CONCURRENCY) {
      const batch = unique.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(async s => {
        const entry = await fetchOne(s.amfiCode);
        if (entry) results[s.amfiCode] = entry;
        done++;
      }));
      if (onProgress) onProgress(done + needsSearch.length, unique.length + needsSearch.length);
    }

    return results;
  }

  /* ── Fetch 1Y and 3Y returns for a fund ─────────────────────── */
  async function fetchReturns(amfiCode) {
    if (!amfiCode) return null;
    const HISTORY_TIMEOUT = 25000; // History can be large
    try {
      const res = await withTimeout(fetch(`https://api.mfapi.in/mf/${amfiCode}`), HISTORY_TIMEOUT);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json?.data || json.data.length < 5) return null;

      const data = json.data;
      const latestPrice = parseFloat(data[0].nav);
      const [d1, m1, y1] = data[0].date.split('-');
      const latestDate = new Date(+y1, +m1 - 1, +d1);
      
      const getCAGR = (days) => {
        const target = new Date(latestDate);
        target.setDate(target.getDate() - days);
        
        let entry = data.find(d => {
          const [day, mo, yr] = d.date.split('-');
          const dDate = new Date(+yr, +mo - 1, +day);
          return dDate <= target;
        });

        if (!entry) entry = data[data.length - 1]; // Use oldest available

        const oldPrice = parseFloat(entry.nav);
        if (!oldPrice || oldPrice <= 0) return null;

        const [d2, m2, y2] = entry.date.split('-');
        const oldDate = new Date(+y2, +m2 - 1, +d2);
        
        const yearsDiff = (latestDate - oldDate) / (1000 * 3600 * 24 * 365.25);
        if (yearsDiff < 0.1) return null; // Too little data for CAGR

        return (Math.pow(latestPrice / oldPrice, 1 / yearsDiff) - 1) * 100;
      };

      return {
        oneYear: getCAGR(365),
        threeYear: getCAGR(1095),
        schemeName: json.meta?.scheme_name
      };
    } catch (err) {
      console.warn(`[NavFetch] Error fetching history for ${amfiCode}:`, err);
      return null;
    }
  }

  global.NavFetch = { fetchOne, fetchAll, searchAmfiCode, fetchReturns };
})(window);
