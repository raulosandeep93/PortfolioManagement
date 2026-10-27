# Project TODOs & Technical Debt — FolioSense

Tasks and gaps verified directly from repository inspection, architecture gaps, and commit logs.

---

## High Priority
- [ ] **Add `.gitignore`**: Currently missing from the repository root; required to avoid committing operating system metadata (`.DS_Store`, `Thumbs.db`), editor temporary files, or local test files.
- [ ] **Demat CAS ISIN Resolution Edge Cases**: Improve fallback search reliability in `js/navfetch.js` when demat CAS scheme names contain non-standard abbreviations or extra spaces that cause `api.mfapi.in` search to return empty lists.

---

## Medium Priority
- [ ] **Additional Broker Support for Indian Stocks**: Currently only Zerodha Kite CSV holdings are supported in `js/zerodha-parser.js`. Add parsers or column mappings for other major Indian brokers (e.g. Groww, Upstox, ICICI Direct).
- [ ] **NSC Statement Automation**: NSC currently relies on manual user entry; investigate PDF statement parsing if postal / banking certificate statements are available.
- [ ] **Foreign Equity Broker Expansion**: `js/barclays-parser.js` handles Barclays ESOP / SVP awards; support additional common global equity platforms (e.g. Morgan Stanley, E*TRADE, Charles Schwab).

---

## Low Priority
- [ ] **Service Worker for Complete Offline Execution**: Add caching for CDN assets (`pdf.min.js`, `chart.umd.min.js`, `xlsx.full.min.js`) so the application UI can load completely when the device has no internet connection.
- [ ] **Export to CSV / Excel**: Complement existing JSON backup export with formatted spreadsheet exports of net worth and holdings.

---

## Technical Debt
- [ ] **No Automated Testing Harness**: Pure calculation logic (`Analytics.xirr`, `parseDate`, `cleanNum`, parser regex) lacks automated regression tests. Adding a lightweight test runner (e.g., Node test runner or Vitest) would prevent regressions when modifying parser regex.
- [ ] **Global Namespace Pollution**: Modules export to `window` (`window.UI`, `window.Analytics`, etc.). While suitable for vanilla JS without a bundler, standardizing module boundaries improves maintainability.
- [ ] **Script Tag Ordering Dependency**: Script dependencies in `index.html` are strictly order-dependent and must be manually kept in sync if new modules are introduced.
