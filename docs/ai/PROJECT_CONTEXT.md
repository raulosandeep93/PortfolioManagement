# Project Context — FolioSense

## Project Overview

- **Name**: FolioSense (`mutual-fund-portfolio-analyzer`)
- **Purpose**: Privacy-first, client-side personal wealth & multi-asset financial portfolio dashboard. Analyzes Consolidated Account Statements (CAS), stock exports, retirement funds (NPS, EPF), savings, and goal allocations with accurate XIRR calculations and live NAV fetching.
- **Target Users**: Individual investors and families tracking their multi-asset Indian and foreign investments without uploading sensitive financial statements to third-party cloud servers.
- **Platform**: Web browsers (Chromium, Firefox, Safari, Edge). Runs locally or statically hosted.

---

## Technology Stack

- **Runtime / Language**: Vanilla JavaScript (ES6+ modular IIFE patterns, browser-native DOM APIs).
- **Structure & Styling**: Semantic HTML5 and Vanilla CSS3 using custom CSS variables / design tokens. Dark theme (default) and Light theme (`[data-theme='light']`).
- **External Dependencies (Loaded via CDN in `index.html`)**:
  - `pdf.js` (`3.11.174` via cdnjs) — Client-side PDF text extraction and web worker.
  - `chart.js` (`4.4.0` via jsDelivr) — Interactive charts and portfolio visual breakdown.
  - `xlsx` (`0.18.5` via jsDelivr) — Client-side Excel workbook parsing for equity grants.
- **External APIs**:
  - `https://api.mfapi.in/` — Public open API used to fetch live mutual fund NAVs and historical NAVs for 1Y/3Y returns.
- **Storage**: Browser `localStorage` (unified key `foliosense_state` + legacy keys) and client-side JSON export/import for backups.
- **Local Dev Server**: Node.js `serve` (`npx serve . -p 3000`). No bundler or transpiler required.

---

## High-Level Architecture

FolioSense operates as a single-page application (SPA) with a unidirectional data lifecycle:

1. **Input & Ingestion**: User uploads PDF/CSV/Excel statements or manually inputs data.
2. **Parsing**: Dedicated format parsers (`parser.js`, `nps-parser.js`, `zerodha-parser.js`, `barclays-parser.js`, `epf-parser.js`) extract and normalize records into standardized in-memory holdings.
3. **Market Enrichment**: `navfetch.js` hits `api.mfapi.in` to retrieve current NAV prices and fund performance metrics.
4. **Analytics**: `analytics.js` calculates XIRR (Newton-Raphson method), net worth, unrealized P&L, asset allocation, and goal target progress.
5. **State Management**: `app.js` holds central `state`, triggers renders, and persists state to `localStorage`.
6. **Rendering**: `ui.js` handles tab navigation, table generation, modal dialogues, toast notifications, and Chart.js instances.

---

## Important Directories & Files

```text
.
├── index.html              # Main HTML entry point, layout, screens, CDN script includes
├── style.css               # Complete styling system, CSS custom properties, dark/light themes
├── package.json            # Node metadata and development serve script
├── js/
│   ├── app.js              # Application orchestrator, state store, event wiring, persistence
│   ├── ui.js               # UI rendering, DOM updating, modal/toast/chart lifecycle, formatters
│   ├── analytics.js        # Newton-Raphson XIRR calculation, metrics & portfolio aggregations
│   ├── navfetch.js         # API integration for api.mfapi.in (live NAV & return history)
│   ├── parser.js           # CAMS & KFintech CAS PDF parser (detailed & demat)
│   ├── nps-parser.js       # National Pension System statement PDF parser (v6 direct extraction)
│   ├── zerodha-parser.js   # Zerodha Kite Holdings CSV parser
│   ├── barclays-parser.js  # Barclays ESOP / SVP Statement parser (PDF/Excel)
│   └── epf-parser.js       # EPFO passbook PDF parser
├── docs/ai/                # AI context, architecture, decisions, and handoff documentation
└── .agents/rules/          # Scoped rules for AI coding agents
```

---

## Important Commands

- **Install**: No dependencies to install (`package.json` contains no runtime `dependencies`).
- **Start / Dev Server**:
  ```bash
  npm start
  # or
  npm run dev
  # or
  npx serve . -p 3000
  ```
- **Build**: No build step. The application is served as static files directly.
- **Lint / Format**: None configured. Adhere to existing code conventions.
- **Test**: Manual browser verification (see [`docs/ai/TODO.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/TODO.md) regarding automated test runners).

---

## Important Constraints

1. **Zero Server / Complete Privacy**: Financial statements must never leave the user's browser. No telemetry or analytics trackers collecting financial data.
2. **Browser Storage Limits**: `localStorage` typically has a 5MB to 10MB quota. State is kept lean (parsed summaries rather than raw PDF binary blobs).
3. **No Build Step**: Files are directly referenced in `index.html`. Do not introduce JSX, TypeScript, or ES modules without discussing architecture changes.
4. **Script Execution Order**: Because modules attach to `global` (`window`), script tags in `index.html` must remain in strict dependency order.
5. **PDF Passwords**: Passwords entered for encrypted CAS/EPF statements must remain in memory during decryption and never be saved to persistent storage.

---

## Development Philosophy

- **Small, Targeted Edits**: Changes should be localized to the affected parser, calculation, or UI component.
- **Defensive Parsing**: Financial statement formats vary between institutions and evolve over time; parsers use flexible regex and defensive fallbacks.
- **Consistent Tokens**: Color and layout variables defined in `style.css` must be reused across screens.
