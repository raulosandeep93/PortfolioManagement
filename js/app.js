/**
 * app.js — FolioSense application orchestrator
 * Coordinates: upload → parse → fetch NAV → compute analytics → render
 */
(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════ STATE */
  const state = {
    portfolios:    [],   // parsed CAS data
    liveNavMap:    {},   // amfiCode → { nav, date, schemeName }
    activePerson:  null, // null = All, otherwise name string
    goalsMetadata: {},   // goalName → { targetAmount, targetDate }
    isDirtySinceExport: false,
  };

  const STORAGE_KEY_STATE = 'foliosense_state';

  function saveState() {
    try {
      const data = {
        portfolios: state.portfolios,
        liveNavMap: state.liveNavMap,
        goalsMetadata: state.goalsMetadata
      };
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
    } catch (e) { console.warn('Failed to save state:', e); }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATE);
      if (saved) {
        const parsed = JSON.parse(saved, (key, value) => {
          // Revive ISO date strings back into Date objects
          if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
            return new Date(value);
          }
          return value;
        });
        state.portfolios = parsed.portfolios || [];
        state.liveNavMap = parsed.liveNavMap || {};
        state.goalsMetadata = parsed.goalsMetadata || {};
        return true;
      }
    } catch (e) { console.warn('Failed to load state:', e); }
    return false;
  }

  /* ══════════════════════════════ PASSWORD MODAL MANAGEMENT */
  let _pwResolve = null;

  function promptPassword(filename) {
    return new Promise((resolve) => {
      _pwResolve = resolve;
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
  }

  /* ════════════════════════════════════════ PROCESS ONE FILE */
  async function processFile(file) {
    let password = '';
    let parsed   = null;
    let attempt  = 0;

    while (attempt < 5) {
      try {
        UI.setLoading(`Parsing ${file.name}…`, attempt === 0 ? 'Extracting text' : 'Retrying…', 10);
        parsed = await CASParser.parsePDF(file, password);
        break;
      } catch (err) {
        const msg = err?.message || String(err);
        if (msg.includes('password') || msg.includes('Password') || (err?.name === 'PasswordException')) {
          password = await promptPassword(file.name);
          if (password === '__SKIP__') return null;
          if (attempt > 0) document.getElementById('pw-error').style.display = '';
          attempt++;
        } else {
          UI.toast('error', 'Parse Error', `Could not read ${file.name}`);
          return null;
        }
      }
    }
    return parsed;
  }

  /* ═══════════════════════════════════════════════ FULL REFRESH */
  function refreshDashboard() {
    try {
      const hasData = state.portfolios.length > 0;
      UI.updateMFViewState(hasData);
      
      if (hasData) {
        // 1. Filter by person
        const filtered = state.activePerson 
          ? state.portfolios.filter(p => (p.investor?.name || 'Unknown') === state.activePerson)
          : state.portfolios;

        // 2. Compute Summary & Rows
        const summary = Analytics.computePortfolioSummary(filtered, state.liveNavMap);
        const rows    = UI.buildRows(filtered);

        // 3. Render
        UI.renderSummaryCards(summary);
        UI.renderCharts(rows);
        UI.renderTable(filtered, (row) => UI.openTransactionPanel(row));
        UI.renderPersonTabs(state.portfolios, state.activePerson);
      }
      
      // Update Overview Screen View
      UI.renderLandingPage(state);
      UI.updateBackupReminder(state.isDirtySinceExport);
      saveState();
    } catch (err) {
      console.error('Refresh Dashboard Error:', err);
    }
  }

  /* ═══════════════════════════════════════════ HANDLE NEW FILES */
  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (fileArr.length === 0) { UI.toast('warning', 'No PDFs', 'Please upload .pdf files.'); return; }

    UI.showLoading('Loading…', 'Preparing files', 0);
    const newPortfolios = [];

    for (let i = 0; i < fileArr.length; i++) {
        const parsed = await processFile(fileArr[i]);
        closePasswordModal();
        if (parsed) newPortfolios.push(parsed);
    }

    if (newPortfolios.length === 0) { UI.hideLoading(); return; }

    state.portfolios.push(...newPortfolios);
    UI.toast('success', 'Parsed!', `${newPortfolios.length} statement(s) loaded.`);

    // Fetch live NAV
    const schemes = UI.buildRows(state.portfolios);
    UI.setLoading('Fetching live NAV…', `Resolving ${schemes.length} units…`, 45);
    state.liveNavMap = await NavFetch.fetchAll(schemes);

    UI.hideLoading();
    state.isDirtySinceExport = true;
    refreshDashboard();
    UI.setScreen('mf'); // Switch to MF dashboard after upload
  }

  function setEvent(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
  }

  function setClick(id, handler) {
    const el = document.getElementById(id);
    if (el) el.onclick = handler;
  }

  /* ═════════════════════════════════════════════════ EVENT WIRING */
  function wireNavigation() {
    // Screen Tabs in Header
    setEvent('nav-screen-tabs', 'click', (e) => {
      const btn = e.target.closest('.screen-tab');
      if (!btn) return;
      UI.setScreen(btn.dataset.screen);
    });

    // Asset Cards / Buttons that trigger screen shifts
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('.btn-tab-trigger, .asset-card');
      if (trigger && trigger.dataset.target) {
        UI.setScreen(trigger.dataset.target);
      }
    });

    // MF Person Switching
    setEvent('nav-person-tabs', 'click', (e) => {
      const btn = e.target.closest('.person-tab');
      if (!btn) return;
      state.activePerson = btn.dataset.person;
      refreshDashboard();
    });
  }

  function wireActions() {
    // MF Upload Zone
    const dropZone  = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    if (dropZone && fileInput) {
      dropZone.onclick = () => fileInput.click();
    }
    
    setClick('browse-btn', (e) => { e.stopPropagation(); if (fileInput) fileInput.click(); });
    setClick('nav-add-btn', () => { UI.setScreen('mf'); if (fileInput) fileInput.click(); });

    if (fileInput) {
      fileInput.onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
    }

    // Debug
    setClick('nav-debug-btn', () => {
      const ds = document.getElementById('debug-section');
      if (ds) ds.style.display = ds.style.display === 'none' ? 'block' : 'none';
      // UI.populateDebug(state.portfolios); // If implemented
    });

    // Goals
    setClick('btn-manage-goals', () => {
      UI.openGoalManager(() => {
        state.isDirtySinceExport = true;
        UI.renderGoalsDashboard(state.portfolios);
        refreshDashboard();
      });
    });

    // Import/Export
    setClick('nav-export-btn', () => {
      UI.exportFullBackup(state);
      state.isDirtySinceExport = false;
      UI.updateBackupReminder(false);
    });
    
    setClick('nav-import-btn', () => {
      const impInput = document.getElementById('nav-import-input');
      if (impInput) impInput.click();
    });

    const navImpInput = document.getElementById('nav-import-input');
    if (navImpInput) {
      navImpInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => UI.importFullData(ev.target.result, () => {
          loadState();
          state.isDirtySinceExport = false; // Freshly imported data is not "dirty"
          refreshDashboard();
        });
        reader.readAsText(file);
        e.target.value = '';
      };
    }

    // Password Modal
    setClick('pw-submit', () => {
      const pwEl = document.getElementById('pw-input');
      const pw = pwEl ? pwEl.value.trim() : '';
      if (_pwResolve) { _pwResolve(pw); closePasswordModal(); }
    });
    
    setClick('pw-skip', () => {
      if (_pwResolve) { _pwResolve('__SKIP__'); closePasswordModal(); }
    });

    // Transaction Panel
    setClick('txn-panel-close', () => UI.closeTransactionPanel());
    setClick('panel-overlay', () => UI.closeTransactionPanel());
    
    // Sort & Table
    UI.initTableSort(state, (row) => UI.openTransactionPanel(row));
  }

  function init() {
    try {
      loadState();
      window.appState = state; // Shared with UI

      wireNavigation();
      wireActions();

      document.getElementById('nav-screen-tabs').style.display = 'flex';
      
      // Initial routing
      UI.setScreen('overview');
      refreshDashboard();

      // Auto NAV refresh
      if (state.portfolios.length > 0) {
        NavFetch.fetchAll(UI.buildRows(state.portfolios)).then(map => {
          state.liveNavMap = map;
          refreshDashboard();
        }).catch(err => {
          console.error('NAV Refresh Error:', err);
        });
      }
    } catch (err) {
      console.error('FolioSense Init Error:', err);
      // Fallback
      UI.setScreen('overview');
    }

    // Tab Closure Warning
    window.addEventListener('beforeunload', (e) => {
      if (state.isDirtySinceExport && state.portfolios.length > 0) {
        e.preventDefault();
        e.returnValue = ''; // Required for Chrome
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

  global._FolioSense = state;
})(window);
