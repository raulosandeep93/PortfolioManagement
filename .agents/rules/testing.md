---
trigger: glob
globs: "js/**/*.js"
description: "Testing and verification rules for FolioSense calculations and parsers"
---

# FolioSense Testing & Verification Rules

## Testing Environment
- There is no automated test runner configured in `package.json`.
- Run `npm start` (or `npx serve . -p 3000`) and verify changes in a web browser.
- Open DevTools Console and verify:
  1. No uncaught runtime exceptions.
  2. No 404/CORS network errors.
  3. No unhandled promise rejections during PDF parsing or NAV fetching.

## Parser Verification
- When modifying any parser in `js/`:
  - Verify that column headers handle case variations (e.g., `avg. cost`, `avg cost`, `Average`).
  - Verify number cleaning handles Indian number formatting (`1,00,000.00`), parentheses for negative numbers `(100.00)`, and empty cells.
  - Verify date parsing handles DD-MMM-YYYY, DD/MM/YYYY, and month name variations.
  - Test with both encrypted (password-protected) and unencrypted sample files if applicable.

## Mathematical Computations (`analytics.js`)
- XIRR must handle edge cases gracefully:
  - Fewer than 2 cash flows: return `null`.
  - Cash flows with invalid dates: warn and return `null`.
  - Cash flows with all positive or all negative amounts: return `null` without infinite loops.
  - Newton-Raphson must use multiple initial guess rates (`0.1, 0.5, 1.5, -0.05, 0.01`) and cap iterations at 1000.
