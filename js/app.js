/**
 * app.js — FolioSense application orchestrator
 * Coordinates: upload → parse → fetch NAV → compute analytics → render
 */
(function (global) {
  'use strict';

  /* ══════════════════════════════════════════════════════ STATE */
  const state = {
    portfolios:    [],   // parsed CAS data
    npsPortfolios: [],   // parsed NPS data
    stocksPortfolios: [],// parsed Indian Stocks data
    savings: { accounts: [], fds: [], rds: [] }, // manual bank entries
    foreignEquities: { 
      barclays: { grants: [] } 
    },
    nsc: [],
    epf: [],
    liveNavMap:    {},   // amfiCode → { nav, date, schemeName }
    activePerson:  null, // null = All, otherwise name string
    goalsMetadata: {},   // goalName → { targetAmount, targetDate }
    goals: {},           // key → goalName mapping
    fundReturnsMap: {},   // amfiCode → { oneYear, threeYear }
    isDirtySinceExport: false,
  };

  const STORAGE_KEY_STATE = 'foliosense_state';

  function saveState() {
    try {
      const data = {
        portfolios: state.portfolios,
        npsPortfolios: state.npsPortfolios,
        stocksPortfolios: state.stocksPortfolios,
        savings: state.savings,
        foreignEquities: state.foreignEquities,
        nsc: state.nsc,
        epf: state.epf,
        liveNavMap: state.liveNavMap,
        goalsMetadata: state.goalsMetadata,
        goals: state.goals,
        fundReturnsMap: state.fundReturnsMap,
      };
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(data));
      localStorage.setItem('folio_savings', JSON.stringify(state.savings));
      localStorage.setItem('folio_foreign', JSON.stringify(state.foreignEquities));
      localStorage.setItem('folio_nsc', JSON.stringify(state.nsc));
      localStorage.setItem('folio_epf', JSON.stringify(state.epf));
      localStorage.setItem('folio_goals_meta', JSON.stringify(state.goalsMetadata));
      localStorage.setItem('folio_fund_returns', JSON.stringify(state.fundReturnsMap));
    } catch (e) { console.warn('Failed to save state:', e); }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATE);
      
      const reviver = (key, value) => {
        // Revive ISO date strings back into Date objects
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          return new Date(value);
        }
        return value;
      };

      let parsed = {};
      if (saved) {
        parsed = JSON.parse(saved, reviver);
      }

      // Helper to load from main parsed or fallback to legacy key
      const load = (key, legacyKey, defaultVal) => {
        const isDefault = (val) => {
          if (!val) return true;
          if (Array.isArray(val)) return val.length === 0;
          if (typeof val === 'object') {
            if (Object.keys(val).length === 0) return true;
            if (key === 'savings' && !val.accounts?.length && !val.fds?.length && !val.rds?.length) return true;
            if (key === 'foreignEquities' && !val.barclays?.grants?.length) return true;
          }
          return false;
        };

        const fromMain = parsed[key];
        if (fromMain !== undefined && !isDefault(fromMain)) return fromMain;

        try {
          const legacy = localStorage.getItem(legacyKey);
          if (legacy) {
            const parsedLegacy = JSON.parse(legacy, reviver);
            if (!isDefault(parsedLegacy)) return parsedLegacy;
          }
        } catch(e) {}
        
        return fromMain || defaultVal;
      };

      state.portfolios = parsed.portfolios || [];
      state.npsPortfolios = parsed.npsPortfolios || [];
      state.stocksPortfolios = parsed.stocksPortfolios || [];
      state.liveNavMap = parsed.liveNavMap || {};
      
      state.savings = load('savings', 'folio_savings', { accounts: [], fds: [], rds: [] });
      state.foreignEquities = load('foreignEquities', 'folio_foreign', { barclays: { grants: [] } });
      state.nsc = load('nsc', 'folio_nsc', []);
      state.epf = load('epf', 'folio_epf', []);
      state.goalsMetadata = load('goalsMetadata', 'foliosense_goals_meta', {});
      state.goals = load('goals', 'foliosense_goals', {});
      state.fundReturnsMap = load('fundReturnsMap', 'folio_fund_returns', {});

      return !!saved;
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
      
      // ── NPS ─────────────────────────────────────────────────────────────
      if (state.npsPortfolios) {
        state.npsPortfolios = state.npsPortfolios.filter(p => 
          p.tiers && p.tiers.some(t => t.schemes && t.schemes.length > 0)
        );
        const hasNPS = state.npsPortfolios.length > 0;
        if (hasNPS) UI.renderNPSDashboard(state.npsPortfolios);
        UI.updateNPSViewState(hasNPS);
      }

      if (state.stocksPortfolios && state.stocksPortfolios.length > 0) {
        UI.renderStocksDashboard(state.stocksPortfolios);
        UI.updateStocksViewState(true);
      } else {
        UI.updateStocksViewState(false);
      }

      // ── Foreign Stocks ──────────────────────────────────────────────────
      if (state.foreignEquities) {
        UI.renderForeignEquitiesDashboard(state.foreignEquities);
      }

      if (state.nsc) {
        UI.renderNSCDashboard(state.nsc);
      }

      if (state.epf) {
        UI.renderEPFDashboard(state.epf);
      }

      if (state.savings) {
        UI.renderSavingsDashboard(state.savings);
      }
      
    UI.updateBackupReminder(state.isDirtySinceExport);
    saveState();
    } catch (err) {
      console.error('Refresh Dashboard Detailed Error:', err);
      // Fallback: at least try to render bank records if everything else crashes
      if (state.savings) UI.renderSavingsDashboard(state.savings);
    }
  }
  global.refreshDashboard = refreshDashboard;

  /* ═══════════════════════════════════════════ HANDLE NEW FILES */
  async function processNPSFile(file) {
    let password = '';
    let parsed   = null;
    let attempt  = 0;

    while (attempt < 5) {
      try {
        UI.setLoading(`Parsing ${file.name}…`, attempt === 0 ? 'Extracting text' : 'Retrying…', 10);
        parsed = await NPSParser.parsePDF(file, password);
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

  async function handleNPSFiles(files) {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (fileArr.length === 0) { UI.toast('warning', 'No PDFs', 'Please upload .pdf files.'); return; }

    UI.showLoading('Loading…', 'Preparing NPS files', 0);
    const newPortfolios = [];

    for (let i = 0; i < fileArr.length; i++) {
        const parsed = await processNPSFile(fileArr[i]);
        closePasswordModal();
        if (parsed) newPortfolios.push(parsed);
    }

    const validNewPortfolios = newPortfolios.filter(p => 
      p.tiers && p.tiers.some(t => t.schemes && t.schemes.length > 0)
    );

    if (validNewPortfolios.length === 0) {
      UI.hideLoading();
      UI.toast('warning', 'No Data Found', 'Could not extract NPS data from the statement. Try another format.');
      return;
    }

    // Purge any previously parsed faulty portfolios that resulted in 0 units.
    // De-duplicate based on PRAN (best) or Name (fallback)
    validNewPortfolios.forEach(newP => {
      const pran = newP.investor?.pran;
      const name = newP.investor?.name;
      if (pran || name) {
        const idx = state.npsPortfolios.findIndex(p => 
          (pran && p.investor?.pran === pran) || (!pran && name && p.investor?.name === name)
        );
        if (idx !== -1) {
          state.npsPortfolios[idx] = newP;
        } else {
          state.npsPortfolios.push(newP);
        }
      } else {
        state.npsPortfolios.push(newP);
      }
    });

    UI.toast('success', 'Parsed!', `${validNewPortfolios.length} NPS statement(s) processed.`);

    UI.hideLoading();
    state.isDirtySinceExport = true;
    refreshDashboard();
    UI.setScreen('nps');
  }

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

    // De-duplicate based on PAN
    newPortfolios.forEach(newP => {
      const pan = newP.investor?.pan;
      const name = newP.investor?.name;
      if (pan || name) {
        const idx = state.portfolios.findIndex(p => 
          (pan && p.investor?.pan === pan) || (!pan && name && p.investor?.name === name)
        );
        if (idx !== -1) {
          state.portfolios[idx] = newP;
        } else {
          state.portfolios.push(newP);
        }
      } else {
        state.portfolios.push(newP);
      }
    });

    UI.toast('success', 'Parsed!', `${newPortfolios.length} statement(s) processed.`);

    // Fetch live NAV
    const schemes = UI.buildRows(state.portfolios);
    UI.setLoading('Fetching live NAV…', `Resolving ${schemes.length} units…`, 45);
    state.liveNavMap = await NavFetch.fetchAll(schemes);

    UI.hideLoading();
    state.isDirtySinceExport = true;
    refreshDashboard();
    UI.setScreen('mf'); // Switch to MF dashboard after upload
  }

  /* ═══════════════════════════════════════════ HANDLE STOCKS FILES */
  async function handleZerodhaFiles(files) {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.xlsx'));
    if (fileArr.length === 0) { UI.toast('warning', 'Invalid File', 'Please upload your Zerodha Holdings CSV.'); return; }

    UI.showLoading('Loading…', 'Reading Holdings', 0);
    const newPortfolios = [];

    for (let i = 0; i < fileArr.length; i++) {
        try {
          const parsed = await ZerodhaParser.parseFile(fileArr[i]);
          if (parsed && parsed.holdings.length > 0) newPortfolios.push(parsed);
        } catch (err) {
          console.error(err);
          UI.toast('error', 'Parse Error', `Could not read ${fileArr[i].name}. Is it a valid Zerodha CSV?`);
        }
    }

    UI.hideLoading();
    if (newPortfolios.length === 0) return;

    // De-duplicate based on filename + broker
    newPortfolios.forEach(newP => {
      const idx = state.stocksPortfolios.findIndex(p => p._filename === newP._filename && p.broker === newP.broker);
      if (idx !== -1) {
        state.stocksPortfolios[idx] = newP;
      } else {
        state.stocksPortfolios.push(newP);
      }
    });

    UI.toast('success', 'Parsed!', `${newPortfolios.length} tradebook(s) processed.`);
    state.isDirtySinceExport = true;
    refreshDashboard();
    UI.setScreen('stocks-in');
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
    setClick('nav-add-btn', () => {
      const activeTab = document.querySelector('.screen-tab.active');
      const screen = activeTab ? activeTab.dataset.screen : 'mf';
      if (screen === 'nps') {
        const npsInput = document.getElementById('nps-file-input');
        if (npsInput) npsInput.click();
      } else if (screen === 'stocks-in') {
        const stocksInput = document.getElementById('zerodha-file-input');
        if (stocksInput) stocksInput.click();
      } else {
        // Fallback or default to MF
        const mfInput = document.getElementById('file-input');
        if (mfInput) mfInput.click();
      }
    });

    if (fileInput) {
      fileInput.onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };
    }

    // NPS Upload Zone
    const npsDropZone  = document.getElementById('nps-drop-zone');
    const npsFileInput = document.getElementById('nps-file-input');
    if (npsDropZone && npsFileInput) {
      npsDropZone.onclick = () => npsFileInput.click();
    }
    
    setClick('nps-browse-btn', (e) => { e.stopPropagation(); if (npsFileInput) npsFileInput.click(); });
    // nps-add-btn (shown on dashboard): directly open file picker without re-routing
    setClick('nps-add-btn', () => { if (npsFileInput) npsFileInput.click(); });

    // Broker Selection
    document.querySelectorAll('.broker-card').forEach(card => {
      card.onclick = () => {
        const broker = card.dataset.broker;
        if (broker === 'zerodha') {
          document.getElementById('stocks-in-broker-selection').style.display = 'none';
          document.getElementById('stocks-in-zerodha-upload').style.display = 'flex';
        } else {
          UI.toast('info', 'Coming Soon', 'Integration for this broker is currently in progress.');
        }
      };
    });

    setClick('stocks-back-btn', () => {
      document.getElementById('stocks-in-zerodha-upload').style.display = 'none';
      document.getElementById('stocks-in-broker-selection').style.display = 'flex';
    });

    // Zerodha Upload Zone
    const zerodhaDropZone = document.getElementById('zerodha-drop-zone');
    const zerodhaFileInput = document.getElementById('zerodha-file-input');
    if (zerodhaDropZone && zerodhaFileInput) {
      zerodhaDropZone.onclick = () => zerodhaFileInput.click();
    }
    setClick('zerodha-browse-btn', (e) => { e.stopPropagation(); if (zerodhaFileInput) zerodhaFileInput.click(); });
    
    if (zerodhaFileInput) {
      zerodhaFileInput.onchange = (e) => { 
        handleZerodhaFiles(e.target.files);
        e.target.value = ''; 
      };
    }

    // stocks-in-add-btn (shown on dashboard): directly open zerodha file picker
    setClick('stocks-in-add-btn', () => { if (zerodhaFileInput) zerodhaFileInput.click(); });

    if (npsFileInput) {
      npsFileInput.onchange = (e) => { handleNPSFiles(e.target.files); e.target.value = ''; };
    }

    // Debug
    setClick('nav-debug-btn', () => {
      const ds = document.getElementById('debug-section');
      if (ds) ds.style.display = ds.style.display === 'none' ? 'block' : 'none';
    });

    // Barclays ESOPs
    setClick('btn-add-barclays-grant', () => {
      document.getElementById('esop-modal').style.display = 'flex';
      document.getElementById('esop-date').valueAsDate = new Date();
    });

    setClick('esop-cancel', () => {
      document.getElementById('esop-modal').style.display = 'none';
    });

    setClick('esop-submit', () => {
      const date = document.getElementById('esop-date').value;
      const qty  = document.getElementById('esop-qty').value;
      const strike = document.getElementById('esop-strike').value;
      const status = document.getElementById('esop-status').value;

      if (!date || !qty || !strike) {
        UI.toast('error', 'Missing Data', 'Please fill in all fields (Date, Quantity, Strike Price).');
        return;
      }

      state.foreignEquities.barclays.grants.push({ 
        date: new Date(date), 
        qty: parseFloat(qty), 
        strike: parseFloat(strike), 
        status: status 
      });

      saveState();
      UI.renderForeignEquitiesDashboard(state.foreignEquities);
      document.getElementById('esop-modal').style.display = 'none';
      
      // Clear inputs
      document.getElementById('esop-qty').value = '';
      document.getElementById('esop-strike').value = '';
      
      UI.toast('success', 'Grant Added', 'New Barclays ESOP grant recorded.');
    });

    // Delete ESOP (delegated)
    const baTable = document.getElementById('barclays-tbody');
    if (baTable) {
        baTable.onclick = (e) => {
            if (e.target.classList.contains('btn-delete-esop')) {
                const idx = parseInt(e.target.dataset.idx);
                if (confirm('Are you sure you want to delete this grant?')) {
                    state.foreignEquities.barclays.grants.splice(idx, 1);
                    saveState();
                    UI.renderForeignEquitiesDashboard(state.foreignEquities);
                    UI.toast('info', 'Grant Removed', 'The grant has been deleted.');
                }
            }
        };
    }

    const baGoalInput = document.getElementById('barclays-goal-input');
    if (baGoalInput) {
        baGoalInput.onchange = (e) => {
            const newGoal = e.target.value.trim();
            state.foreignEquities.barclays.goal = newGoal;
            
            if (newGoal && !state.goalsMetadata[newGoal]) {
                state.goalsMetadata[newGoal] = { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
            }
            
            saveState();
            refreshDashboard();
            UI.toast('info', 'Goal Linked', `Barclays portfolio linked to "${newGoal || 'no goal'}".`);
        };
    }

    // Goals
    setClick('btn-manage-goals', () => {
      UI.openGoalManager(() => {
        state.isDirtySinceExport = true;
        UI.renderGoalsDashboard(state.portfolios, state.npsPortfolios);
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

    // Bank Savings Actions
    setClick('btn-add-savings-account', () => UI.openSavingsModal('account'));
    setClick('btn-add-fd', () => UI.openSavingsModal('fd'));
    setClick('btn-add-rd', () => UI.openSavingsModal('rd'));
    setClick('sav-cancel', () => UI.closeSavingsModal());
    setClick('sav-submit', () => {
      const type = UI.getActiveSavingsType();
      const bankSelect = document.getElementById('sav-bank');
      const bankName = bankSelect.value;
      if (!bankName) {
        UI.toast('warning', 'Selection Required', 'Please select a bank from the list.');
        return;
      }
      
      const entry = {
        bank: bankName,
        goal: document.getElementById('sav-goal').value.trim(),
      };

      if (type === 'account') {
        entry.balance = parseFloat(document.getElementById('sav-val-1').value) || 0;
        entry.type = document.getElementById('sav-val-2').value.trim() || 'Savings';
        state.savings.accounts.push(entry);
      } else if (type === 'fd' || type === 'rd') {
        entry.principal = parseFloat(document.getElementById('sav-val-1').value) || 0;
        entry.maturityValue = parseFloat(document.getElementById('sav-val-2').value) || 0;
        entry.maturityDate = document.getElementById('sav-date').value;
        entry.rate = parseFloat(document.getElementById('sav-rate').value) || 0;
        if (type === 'fd') state.savings.fds.push(entry);
        else state.savings.rds.push(entry);
      }

      state.isDirtySinceExport = true;
      UI.closeSavingsModal();
      saveState();
      refreshDashboard();
      UI.toast('success', `${type.toUpperCase()} Added`, 'Entry saved to your bank savings.');
    });

    // NSC Events
    setClick('btn-add-nsc', () => {
        const modal = document.getElementById('nsc-modal');
        if (modal) {
            // Clear inputs
            document.getElementById('nsc-id').value = '';
            document.getElementById('nsc-amount').value = '';
            document.getElementById('nsc-date').value = '';
            document.getElementById('nsc-rate').value = '7.7';
            document.getElementById('nsc-goal-input').value = '';
            
            modal.style.display = 'flex';
            const dl = document.getElementById('nsc-goals-list');
            if (dl) {
                const goalNames = Object.keys(state.goalsMetadata || {});
                dl.innerHTML = goalNames.map(n => `<option value="${n}">`).join('');
            }
        }
    });

    setClick('nsc-cancel', () => {
        const modal = document.getElementById('nsc-modal');
        if (modal) modal.style.display = 'none';
    });

    setClick('nsc-submit', () => {
        const label = document.getElementById('nsc-id').value.trim() || 'NSC Certificate';
        const amount = parseFloat(document.getElementById('nsc-amount').value) || 0;
        const date = document.getElementById('nsc-date').value;
        const rate = parseFloat(document.getElementById('nsc-rate').value) || 0;
        const goal = document.getElementById('nsc-goal-input').value.trim();

        if (amount <= 0 || !date) {
            UI.toast('error', 'Invalid Input', 'Please enter a valid amount and purchase date.');
            return;
        }

        const newEntry = { id: Date.now(), label, amount, date, rate, goal };
        state.nsc.push(newEntry);

        if (goal && !state.goalsMetadata[goal]) {
            state.goalsMetadata[goal] = { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
        }

        saveState();
        refreshDashboard();
        
        document.getElementById('nsc-modal').style.display = 'none';
        UI.toast('success', 'NSC Added', 'Certificate saved successfully.');
    });

    document.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-nsc');
        if (delBtn) {
            const id = parseInt(delBtn.dataset.id);
            if (confirm('Are you sure you want to delete this certificate?')) {
                state.nsc = state.nsc.filter(n => n.id !== id);
                saveState();
                refreshDashboard();
                UI.toast('info', 'NSC Deleted', 'Certificate removed.');
            }
        }
    });

    const nscTable = document.getElementById('nsc-tbody');
    if (nscTable) {
        nscTable.onchange = (e) => {
            if (e.target.classList.contains('nsc-goal-input')) {
                const id = parseInt(e.target.dataset.id);
                const newGoal = e.target.value.trim();
                const cert = state.nsc.find(n => n.id === id);
                if (cert) {
                    cert.goal = newGoal;
                    if (newGoal && !state.goalsMetadata[newGoal]) {
                        state.goalsMetadata[newGoal] = { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
                    }
                    saveState();
                    refreshDashboard();
                    UI.toast('info', 'Goal Updated', `Certificate linked to "${newGoal || 'no goal'}".`);
                }
            }
        };
    }

    const epfTable = document.getElementById('epf-tbody');
    if (epfTable) {
        epfTable.onchange = (e) => {
            if (e.target.classList.contains('epf-goal-input')) {
                const id = parseInt(e.target.dataset.id);
                const newGoal = e.target.value.trim();
                const acct = state.epf.find(n => n.id === id);
                if (acct) {
                    acct.goal = newGoal;
                    if (newGoal && !state.goalsMetadata[newGoal]) {
                        state.goalsMetadata[newGoal] = { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
                    }
                    saveState();
                    refreshDashboard();
                    UI.toast('info', 'Goal Updated', `EPF account linked to "${newGoal || 'no goal'}".`);
                }
            }
        };
    }

    // EPF Events
    setClick('btn-add-epf', () => {
        const modal = document.getElementById('epf-modal');
        if (modal) {
            // Clear inputs
            document.getElementById('epf-name').value = '';
            document.getElementById('epf-employee').value = '';
            document.getElementById('epf-employer').value = '';
            document.getElementById('epf-monthly').value = '';
            document.getElementById('epf-goal-input').value = '';

            modal.style.display = 'flex';
            const dl = document.getElementById('epf-goals-list');
            if (dl) {
                const goalNames = Object.keys(state.goalsMetadata || {});
                dl.innerHTML = goalNames.map(n => `<option value="${n}">`).join('');
            }
        }
    });

    setClick('epf-cancel', () => {
        const modal = document.getElementById('epf-modal');
        if (modal) modal.style.display = 'none';
    });

    setClick('epf-submit', () => {
        const name = document.getElementById('epf-name').value.trim() || 'EPF Account';
        const emp = parseFloat(document.getElementById('epf-employee').value) || 0;
        const mbr = parseFloat(document.getElementById('epf-employer').value) || 0;
        const pen = parseFloat(document.getElementById('epf-pension').value) || 0;
        const mth = parseFloat(document.getElementById('epf-monthly').value) || 0;
        const goal = document.getElementById('epf-goal-input').value.trim();

        if (emp < 0 || mbr < 0 || pen < 0) {
            UI.toast('error', 'Invalid Input', 'Balances cannot be negative.');
            return;
        }

        const newEntry = { 
            id: Date.now(), 
            name, 
            employeeShare: emp, 
            employerShare: mbr, 
            pensionShare: pen,
            monthly: mth, 
            goal 
        };
        state.epf.push(newEntry);

        if (goal && !state.goalsMetadata[goal]) {
            state.goalsMetadata[goal] = { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
        }

        saveState();
        refreshDashboard();
        
        document.getElementById('epf-modal').style.display = 'none';
        UI.toast('success', 'EPF Account Added', 'Details saved successfully.');
    });

    document.addEventListener('click', (e) => {
        const delBtn = e.target.closest('.btn-delete-epf');
        if (delBtn) {
            const id = parseInt(delBtn.dataset.id);
            if (confirm('Are you sure you want to delete this EPF account?')) {
                state.epf = state.epf.filter(n => n.id !== id);
                saveState();
                refreshDashboard();
                UI.toast('info', 'EPF Deleted', 'Account removed.');
            }
        }
    });

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
    
    // Barclays
    const baInput = document.getElementById('barclays-file-input');
    setClick('btn-upload-barclays', () => { if (baInput) baInput.click(); });
    if (baInput) {
      baInput.onchange = (e) => { handleBarclaysFiles(e.target.files); e.target.value = ''; };
    }

    // EPF
    const epfInput = document.getElementById('epf-file-input');
    setClick('btn-upload-epf', () => { if (epfInput) epfInput.click(); });
    if (epfInput) {
      epfInput.onchange = (e) => { handleEPFFiles(e.target.files); e.target.value = ''; };
    }

    // Mutual Fund UI
    const onMFRowClick = (row) => UI.openTransactionPanel(row);
    UI.initMutualFundUI(state, onMFRowClick);
  }

  async function handleBarclaysFiles(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    UI.showLoading('Reading Statement', file.name, 20);

    const parseWithPW = async (pw = '') => {
        try {
            const result = await global.BarclaysParser.parseFile(file, pw);
            if (!result.grants || result.grants.length === 0) {
                UI.hideLoading();
                UI.toast('warning', 'No Grants Found', 'Parsed the file but could not identify any ESOP grants.');
                return;
            }

            // De-duplicate: Create a unique key for each grant and only add new ones
            const existingGrants = state.foreignEquities.barclays.grants || [];
            const existingKeys = new Set(existingGrants.map(g => `${new Date(g.date).toISOString()}_${g.qty}_${g.strike}`));
            
            const newGrants = result.grants.filter(g => {
                const key = `${new Date(g.date).toISOString()}_${g.qty}_${g.strike}`;
                if (existingKeys.has(key)) return false;
                existingKeys.add(key);
                return true;
            });

            if (newGrants.length === 0 && result.grants.length > 0) {
                UI.hideLoading();
                UI.toast('info', 'No New Grants', 'All grants in this file were already present in your portfolio.');
                return;
            }

            state.foreignEquities.barclays.grants = [...existingGrants, ...newGrants];
            saveState();
            UI.hideLoading();
            UI.toast('success', 'Import Complete', `Found ${result.grants.length} grants in ${file.name}`);
            refreshDashboard();
        } catch (e) {
            UI.hideLoading();
            if (e.name === 'PasswordException' || e.message?.includes('password')) {
                const pw = await openPasswordModal(file.name);
                if (pw === '__SKIP__') return;
                UI.showLoading('Retrying with Password...', file.name, 40);
                await parseWithPW(pw);
            } else {
                console.error(e);
                const type = file.name.split('.').pop().toUpperCase();
                UI.toast('error', 'Parse Error', `Failed to read ${type}: ${e.message || 'Unknown error'}`);
            }
        }
    };

    await parseWithPW();
  }

  async function handleEPFFiles(files) {
    if (!files || files.length === 0) return;
    const file = files[0];
    UI.showLoading('Parsing EPF Passbook', file.name, 30);

    try {
        const result = await global.EPFParser.parsePDF(file);
        if (!result.summary || (result.summary.employeeShare === 0 && result.summary.employerShare === 0)) {
            UI.hideLoading();
            UI.toast('warning', 'No Data Found', 'Could not extract balances from this EPF passbook.');
            return;
        }

        const name = result.investor.name || 'EPF Account';
        const estName = result.establishment.name || '';
        const uan = result.investor.uan || '';
        const memberId = result.investor.memberId || '';
        
        // De-duplication Logic
        let existingIdx = -1;
        if (memberId) {
            existingIdx = state.epf.findIndex(e => e.memberId === memberId);
        } else if (uan && estName) {
            // Fallback: match by UAN + Establishment if no Member ID
            existingIdx = state.epf.findIndex(e => e.uan === uan && e.establishmentName === estName);
        } else {
            existingIdx = state.epf.findIndex(e => e.name === name && e.establishmentName === estName);
        }

        if (existingIdx > -1) {
            // Update existing entry
            state.epf[existingIdx].employeeShare = result.summary.employeeShare;
            state.epf[existingIdx].employerShare = result.summary.employerShare;
            state.epf[existingIdx].pensionShare = result.summary.pensionShare;
            state.epf[existingIdx].name = name;
            state.epf[existingIdx].establishmentName = estName;
            UI.toast('info', 'Account Updated', `Updated balances for ${name} at ${estName || 'EPF'}`);
        } else {
            // Add to state
            const newEntry = {
                id: Date.now(),
                uan: uan,
                memberId: memberId,
                name: name,
                establishmentName: estName,
                employeeShare: result.summary.employeeShare,
                employerShare: result.summary.employerShare,
                pensionShare: result.summary.pensionShare,
                monthly: 0,
                goal: ''
            };
            state.epf.push(newEntry);
            const displayTotal = result.summary.employeeShare + result.summary.employerShare + result.summary.pensionShare;
            UI.toast('success', 'Passbook Imported', `Retrieved ${UI.fmt(displayTotal)} for MID: ${memberId || estName || 'New Account'}`);
        }

        saveState();
        UI.hideLoading();
        refreshDashboard();
    } catch (e) {
        UI.hideLoading();
        console.error('EPF Parse Error:', e);
        UI.toast('error', 'Parse Error', `Failed to read EPF file: ${e.message}`);
    }
  }

  function cleanUpPortfolios() {
    const dedupe = (list, keyFn) => {
      const seen = new Set();
      const unique = [];
      list.forEach(item => {
        const key = keyFn(item);
        if (key && !seen.has(key)) {
          seen.add(key);
          unique.push(item);
        } else if (!key) {
           unique.push(item);
        }
      });
      return unique;
    };

    const oldNPS = state.npsPortfolios.length;
    const oldMF = state.portfolios.length;
    const oldStocks = state.stocksPortfolios.length;

    state.npsPortfolios = dedupe(state.npsPortfolios, p => p.investor?.pran || p.investor?.name);
    state.portfolios = dedupe(state.portfolios, p => p.investor?.pan || p.investor?.name);
    
    // Deep cleanup for Mutual Funds
    state.portfolios.forEach(p => {
      // 1. Dedupe Folios
      p.folios = dedupe(p.folios || [], f => f.folio);
      
      // 2. Dedupe Schemes within each folio
      p.folios.forEach(f => {
        f.schemes = (f.schemes || []).reduce((acc, s) => {
          const key = s.isin || s.name;
          const existing = acc.find(x => (x.isin && x.isin === s.isin) || (x.name && x.name === s.name));
          if (existing) {
            // Pick scheme with better data
            if (s.closingUnits > existing.closingUnits) existing.closingUnits = s.closingUnits;
            if (s.transactions?.length > existing.transactions?.length) existing.transactions = s.transactions;
            Object.assign(existing.valuation || {}, s.valuation || {});
          } else {
            acc.push(s);
          }
          return acc;
        }, []);
      });
    });
    if (state.stocksPortfolios) {
      state.stocksPortfolios = dedupe(state.stocksPortfolios, p => p.filename || p.pan);
    }
    
    // ── Barclays ESOPs ──────────────────────────────────────────────
    if (state.foreignEquities?.barclays?.grants) {
      state.foreignEquities.barclays.grants = dedupe(
        state.foreignEquities.barclays.grants,
        g => `${new Date(g.date).toISOString()}_${g.qty}_${g.strike}`
      );
    }

    saveState();

    if (state.npsPortfolios.length !== oldNPS || state.portfolios.length !== oldMF || state.stocksPortfolios.length !== oldStocks) {
      saveState();
    }
  }

  function init() {
    try {
      loadState();
      cleanUpPortfolios();
      window.appState = state; // Shared with UI

      wireNavigation();
      wireActions();

      document.getElementById('nav-screen-tabs').style.display = 'flex';
      
      // Initial routing
      UI.setScreen('overview');
      cleanUpPortfolios();
      refreshDashboard();

      // Auto NAV refresh
      if (state.portfolios.length > 0) {
        const rows = UI.buildRows(state.portfolios);
        NavFetch.fetchAll(rows).then(async map => {
          state.liveNavMap = map;

          // PERSIST resolved AMFI codes back to state.portfolios
          rows.forEach(r => {
            if (r.amfiCode && r.personIdx != null) {
              const portfolio = state.portfolios[r.personIdx];
              if (portfolio) {
                for (const f of (portfolio.folios || [])) {
                  const scheme = f.schemes?.find(s => s.isin === r.isin || s.name === r.name);
                  if (scheme && !scheme.amfiCode) scheme.amfiCode = r.amfiCode;
                }
              }
            }
          });

          refreshDashboard();

          // Background fetch fund histories for Advice
          const amfiCodes = [...new Set(rows.map(r => r.amfiCode).filter(Boolean))];
          const CONCURRENCY = 3;
          for (let i = 0; i < amfiCodes.length; i += CONCURRENCY) {
            const batch = amfiCodes.slice(i, i + CONCURRENCY);
            await Promise.allSettled(batch.map(async code => {
              if (state.fundReturnsMap[code]) return;
              const ret = await NavFetch.fetchReturns(code);
              if (ret) state.fundReturnsMap[code] = ret;
            }));
            refreshDashboard(); // Refresh after each batch
          }
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
