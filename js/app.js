/**
 * app.js — FolioSense application orchestrator
 * Coordinates: upload → parse → fetch NAV → compute analytics → render
 */
(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════ STATE */
  const state = {
    portfolios:    [],   // parsed CAS data, one per uploaded file
    liveNavMap:    {},   // amfiCode → { nav, date, schemeName }
    activePersonIdx: -1, // -1 = combined view
    pendingFiles:  [],   // queue for password modal
    currentFileIdx: 0,
  };

  /* ══════════════════════════════ PASSWORD MODAL MANAGEMENT */
  let _pwResolve = null;
  let _pwReject  = null;

  function promptPassword(filename) {
    return new Promise((resolve, reject) => {
      _pwResolve = resolve;
      _pwReject  = reject;

      document.getElementById('pw-filename').textContent = filename;
      document.getElementById('pw-input').value          = '';
      document.getElementById('pw-error').style.display  = 'none';
      document.getElementById('password-modal').style.display = 'flex';
      document.getElementById('pw-input').focus();
    });
  }

  function closePasswordModal() {
    document.getElementById('password-modal').style.display = 'none';
    _pwResolve = null;
    _pwReject  = null;
  }

  /* ════════════════════════════════════════ PROCESS ONE FILE */
  async function processFile(file) {
    let password = '';
    let parsed   = null;
    let attempt  = 0;

    while (attempt < 5) {
      try {
        UI.setLoading(
          `Parsing ${file.name}…`,
          attempt === 0 ? 'Extracting text from PDF' : 'Retrying with password…',
          10
        );
        parsed = await CASParser.parsePDF(file, password);
        break; // success
      } catch (err) {
        const msg = err?.message || String(err);

        // PDF.js throws PasswordException for wrong/missing password
        if (msg.includes('password') || msg.includes('Password') || (err?.name === 'PasswordException')) {
          try {
            password = await promptPassword(file.name);
            if (password === '__SKIP__') return null; // user skipped
            // Show wrong password error on retry
            if (attempt > 0) {
              document.getElementById('pw-error').style.display = '';
            }
            attempt++;
          } catch (_) {
            return null; // modal dismissed
          }
        } else {
          UI.toast('error', 'Parse Error', `Could not read ${file.name}: ${msg.slice(0,100)}`);
          return null;
        }
      }
    }

    if (!parsed) return null;

    // Basic sanity: warn if no folios found
    const totalSchemes = (parsed.folios || []).reduce((s, f) => s + (f.schemes || []).length, 0);
    if (totalSchemes === 0) {
      UI.toast('warning', 'No Holdings Found',
        `${file.name} was parsed but no fund holdings were detected. ` +
        'Please ensure this is a "Detailed" CAS (not Summary) from CAMS/KFintech.');
    }

    return parsed;
  }

  /* ═══════════════════════════════════════════ COLLECT SCHEMES */
  // Returns flat list of {amfiCode, name, isin} — needed for AMFI search in demat PDFs
  function collectSchemes(portfolios) {
    const seen = new Map(); // key → scheme ref
    for (const p of portfolios)
      for (const f of (p.folios || []))
        for (const s of (f.schemes || [])) {
          const key = s.amfiCode || s.isin || s.name;
          if (key && !seen.has(key)) seen.set(key, s);
        }
    return [...seen.values()];
  }

  /* ═══════════════════════════════════════════════ FULL REFRESH */
  async function refreshDashboard() {
    const portfolios = state.portfolios;
    if (portfolios.length === 0) { UI.showUpload(); return; }

    // Compute analytics (uses already-fetched live NAV map)
    UI.setLoading('Computing analytics…', 'Calculating XIRR for each fund', 80);

    const summary = Analytics.computePortfolioSummary(portfolios, state.liveNavMap);

    // Filter portfolios for active person tab
    const displayPortfolios = state.activePersonIdx === -1
      ? portfolios
      : [portfolios[state.activePersonIdx]];

    UI.showDashboard();
    UI.renderSummaryCards(summary);
    UI.renderPersonTabs(portfolios, state.activePersonIdx, (idx) => {
      state.activePersonIdx = idx;
      refreshDashboard();
    });

    // Table
    UI.renderTable(displayPortfolios, state.activePersonIdx, (row) => {
      UI.openTransactionPanel(row);
    });
    UI.initTableSort(displayPortfolios, (row) => UI.openTransactionPanel(row));

    // Charts (use display portfolios)
    const chartRows = UI.buildRows(displayPortfolios);
    UI.renderCharts(chartRows);

    // Reveal multi-person filter column
    const pTh = document.querySelector('.th-person');
    if (pTh) pTh.style.display = portfolios.length > 1 ? '' : 'none';
    const pFilter = document.getElementById('table-filter-person');
    if (pFilter) pFilter.style.display = portfolios.length > 1 ? '' : 'none';

    UI.hideLoading();
  }

  /* ═══════════════════════════════════════════ HANDLE NEW FILES */
  async function handleFiles(files) {
    if (!files || files.length === 0) return;

    const fileArr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (fileArr.length === 0) {
      UI.toast('warning', 'No PDFs', 'Please upload .pdf files.');
      return;
    }

    UI.showLoading('Loading…', 'Preparing files', 0);

    const newPortfolios = [];

    for (let i = 0; i < fileArr.length; i++) {
      const file = fileArr[i];
      UI.setLoading(
        `Parsing file ${i+1} of ${fileArr.length}`,
        file.name,
        Math.round((i / fileArr.length) * 40)
      );
      const parsed = await processFile(file);
      closePasswordModal();
      if (parsed) newPortfolios.push(parsed);
    }

    if (newPortfolios.length === 0) {
      UI.hideLoading();
      UI.toast('error', 'No Data', 'No portfolios could be loaded.');
      return;
    }

    // Merge into state
    state.portfolios.push(...newPortfolios);
    UI.toast('success', 'Parsed!',
      `${newPortfolios.length} statement${newPortfolios.length > 1 ? 's' : ''} loaded.`);

    // Fetch live NAV (also resolves AMFI codes for demat PDFs via name search)
    const schemes = collectSchemes(state.portfolios);
    UI.setLoading('Fetching live NAV…', `Resolving ${schemes.length} funds…`, 45);

    state.liveNavMap = await NavFetch.fetchAll(schemes, (done, total) => {
      const pct = 45 + Math.round((done / total) * 35);
      UI.setLoading(null, `NAV ${done}/${total}`, pct);
    });

    const navCount = Object.keys(state.liveNavMap).length;
    UI.toast('info', 'Live NAV Ready', `Fetched live prices for ${navCount} of ${schemes.length} funds.`);

    await refreshDashboard();
  }

  /* ════════════════════════════════════════════ POPULATE DEBUG */
  function populateDebug(portfolios) {
    const schemesEl = document.getElementById('debug-schemes');
    const linesEl   = document.getElementById('debug-lines');
    if (!schemesEl || !linesEl) return;

    let schemeTxt = '';
    portfolios.forEach((p, pi) => {
      schemeTxt += `=== Portfolio ${pi+1}: ${p.investor?.name || p._filename} ===\n`;
      schemeTxt += `File type: ${p.fileType}  |  Pages: ${p._pageCount}\n`;
      schemeTxt += `Period: ${p.statementPeriod?.from?.toLocaleDateString('en-IN')||'?'} → ${p.statementPeriod?.to?.toLocaleDateString('en-IN')||'?'}\n\n`;
      (p.folios||[]).forEach((f, fi) => {
        schemeTxt += `  Folio ${fi+1}: ${f.folio}  [${f.amc}]\n`;
        (f.schemes||[]).forEach((s, si) => {
          schemeTxt += `    Scheme ${si+1}: ${s.name}\n`;
          schemeTxt += `      ISIN: ${s.isin||'–'}  AMFI: ${s.amfiCode||'–'}\n`;
          schemeTxt += `      Units: ${s.closingUnits}  NAV: ${s.valuation?.nav||'–'}  Value: ${s.valuation?.value||'–'}\n`;
          schemeTxt += `      Transactions: ${s.transactions?.length||0}\n`;
        });
      });
      schemeTxt += '\n';
    });
    schemesEl.textContent = schemeTxt || 'No schemes detected.';

    // Raw lines from last parsed portfolio
    const last = portfolios[portfolios.length - 1];
    if (last?._rawLines) {
      linesEl.textContent = last._rawLines.slice(0,80).map((l,i)=>`${String(i).padStart(3)}: ${l}`).join('\n');
    }
  }

  /* ═════════════════════════════════════════════════ EVENT WIRING */
  function init() {
    /* ── Drop zone ────────────────────────────────────────────── */
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    dropZone.addEventListener('click', () => fileInput.click());
    document.getElementById('browse-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
    document.getElementById('nav-add-btn').addEventListener('click', () => fileInput.click());

    /* ── Debug toggle ──────────────────────────────────────────── */
    document.getElementById('nav-debug-btn').addEventListener('click', () => {
      const ds = document.getElementById('debug-section');
      const visible = ds.style.display !== 'none';
      ds.style.display = visible ? 'none' : '';
      populateDebug(state.portfolios);
    });

    fileInput.addEventListener('change', (e) => {
      handleFiles(e.target.files);
      fileInput.value = ''; // reset so same file can be re-uploaded
    });

    // Drag-and-drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      handleFiles(e.dataTransfer.files);
    });

    // Keyboard enter on drop zone
    dropZone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });

    /* ── Password modal ───────────────────────────────────────── */
    document.getElementById('pw-submit').addEventListener('click', () => {
      const pw = document.getElementById('pw-input').value.trim();
      if (_pwResolve) { _pwResolve(pw); closePasswordModal(); }
    });
    document.getElementById('pw-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('pw-submit').click();
    });
    document.getElementById('pw-skip').addEventListener('click', () => {
      if (_pwResolve) { _pwResolve('__SKIP__'); closePasswordModal(); }
    });

    /* ── Transaction panel close ──────────────────────────────── */
    document.getElementById('txn-panel-close').addEventListener('click',
      () => UI.closeTransactionPanel());
    document.getElementById('panel-overlay').addEventListener('click',
      () => UI.closeTransactionPanel());

    /* ── Table search + filter ────────────────────────────────── */
    ['table-search', 'table-filter-cat', 'table-filter-person'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => {
        const displayPortfolios = state.activePersonIdx === -1
          ? state.portfolios
          : [state.portfolios[state.activePersonIdx]];
        UI.renderTableBody(displayPortfolios, (row) => UI.openTransactionPanel(row));
      });
    });

    /* ── Keyboard shortcuts ───────────────────────────────────── */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        UI.closeTransactionPanel();
        closePasswordModal();
      }
    });

    /* ── Focus search with Ctrl+K or / ───────────────────────── */
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey && e.key === 'k') || e.key === '/') {
        const searchEl = document.getElementById('table-search');
        if (searchEl && document.getElementById('dashboard-screen').style.display !== 'none') {
          e.preventDefault();
          searchEl.focus();
          searchEl.select();
        }
      }
    });
  }

  /* ═════════════════════════════════════════════════════ BOOT */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  global._FolioSense = state;

})(window);
