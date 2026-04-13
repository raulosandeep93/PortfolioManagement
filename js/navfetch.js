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

  global.NavFetch = { fetchOne, fetchAll, searchAmfiCode };
})(window);
