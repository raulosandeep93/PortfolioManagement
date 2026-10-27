# Current State — FolioSense

## Last Updated
2026-10-26

---

## Current Project Status
FolioSense is fully functional as a client-side multi-asset personal finance tracking application. It supports parsing statements for Mutual Funds (CAS), NPS, Indian Stocks (Zerodha), Foreign Stocks (Barclays), and EPF, along with manual tracking for Bank Savings, FDs, RDs, and NSCs, and a complete financial goal allocation system.

---

## Recently Completed
- **Goals Section Logic**: Goal metadata tracking (`targetAmount`, `targetDate`), linking assets/schemes to goals, and visual progress calculation (`app.js`, `ui.js`).
- **Bank Savings & Deposits**: Full support for savings accounts, Fixed Deposits, and Recurring Deposits with maturity calculations.
- **Stock Deduplication**: Added content-based fingerprinting (`holdingsFingerprint()`) to prevent duplicate imports of identical stock portfolios while allowing distinct family members with identical holdings.
- **Theme Switcher**: Dark mode (default) and Light mode switching with CSS variable mapping.
- **JSON Backup System**: Full export and import functionality with dirty-state indicator.

---

## Currently in Progress
- Repository AI operating and context system bootstrapping (`AGENTS.md`, `docs/ai/*`, `.agents/rules/*`).

---

## Known Issues
- **Demat CAS AMFI Code Omission**: Demat CAS statements do not contain AMFI codes. They require heuristic ISIN/scheme search via `api.mfapi.in`, which can occasionally fail or return close matches if ISIN is formatted unusually.
- **Network Dependency for Libraries**: When running completely offline without internet access, external CDN scripts (PDF.js, Chart.js, SheetJS) will fail to load unless pre-cached.

---

## Current Blockers
- None.

---

## Recently Modified Areas
- [`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js) — Goal tracking, bank savings handling, stock deduplication, backup exports.
- [`js/ui.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/ui.js) — Goal screen rendering, deposit modals, stock tables.
- [`index.html`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/index.html) — Goal and screen container sections.
- [`style.css`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/style.css) — Screen layout styling and theme variables.

---

## Next Recommended Actions
1. Add `.gitignore` to prevent committing system files or temporary testing artifacts.
2. Add automated unit test runner (e.g. lightweight Vitest or Node test runner) for pure functions: `Analytics.xirr`, date parsing, and number cleaners.
3. Add broker format expandability for Indian stocks (e.g., Groww, Upstox holdings CSVs).

---

## Important Discoveries
- **NPS Parser**: Attempting to reconstruct NPS portfolio values by summing individual transaction entries causes discrepancies due to complex adjustments, fees, and scheme allocations. NPS statements explicitly print the summary values on line ~42 and individual scheme values on line ~48. Always extract summary values directly.
- **Holdings Deduplication**: Do not deduplicate stock statements by filename. Use content-based fingerprinting (`instrument:qty:avgCost`) to correctly handle multi-person uploads that share a default filename like `holdings.csv`.
- **LocalStorage Dual-Save**: Always maintain synchronization between the root `foliosense_state` and individual keys (`folio_savings`, `foliosense_goals_meta`, etc.) so that modular UI interactions in `ui.js` don't overwrite each other.

---

## Do Not Redo
- **Do not rewrite NPS parser** to calculate balances from transaction rows; use direct summary line extraction (`nps-parser.js` v6).
- **Do not introduce a backend server** or cloud database; client-side confidentiality is a core architectural requirement.
- **Do not replace Vanilla JS with a heavy frontend framework** unless specifically requested by the project owner.
