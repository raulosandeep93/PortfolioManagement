---
trigger: glob
globs: "**/*.{js,html,css}"
description: "Coding rules for FolioSense client-side web application"
---

# FolioSense Coding Rules

## Architecture & Framework Constraints
- **Vanilla JavaScript Only**: Do not introduce React, Vue, Angular, or bundlers (Webpack, Vite) without explicit request.
- **Global IIFE Pattern**: Wrap all new JavaScript in `(function(global) { 'use strict'; ... })(window);` and expose clear namespaces to `global`.
- **Script Loading Order**: Scripts are executed in order in [`index.html`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/index.html). If introducing a new script, place it before `js/ui.js` and `js/app.js`.

## State & Persistence
- Always update state via `state` in [`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js) and call `saveState()`.
- Ensure date strings are revived using the reviver in `loadState()` when reading from `localStorage`.
- Maintain dual persistence: write to both `foliosense_state` and domain keys (`folio_savings`, `foliosense_goals`, etc.) to prevent data loss.

## Formatting & UI Helpers
- Never format currency or percentages manually with inline string interpolation.
- Use the standard helpers in [`js/ui.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/ui.js):
  - Currency: `fmt(amount)` → `₹1,23,456`
  - Percent: `fmtPct(val)` → `+12.34%`
  - XIRR: `fmtXIRR(val)` → `14.50%`
  - Units: `fmtUnits(units)` → `123.456`
  - NAV: `fmtNav(nav)` → `₹45.67`
  - Dates: `fmtDate(date)` → `26 Oct 2026`

## Styling & Theme Consistency
- All colors must reference CSS variables defined in [`style.css`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/style.css) (`var(--bg)`, `var(--card)`, `var(--green)`, `var(--red)`, `var(--text)`, `var(--text2)`, `var(--card-border)`).
- Never hardcode `#070b12` or other theme colors directly in component styles; doing so breaks light theme mode (`[data-theme='light']`).
