# FolioSense — AI Operating Manual

`FolioSense` is a private, client-side financial portfolio tracker and analyzer running completely in the browser.

---

## PROJECT ORIENTATION

Before exploring source code, consult the persistent AI documentation:

- **Project Context**: [`docs/ai/PROJECT_CONTEXT.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/PROJECT_CONTEXT.md) — Tech stack, purpose, commands, directory structure, constraints.
- **Current State**: [`docs/ai/CURRENT_STATE.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CURRENT_STATE.md) — Current implementation status, recent changes, active focus, known issues.
- **Architecture**: [`docs/ai/ARCHITECTURE.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/ARCHITECTURE.md) — System modules, data flow, parsers, state model, rendering layer.
- **Decisions**: [`docs/ai/DECISIONS.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/DECISIONS.md) — Architectural decisions, rationale, alternatives considered, constraints.
- **TODO**: [`docs/ai/TODO.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/TODO.md) — Known roadmap items, technical debt, verified backlog.
- **Changelog**: [`docs/ai/CHANGELOG.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CHANGELOG.md) — AI-oriented development milestones.
- **Scoped Rules**: [`.agents/rules/`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/.agents/rules/) — Scoped coding, testing, and security rules.

---

## MANDATORY STARTUP PROCEDURE

Every AI agent starting a task MUST follow these steps in order:

1. Read [`AGENTS.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/AGENTS.md) (this document).
2. Read [`docs/ai/PROJECT_CONTEXT.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/PROJECT_CONTEXT.md).
3. Read [`docs/ai/CURRENT_STATE.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CURRENT_STATE.md).
4. Run `git status` to verify working tree status and avoid touching uncommitted user changes.
5. Identify the smallest relevant set of files for the user request.
6. Inspect only those specific files.
7. Make the smallest appropriate change.

---

## REPOSITORY EXPLORATION RULES

- **DO NOT scan the entire repository by default.**
- **DO NOT read unrelated files.**
- **DO NOT repeatedly rediscover architecture** already documented in `docs/ai/`.
- Prefer targeted file inspection using line ranges or symbol queries.
- Use existing documentation in `docs/ai/` before inspecting source code.
- Consult `git log` only when historical commit context is necessary for understanding a decision.
- Expand repository exploration only when the task strictly requires cross-cutting changes.

---

## CODING RULES

- **Vanilla JavaScript Only**: No framework (React, Vue, Angular) or bundler (Webpack, Vite) unless explicitly requested by the user.
- **IIFE Module Pattern**: Code is organized into Immediately Invoked Function Expressions exporting explicit namespaces to `window` (e.g. `window.Analytics`, `window.UI`, `window.CASParser`, `window.NavFetch`).
- **Script Order Matters**: Scripts in [`index.html`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/index.html) load in a strict dependency sequence:
  `PDF.js` → `Chart.js` → `SheetJS` → `analytics.js` → `navfetch.js` → parsers (`parser.js`, `nps-parser.js`, `zerodha-parser.js`, `barclays-parser.js`, `epf-parser.js`) → `ui.js` → `app.js`.
- **Preserve Design System**: UI styling uses pure CSS custom properties (`:root` dark theme, `[data-theme='light']` light theme) defined in [`style.css`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/style.css). Do not introduce ad-hoc utility classes or inline color hexes where CSS variables exist.
- **State Synchronization**: State changes must go through `saveState()` in [`js/app.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/app.js) and preserve both the primary `foliosense_state` object and legacy individual `localStorage` keys for backward compatibility.
- **Format Consistency**: Always use formatting helpers in [`js/ui.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/ui.js) (`fmt`, `fmtPct`, `fmtXIRR`, `fmtUnits`, `fmtNav`, `fmtDate`) for currency and percentages.

---

## DEBUGGING RULES

When fixing a bug:

1. **Understand/reproduce**: Identify which screen, parser, or calculation produces the error.
2. **Trace the data flow**: Follow data from file parsing → state normalization → analytics computation → UI render.
3. **Determine root cause**: Check date parsing, NaN/undefined number conversion, or parser regex tokens.
4. **Make the smallest safe change**: Fix the issue without modifying unaffected parsers or UI components.
5. **Test the change**: Verify in browser with test data.
6. **Document discoveries**: Note non-obvious fixes in [`docs/ai/CURRENT_STATE.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CURRENT_STATE.md).

---

## TESTING RULES

There is no automated test runner configured in this repository.

- **Dev Server**: Run `npm start` (or `npx serve . -p 3000`) and test in a browser.
- **Targeted Verification**: When editing parsers, test with sample PDFs/CSVs matching the specific format.
- **Math Verification**: When modifying [`js/analytics.js`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/js/analytics.js), ensure Newton-Raphson XIRR converges on irregular cash flows and returns `null` safely on invalid dates or fewer than 2 flows.
- **Console Check**: Always check browser console for uncaught errors, unhandled rejections, or parse warnings.

---

## GIT RULES

- Never run destructive git commands: `git reset --hard`, `git clean -fd`, `git checkout -- .`.
- Do not commit secrets, test statements containing real financial or personal data, or OS junk files.
- Preserve existing uncommitted user changes.
- Always check `git status` and `git diff` before and after edits.

---

## SECURITY & PRIVACY RULES

- **100% Client-Side Privacy**: FolioSense is designed as a zero-knowledge, offline-capable dashboard. Never send user portfolio data, PAN, transactions, or statement contents to external servers.
- **External Outbound Calls**: The only permitted external network calls are to `https://api.mfapi.in/` for public mutual fund NAVs and scheme metadata.
- **Password Handling**: CAS PDF passwords must exist in ephemeral memory only (`_pwResolve` in `app.js`) to unlock the PDF and MUST NEVER be stored in `localStorage` or transmitted over the wire.
- **No Hard-Coded Secrets**: Never commit API keys or credentials.

---

## DOCUMENTATION RULES

- Update [`docs/ai/DECISIONS.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/DECISIONS.md) when architectural designs or library choices are made.
- Update [`docs/ai/CURRENT_STATE.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CURRENT_STATE.md) when the state of development materially changes.
- Keep documentation concise and token-efficient. Do not copy code blocks into documentation.

---

## AI SESSION HANDOFF

Before ending a substantial coding session:

1. Review changed files via `git status` and `git diff`.
2. Verify application integrity by serving locally and checking browser behavior.
3. Update [`docs/ai/CURRENT_STATE.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CURRENT_STATE.md) with what was completed, active focus, and known issues.
4. Update [`docs/ai/DECISIONS.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/DECISIONS.md) if an architectural decision was established.
5. Update [`docs/ai/CHANGELOG.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/CHANGELOG.md) if user-facing features or major fixes were released.
6. Update [`docs/ai/TODO.md`](file:///home/anisha/Desktop/Sandeep/PortfolioManagement/docs/ai/TODO.md) if backlog items were completed or genuine new items were discovered.
