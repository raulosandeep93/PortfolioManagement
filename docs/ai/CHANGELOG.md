# Changelog — FolioSense

All notable developments and architectural milestones for FolioSense.

---

## 2026-11-13 (Session 2)

### Changed
- **Manual holder tagging for Mutual Funds and NPS** — removed auto-detection of holder from parsed documents:
  - MF: Added "Uploaded Statements" table (`#mf-statements-section`) below the holdings card grid. Each uploaded CAS portfolio shows its filename, an inline holder input, active scheme count, invested/current values, and a delete (🗑️) button.
  - NPS: Each uploaded NPS statement is now wrapped in a styled block with a filename header and an inline "Tag holder..." input, before listing its tier tables below.
  - Person/holder is now **always manually assigned** for MF and NPS. `investor.name` and `subscriberName` from parsers are no longer used for person identification in the UI layer.
  - `getAllPersonNames()`, `buildRows()`, `filterRows()`, `renderLandingPage()`, and `refreshDashboard()` all updated to use `p.holder` for MF and NPS.
  - Added `mf-statements-tbody` onchange/click delegation in `app.js` for real-time holder updates and MF portfolio deletion.
  - Added `nps-tiers-container` change delegation in `app.js` for real-time NPS holder updates (uses `indexOf` to resolve correct state index even when displayed list is person-filtered).

## 2026-11-13 (Session 1)

### Added
- **Global Portfolio Segregation by Person / Holder across all asset categories**:
  - Mutual Funds, NPS, Indian Stocks, Foreign Equities (Barclays), Bank Savings (Accounts, FDs, RDs), NSC, and EPF can now be tagged and segregated by person/holder.
  - Dedicated sticky `#person-bar` below the primary navigation containing multi-person selector pills (`🔗 All Portfolios`, individual person tabs with personalized color accents).
  - Person filtering is universally active across all screens: Overview, Goals, Mutual Funds, NPS, Indian Stocks, Foreign Equities, Bank Savings, NSC, and EPF.
  - Added inline `.holder-input` fields with global datalist autocomplete across all tables (Stocks, Statements, Bank Accounts, FDs, RDs, Barclays Grants, NSC, EPF).
  - Added Person/Holder input fields to all manual asset creation modals (`savings-modal`, `esop-modal`, `nsc-modal`, `epf-modal`), pre-filled with the active person.
- **Full Backup Export/Import with Complete Person Segregation**:
  - `exportFullBackup` now exports complete person segregation metadata (`metadata.persons`, version `1.1`) and preserves holder tags for every holding across all asset classes.
  - `importFullData` seamlessly restores segregated portfolios and reinstates person tabs on reload.

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
