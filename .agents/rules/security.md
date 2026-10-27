---
trigger: glob
globs: "**/*"
description: "Security and data privacy rules for FolioSense"
---

# FolioSense Security & Privacy Rules

## Zero-Knowledge Client-Side Guarantee
- FolioSense guarantees that user financial data is 100% private and stays in the user's browser.
- **NEVER** add network requests that transmit portfolio holdings, account numbers, names, PAN, or transaction history to any remote server, analytics service, or third-party endpoint.
- Only outbound HTTP requests permitted are GET requests to `https://api.mfapi.in/` to fetch public mutual fund NAV prices and scheme metadata.

## Password & Credential Handling
- CAS and EPF statement passwords must be handled exclusively in transient memory (`_pwResolve` promise resolution in `js/app.js`).
- **NEVER** persist PDF passwords to `localStorage`, `sessionStorage`, cookies, or console logs.
- Never commit secrets, sample statements with real personal identifiable data (PII), or API keys to git.
