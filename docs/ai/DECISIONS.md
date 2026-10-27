# Architectural Decisions — FolioSense

## DECISION-001 — 100% Client-Side In-Browser Execution

Date:
2026-04-20

Decision:
Execute all PDF parsing, CSV processing, analytics calculations, and state persistence strictly on the client side in the user's browser.

Reason:
Financial statements (CAS, EPFO, Demat, bank deposits) contain highly sensitive personal identifiable information (PAN, account numbers, balances, employer details). Client-side processing ensures zero data leakage, eliminates backend infrastructure costs, and guarantees user privacy.

Alternatives considered:
- Backend processing server with Python/Node.js PDF parsers (rejected for security, privacy, and operational cost).
- Cloud database with user authentication (rejected as unnecessary for personal local finance tracking).

Do not:
- Send statement files, parsed portfolio records, or personal identifying data to any remote server or third-party service.

Source:
[`index.html`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/index.html) line 7, [`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js)

---

## DECISION-002 — Direct Summary Extraction for NPS Statements (v6)

Date:
2026-05-02

Decision:
Extract total invested amount, total current value, and scheme-level allocations directly from statement summary lines in the NPS PDF rather than recomputing them from individual historical transactions.

Reason:
NPS statements undergo complex fee adjustments, dividend reinvestments, tier-1 switches, and corporate matching that make recomputing net positions from transaction lines brittle and error-prone. The statement explicitly provides authoritative summary totals on line ~42 and scheme totals on lines ~48.

Alternatives considered:
- Recomputing running units and cost bases from transaction tables (implemented in earlier v1-v5 parsers, found to consistently drift from statement totals).

Do not:
- Re-implement transaction-based reconstruction for NPS invested/current value calculations.

Source:
[`js/nps-parser.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/nps-parser.js) lines 1–14; commit `b6de35a` ("Final changes").

---

## DECISION-003 — Content-Based Fingerprinting for Portfolio Deduplication

Date:
2026-07-12

Decision:
Deduplicate uploaded stock portfolios using an in-memory content hash (`instrument:qty:avgCost` sorted) rather than file names or upload timestamps.

Reason:
Users frequently upload files with generic default names like `holdings.csv` or `Holdings-2026.csv`. File-name matching would wrongly reject statements belonging to a different family member, while timestamp/random IDs would cause duplicate entries when the same statement was uploaded repeatedly.

Alternatives considered:
- Filename-based deduplication (rejected: causes collisions between different persons).
- No deduplication (rejected: duplicates holdings if user clicks upload multiple times).

Do not:
- Replace content-based fingerprinting with filename-only uniqueness checks.

Source:
[`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js) `holdingsFingerprint()`; commit `46be978` ("Update logic for Indian Stocks").

---

## DECISION-004 — Dual-Key LocalStorage Persistence Strategy

Date:
2026-04-22

Decision:
Persist unified application state in `foliosense_state` while maintaining synchronized fallback keys (`folio_savings`, `folio_foreign`, `folio_nsc`, `folio_epf`, `foliosense_goals_meta`, `foliosense_goals`, `folio_fund_returns`).

Reason:
Allows modular UI components in `ui.js` to update and persist specific sub-domains independently without creating merge conflicts, while allowing `loadState()` to cleanly revive data across older application revisions.

Alternatives considered:
- Single monolith key only (caused race conditions during initial refactor).
- Scattered independent keys only without unified backup export (made export/import brittle).

Do not:
- Remove individual storage keys without verifying both `ui.js` and `app.js` read/write parity.

Source:
[`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js) `saveState()` and `loadState()`.

---

## DECISION-005 — Rate-Limited External NAV Integration via api.mfapi.in

Date:
2026-04-24

Decision:
Fetch live mutual fund NAVs and historical 1Y/3Y returns from `https://api.mfapi.in/` with in-memory caching and a maximum concurrency of 3 requests per batch.

Reason:
Public Indian mutual fund NAVs are publicly available via AMFI codes and ISINs. Free public APIs have rate constraints; batching with concurrency limits prevents 429 Too Many Requests while keeping NAV data fresh.

Alternatives considered:
- Bundling static NAV tables with the app (rejected: goes stale immediately).
- Paid financial data provider API (rejected: unnecessary cost for personal tracker).

Do not:
- Fire unthrottled parallel HTTP requests for hundreds of AMFI codes simultaneously.

Source:
[`js/navfetch.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/navfetch.js) lines 10, 1227–1238; [`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js).
