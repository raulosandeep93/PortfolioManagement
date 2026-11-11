# Changelog — FolioSense

All notable developments and architectural milestones for FolioSense.

---

## 2026-11-12

### Added
- Goal deletion functionality on the Goals screen (`UI.deleteGoal` in `js/ui.js`):
  - Added delete option (`🗑️`) to each Goal card header.
  - Confirmation prompt before deletion.
  - Cascading unlinking across all tagged asset classes (MFs, NPS, Stocks, Bank Savings, Barclays Foreign Equities, NSC, EPF).
  - Clean state persistence to `localStorage` and dirty state indicator for backups.
  - Immediate responsive UI refresh including fallback to empty state when all goals are removed.
- Enhanced `UI.openGoalManager` to trigger immediate goal dashboard re-render when a new goal is added.
- **Goal data now persists correctly across page reloads**:
  - Rewrote `getGoalsMeta()` and `getGoalsMap()` in `js/ui.js` to always merge `localStorage` data with in-memory `appState` — prevents any source overwriting the other.
  - Added `mergeGoalsMetadata()` helper: when both storage sources exist, the entry with a real `targetAmount > 0` wins, preventing blank defaults from overwriting user-entered values.
  - Rewrote `loadGoalsMetadata()` and `loadGoalsMap()` in `js/app.js` using the same smart-merge logic during boot — covers the edge case where `foliosense_state` blob was written before goal details were filled in.
  - `saveGoal()` now auto-registers a `goalsMetadata` stub for newly typed goal names, ensuring the entry is always present so details typed later are never orphaned.
  - Goal card input fields now also trigger `saveGoalMeta` on `input` and `change` events (not only `blur`) and recalculate card projections live without requiring a full re-render.
  - Added `beforeunload` flush handler in `js/ui.js` to persist any in-flight goal field edits if the user refreshes mid-typing.

## 2026-10-26

### Added
- Persistent AI operating context system (`AGENTS.md`, `docs/ai/*`, `.agents/rules/*`).
- Operating guidelines for zero-rediscovery AI coding sessions.

### Architecture
- Established repository-as-source-of-truth documentation pattern.

---

## 2026-07-12

### Added
- Goal metadata tracking and allocation linking in `js/app.js` and `js/ui.js`.
- Savings account, FD, and RD modal handling with maturity value tracking.
- Content-based fingerprinting for Indian Stock portfolios (`holdingsFingerprint`).

### Changed
- Updated Indian Stocks portfolio rendering and table calculations.
- Synchronized goal persistence between `ui.js` and `app.js` using shared localStorage keys.

### Fixed
- Fixed duplicate stock portfolio bug caused by re-importing statements.

---

## 2026-05-02

### Changed
- Migrated NPS Parser to v6 architecture: directly extracts summary values (total value, contributions, scheme amounts) from statement lines instead of recomputing from transaction rows.
- Polished UI layout, theme switching, and responsive table display in `style.css` and `index.html`.

### Fixed
- Fixed invested amount discrepancies in NPS statement parsing.
- Corrected CAMS/KFintech CAS transaction balance calculations.

---

## 2026-04-24

### Added
- Live fund performance history integration (1-year and 3-year returns) via `api.mfapi.in`.
- Concurrency-controlled batching for NAV return history fetching.
- Portfolio advice and fund performance indicators in Mutual Funds view.

### Changed
- Improved ISIN-to-AMFI code resolution for Demat CAS statements.

---

## 2026-04-23

### Added
- EPFO Passbook PDF parser (`js/epf-parser.js`) to parse employee and employer shares, interest credits, and pension balances.
- EPF screen and data visualization in UI.

---

## 2026-04-22

### Added
- Multi-asset dashboard expansion: Bank Savings, NSC, EPF, and Foreign Equities.
- Barclays ESOP / SVP award statement parser (`js/barclays-parser.js`) supporting PDF and Excel files via SheetJS.
- Dual-key `localStorage` persistence layer.

---

## Initial Release

### Added
- CAMS and KFintech CAS PDF statement parser (`js/parser.js`).
- Newton-Raphson XIRR computation engine (`js/analytics.js`).
- AMFI live NAV integration (`js/navfetch.js`).
- Dark theme styling system (`style.css`).
- Offline-first architecture with JSON backup export and import.
