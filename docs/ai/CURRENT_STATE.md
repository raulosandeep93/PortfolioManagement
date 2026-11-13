# Current State — FolioSense

## Last Updated
2026-11-13

---

## Current Project Status
FolioSense is fully functional as a client-side multi-asset personal finance tracking application. It supports parsing statements for Mutual Funds (CAS), NPS, Indian Stocks (Zerodha), Foreign Stocks (Barclays), and EPF, along with manual tracking for Bank Savings, FDs, RDs, and NSCs, a complete financial goal allocation system, and full portfolio segregation by person/holder across all asset classes.

---

## Recently Completed
- **Manual Holder Tagging for MF & NPS (removes auto-detect from parsed docs)**:
  - Added "Uploaded Statements" table under the MF holdings view (`#mf-statements-section`, `#mf-statements-tbody`) with one row per uploaded CAS portfolio, showing filename, an inline holder input, active scheme count, invested, current value, and a 🗑️ delete button.
  - Added per-portfolio holder input inside each NPS portfolio block in `#nps-tiers-container`. Each NPS statement now shows its filename + a "Tag holder..." input at the top of its tier cards.
  - `getAllPersonNames()` now reads **only** `p.holder` for both MF and NPS portfolios (removed `p.investor?.name` and `p.subscriberName`).
  - `buildRows()` for MF cards uses `p.holder` as `personName` (not `p.investor?.name`).
  - `filterRows()` now matches on `r.personName` (string) instead of `r.personIdx` (integer) so person-tab filtering works correctly with name-based holders.
  - `renderLandingPage()` filters MF by `p.holder` and NPS by `p.holder`.
  - `refreshDashboard()` in `app.js` filters MF by `p.holder` and NPS by `p.holder`.
  - Added `mfStmtTable.onchange` and `mfStmtTable.click` delegation in `app.js` for real-time holder tagging and MF portfolio deletion.
  - Added `npsTiersContainer.addEventListener('change', ...)` delegation in `app.js` for real-time NPS holder tagging. NPS `data-idx` resolves to the real index in `state.npsPortfolios` (using `indexOf`) to remain correct when the displayed list is person-filtered.
  - `investor.name` / `subscriberName` retained only in deduplication/import logic (finding existing portfolios by PAN/PRAN); completely removed from all UI-layer display, filtering, and person identification logic.
- **Global Portfolio Segregation by Person / Holder**:
  - Implemented segregation across all asset categories: Mutual Funds, NPS, Indian Stocks, Foreign Equities (Barclays), Bank Savings (Accounts, FDs, RDs), NSC, and EPF.
  - Added dedicated sticky `#person-bar` below primary navigation with multi-person tabs and color accents.
  - Added inline `.holder-input` fields in all asset tables and person/holder inputs in all creation modals with autocomplete (`<datalist id="global-persons-list">`).
  - Overview screen, summary cards, and individual asset dashboards dynamically filter by the active person.
  - Full backup JSON export (`exportFullBackup`) and import (`importFullData`) preserve complete person segregation across all holdings.
- **Goal Persistence across page reloads**: Rewrote goal storage layer (`getGoalsMeta`, `getGoalsMap`, `saveGoal`, `loadGoalsMetadata`, `loadGoalsMap`) with smart-merge logic so that user-entered target amounts, years, return rates, and inflation rates survive page reloads and are never overwritten by blank placeholder defaults. Added `beforeunload` flush for in-flight edits.
- **Goal card live recalculation**: Target/Years/Return/Inflation inputs now recalculate projections (adjusted target, SIP need, progress bar, status badge) live on `input`/`change` without requiring a full re-render.
- **Goal Deletion**: Added a delete option (`🗑️`) on each Goal card in the Goals screen, with confirmation, cascading unlinking of all tagged assets across all modules, state persistence, datalist refresh, and empty-state fallback.
- **Goals Section Logic**: Goal metadata tracking (`targetAmount`, `targetDate`), linking assets/schemes to goals, and visual progress calculation (`app.js`, `ui.js`).
- **Bank Savings & Deposits**: Full support for savings accounts, Fixed Deposits, and Recurring Deposits with maturity calculations.
- **Stock Deduplication**: Added content-based fingerprinting (`holdingsFingerprint()`) to prevent duplicate imports of identical stock portfolios while allowing distinct family members with identical holdings.
- **Theme Switcher**: Dark mode (default) and Light mode switching with CSS variable mapping.
- **JSON Backup System**: Full export and import functionality with dirty-state indicator.

---

## Currently in Progress
- None.

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
