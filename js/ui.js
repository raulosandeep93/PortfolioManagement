/**
 * ui.js — Rendering layer for FolioSense
 * Exposes: window.UI
 */
(function (global) {
  'use strict';

  /* ══════════════════════════════════════════ FORMAT HELPERS */
  const fmt = (n) => typeof n === 'number' && isFinite(n)
    ? '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })
    : '—';

  const fmtPct = (n) => typeof n === 'number' && isFinite(n)
    ? (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
    : '—';

  const fmtXIRR = (n) => typeof n === 'number' && isFinite(n)
    ? (n * 100).toFixed(2) + '%'
    : '—';

  const fmtUnits = (n) => typeof n === 'number' && isFinite(n)
    ? n.toLocaleString('en-IN', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
    : '—';

  const fmtNav = (n) => typeof n === 'number' && isFinite(n)
    ? '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
    : '—';

  const fmtDate = (d) => {
    if (!d) return '—';
    const dt = typeof d === 'string' ? new Date(d) : d;
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  /* ══════════════════════════════════════════ PERSON COLORS */
  const PERSON_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6'];

  function personColor(idx) { return PERSON_COLORS[idx % PERSON_COLORS.length]; }

  /* ══════════════════════════════════════════ TOAST */
  function toast(type, title, msg, durationMs = 4000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || '🔔'}</span>
      <div class="toast-body"><div class="toast-title">${title}</div><div class="toast-msg">${msg}</div></div>`;
    document.getElementById('toast-container').prepend(el);
    setTimeout(() => el.remove(), durationMs);
  }

  /* ══════════════════════════════════════════ LOADING */
  function showLoading(title, sub, pct) {
    document.getElementById('loading-overlay').style.display = 'flex';
    setLoading(title, sub, pct);
  }
  function setLoading(title, sub, pct) {
    if (title) document.getElementById('loading-title').textContent = title;
    if (sub) document.getElementById('loading-sub').textContent = sub;
    if (pct != null) document.getElementById('loading-progress-fill').style.width = pct + '%';
  }
  function hideLoading() {
    document.getElementById('loading-overlay').style.display = 'none';
  }

  /* ══════════════════════════════════════════ GOALS STORAGE */
  const GOALS_STORAGE_KEY = 'foliosense_goals';
  let _storedGoals = null;

  function getGoalsMap() {
    if (_storedGoals) return _storedGoals;
    try {
      _storedGoals = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY)) || {};
    } catch {
      _storedGoals = {};
    }
    return _storedGoals;
  }

  function saveGoal(key, val) {
    const map = getGoalsMap();
    if (!val || !val.trim()) {
      delete map[key];
    } else {
      map[key] = val.trim();
    }
    _storedGoals = map;
    localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(map));
  }

  function getGoal(key) {
    return getGoalsMap()[key] || '';
  }

  const GOALS_META_KEY = 'foliosense_goals_meta';
  let _goalsMeta = null;

  function getGoalsMeta() {
    if (_goalsMeta) return _goalsMeta;
    try {
      _goalsMeta = JSON.parse(localStorage.getItem(GOALS_META_KEY)) || {};
    } catch {
      _goalsMeta = {};
    }
    return _goalsMeta;
  }

  function saveGoalMeta(goalName, data) {
    const meta = getGoalsMeta();
    meta[goalName] = data;
    _goalsMeta = meta;
    localStorage.setItem(GOALS_META_KEY, JSON.stringify(meta));
  }

  function exportFullBackup(appState) {
    const data = {
      type: 'foliosense_full_backup',
      version: '1.0',
      timestamp: new Date().toISOString(),
      payload: {
        state: appState || {},
        goals: getGoalsMap(),
        goalsMeta: getGoalsMeta()
      }
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(data, null, 2));
    const dlAnchorElem = document.createElement('a');
    dlAnchorElem.setAttribute("href", dataStr);
    dlAnchorElem.setAttribute("download", `foliosense_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dlAnchorElem);
    dlAnchorElem.click();
    dlAnchorElem.remove();
    toast('success', 'Backup Exported', 'Full backup has been downloaded successfully.');
  }

  function importFullData(jsonString, onComplete) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object') throw new Error("Invalid format");
      if (parsed.type === 'foliosense_full_backup' && parsed.payload) {
        const { state, goals, goalsMeta } = parsed.payload;
        if (state) localStorage.setItem('foliosense_state', JSON.stringify(state));
        if (goals) {
          _storedGoals = goals;
          localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
        }
        if (goalsMeta) {
          _goalsMeta = goalsMeta;
          localStorage.setItem(GOALS_META_KEY, JSON.stringify(goalsMeta));
        }
        toast('success', 'Backup Restored', 'All data and portfolios have been loaded.');
      } else {
        const map = getGoalsMap();
        Object.assign(map, parsed);
        _storedGoals = map;
        localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(map));
        toast('success', 'Goals Imported', 'Goal mappings have been merged into your current state.');
      }
      if (onComplete) onComplete();
    } catch (e) {
      console.error('Import error:', e);
      toast('error', 'Import Failed', 'The selected file is not a valid FolioSense data file.');
    }
  }

  /* ══════════════════════════════════════════ SUMMARY CARDS */
  function renderSummaryCards(summary) {
    if (!summary) return;
    const { totalInvested, totalCurrentValue, totalGainLoss, absoluteReturn, portfolioXIRR } = summary;

    document.getElementById('sc-invested-val').textContent = fmt(totalInvested);
    document.getElementById('sc-invested-sub').textContent = '';
    document.getElementById('sc-current-val').textContent = fmt(totalCurrentValue);

    const gainEl = document.getElementById('sc-gain');
    const gainValEl = document.getElementById('sc-gain-val');
    const gainPctEl = document.getElementById('sc-gain-pct');
    const glSign = totalGainLoss >= 0 ? '+' : '-';
    gainValEl.textContent = glSign + fmt(Math.abs(totalGainLoss));
    gainPctEl.textContent = fmtPct(absoluteReturn);
    gainPctEl.className = 'sc-sub ' + (absoluteReturn >= 0 ? 'positive' : 'negative');
    gainEl.classList.toggle('negative', totalGainLoss < 0);

    document.getElementById('sc-xirr-val').textContent =
      portfolioXIRR != null ? fmtXIRR(portfolioXIRR) : '—';
  }

  /* ══════════════════════════════════════════ PERSON TABS */
  function renderPersonTabs(portfolios, activeName) {
    const container = document.getElementById('nav-person-tabs');
    const filterSel = document.getElementById('table-filter-person');
    if (!container) return;

    container.innerHTML = '';
    if (filterSel) filterSel.innerHTML = '<option value="">All Persons</option>';

    const allTab = document.createElement('button');
    allTab.className = 'person-tab' + (!activeName ? ' active' : '');
    allTab.textContent = '🔗 All Persons';
    allTab.dataset.person = '';
    container.appendChild(allTab);

    const names = Array.from(new Set(portfolios.map(p => p.investor?.name || 'Unknown')));
    names.forEach((name, idx) => {
      const color = personColor(idx);
      const tab = document.createElement('button');
      tab.className = 'person-tab' + (activeName === name ? ' active' : '');
      tab.innerHTML = `<span class="tab-dot" style="background:${color}"></span>${name}`;
      tab.dataset.person = name;
      container.appendChild(tab);

      if (filterSel) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        filterSel.appendChild(opt);
      }
    });

    container.style.display = 'flex';
  }

  /* ══════════════════════════════════════════ CHARTS */
  let chartAMC = null, chartCat = null, chartTop = null;
  const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a3e635'];

  function destroyCharts() {
    [chartAMC, chartCat, chartTop].forEach(c => c?.destroy());
    chartAMC = chartCat = chartTop = null;
  }

  function renderCharts(rows) {
    destroyCharts();
    const amcMap = {};
    for (const r of rows) { amcMap[r.amc] = (amcMap[r.amc] || 0) + (r.analytics?.currentValue || 0); }
    const amcLabels = Object.keys(amcMap).sort((a, b) => amcMap[b] - amcMap[a]);
    const amcData = amcLabels.map(k => amcMap[k]);

    chartAMC = new Chart(document.getElementById('chart-amc'), {
      type: 'doughnut',
      data: {
        labels: amcLabels,
        datasets: [{ data: amcData, backgroundColor: CHART_COLORS, borderColor: 'transparent', hoverOffset: 6 }],
      },
      options: chartDoughnutOptions(),
    });

    const catMap = { EQUITY: 0, DEBT: 0, HYBRID: 0, OTHER: 0 };
    for (const r of rows) catMap[r.analytics?.category || 'EQUITY'] += (r.analytics?.currentValue || 0);
    const catColors = { EQUITY: '#3b82f6', DEBT: '#f59e0b', HYBRID: '#10b981', OTHER: '#8b5cf6' };
    const catEntries = Object.entries(catMap).filter(([, v]) => v > 0);

    chartCat = new Chart(document.getElementById('chart-cat'), {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([k]) => k.charAt(0) + k.slice(1).toLowerCase()),
        datasets: [{ data: catEntries.map(([, v]) => v), backgroundColor: catEntries.map(([k]) => catColors[k]), borderColor: 'transparent', hoverOffset: 6 }],
      },
      options: chartDoughnutOptions(),
    });

    const sorted = [...rows].sort((a, b) => (b.analytics?.currentValue || 0) - (a.analytics?.currentValue || 0)).slice(0, 8);
    chartTop = new Chart(document.getElementById('chart-top'), {
      type: 'bar',
      data: {
        labels: sorted.map(r => r.name.length > 25 ? r.name.slice(0, 23) + '…' : r.name),
        datasets: [{ label: 'Current Value', data: sorted.map(r => r.analytics?.currentValue || 0), backgroundColor: sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + 'cc'), borderRadius: 6 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
        scales: {
          x: { ticks: { color: '#475569', callback: v => '₹' + (v / 1e5).toFixed(0) + 'L' }, grid: { color: 'rgba(255,255,255,0.04)' }, border: { display: false } },
          y: { ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { display: false }, border: { display: false } },
        },
      },
    });
  }

  function chartDoughnutOptions() {
    return {
      responsive: true, maintainAspectRatio: false, cutout: '65%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', boxWidth: 12, padding: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${fmt(ctx.raw)}` } },
      },
    };
  }

  /* ══════════════════════════════════════════ HOLDINGS TABLE */
  let _allRows = [];
  let _sortCol = 'current';
  let _sortDir = 'desc';

  function buildRows(portfolios) {
    const rows = [];
    portfolios.forEach((portfolio, pIdx) => {
      const pName = portfolio.investor?.name || portfolio._filename || `Portfolio ${pIdx + 1}`;
      const pColor = personColor(pIdx);
      for (const folio of (portfolio.folios || [])) {
        for (const scheme of (folio.schemes || [])) {
          const goalKey = (folio.folio || 'NA') + '_' + (scheme.isin || scheme.amfiCode || scheme.name || 'NA');
          rows.push({
            ...scheme, amc: folio.amc || '', folio: folio.folio || '', personIdx: pIdx, personName: pName, personColor: pColor,
            name: scheme.name || '—', goalKey: goalKey, goal: getGoal(goalKey),
          });
        }
      }
    });
    return rows;
  }

  function filterRows(rows, searchTerm, catFilter, personFilter) {
    return rows.filter(r => {
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        if (!r.name.toLowerCase().includes(q) && !r.amc.toLowerCase().includes(q)) return false;
      }
      if (catFilter && r.analytics?.category !== catFilter) return false;
      if (personFilter !== '' && personFilter != null && r.personIdx !== +personFilter) return false;
      return true;
    });
  }

  function sortRows(rows, col, dir) {
    const get = (r) => {
      switch (col) {
        case 'name': return r.name?.toLowerCase() || '';
        case 'person': return r.personName?.toLowerCase() || '';
        case 'goal': return r.goal?.toLowerCase() || '';
        case 'units': return r.analytics?.units || 0;
        case 'nav': return r.analytics?.casNav || 0;
        case 'liveNav': return r.analytics?.liveNav || r.analytics?.casNav || 0;
        case 'invested': return r.analytics?.totalInvested || 0;
        case 'current': return r.analytics?.currentValue || 0;
        case 'gain': return r.analytics?.gainLoss || 0;
        case 'xirr': return r.analytics?.xirr ?? -99;
        default: return 0;
      }
    };
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === 'asc' ? va - vb : vb - va;
    });
  }

  function renderTable(portfolios, onRowClick) {
    _allRows = buildRows(portfolios);
    renderTableBody(portfolios, onRowClick);
  }

  function renderTableBody(portfolios, onRowClick) {
    const search = (document.getElementById('table-search')?.value || '').trim();
    const catFilter = document.getElementById('table-filter-cat')?.value || '';
    const pFilter = document.getElementById('table-filter-person')?.value ?? '';

    let rows = filterRows(_allRows, search, catFilter, pFilter);
    rows = sortRows(rows, _sortCol, _sortDir);

    const tbody = document.getElementById('holdings-tbody');
    const emptyEl = document.getElementById('table-empty');
    if (!tbody || !emptyEl) return;
    tbody.innerHTML = '';

    if (rows.length === 0) { emptyEl.style.display = ''; return; }
    emptyEl.style.display = 'none';

    const multiPerson = portfolios.length > 1;
    const personTh = document.querySelector('.th-person');
    if (personTh) personTh.style.display = multiPerson ? '' : 'none';

    rows.forEach(r => {
      const a = r.analytics || {};
      const catClass = { EQUITY: 'badge-equity', DEBT: 'badge-debt', HYBRID: 'badge-hybrid', OTHER: 'badge-other' }[a.category || 'EQUITY'] || 'badge-other';
      const gainSign = (a.gainLoss || 0) >= 0 ? 'positive' : 'negative';
      const xirrSign = (a.xirr || 0) >= 0 ? 'positive' : 'negative';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><div class="td-fund-name">${r.name}</div><div class="td-amc">${r.amc} · ${r.folio}</div><span class="td-cat-badge ${catClass}">${(a.category || 'EQUITY').charAt(0) + (a.category || 'EQUITY').slice(1).toLowerCase()}</span></td>
        ${multiPerson ? `<td><span class="td-person-badge" style="background:${r.personColor}22;color:${r.personColor}">${r.personName}</span></td>` : ''}
        <td><input type="text" class="goal-input" data-key="${r.goalKey}" value="${r.goal || ''}" placeholder="Add goal..." /></td>
        <td>${fmtUnits(a.units)}</td>
        <td>${fmtNav(a.casNav)}</td>
        <td class="td-live-nav">${fmtNav(a.liveNav || a.casNav)} ${a.isLiveNav ? '<span class="live-tag">LIVE</span>' : '<span class="cas-tag">CAS</span>'}</td>
        <td>${fmt(a.totalInvested)}</td>
        <td><strong>${fmt(a.currentValue)}</strong></td>
        <td class="${gainSign}">${(a.gainLoss || 0) >= 0 ? '+' : ''}${fmt(a.gainLoss)}<br/><small>${fmtPct(a.absoluteReturn)}</small></td>
        <td class="${xirrSign}"><strong>${a.xirr != null ? fmtXIRR(a.xirr) : '—'}</strong></td>
      `;
      tr.addEventListener('click', (e) => { if (!e.target.classList.contains('goal-input')) onRowClick && onRowClick(r); });
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.goal-input').forEach(input => {
      input.addEventListener('blur', (e) => {
        const key = e.target.dataset.key;
        saveGoal(key, e.target.value);
        if (global._FolioSense) {
          global._FolioSense.isDirtySinceExport = true;
          const dot = document.getElementById('export-reminder-dot');
          if (dot) dot.style.display = 'block';
        }
        const rowData = _allRows.find(rw => rw.goalKey === key);
        if (rowData) rowData.goal = e.target.value.trim();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    });
  }

  function initTableSort(portfolios, onRowClick) {
    document.querySelectorAll('#holdings-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (_sortCol === col) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        else { _sortCol = col; _sortDir = 'desc'; }
        document.querySelectorAll('#holdings-table th').forEach(t => t.classList.remove('sort-asc', 'sort-desc'));
        th.classList.add(_sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        renderTableBody(portfolios, onRowClick);
      });
    });
  }

  /* ═══════════════════════════════════════ TRANSACTION PANEL */
  function openTransactionPanel(row) {
    const a = row.analytics || {};
    const panel = document.getElementById('txn-panel');
    const overlay = document.getElementById('panel-overlay');
    if (!panel || !overlay) return;

    document.getElementById('txn-panel-title').textContent = row.name;
    document.getElementById('txn-panel-sub').textContent = `${row.amc} · AMFI: ${row.amfiCode || '—'}`;
    document.getElementById('txn-panel-stats').innerHTML = `
      <div class="panel-stat"><div class="panel-stat-label">Invested</div><div class="panel-stat-value">${fmt(a.totalInvested)}</div></div>
      <div class="panel-stat"><div class="panel-stat-label">Current Value</div><div class="panel-stat-value">${fmt(a.currentValue)}</div></div>
      <div class="panel-stat"><div class="panel-stat-label">XIRR</div><div class="panel-stat-value ${(a.xirr || 0) >= 0 ? 'positive' : 'negative'}">${a.xirr != null ? fmtXIRR(a.xirr) : '—'}</div></div>
    `;

    const txns = [...(row.transactions || [])].sort((a, b) => b.date - a.date);
    const typeClass = { PURCHASE: 'txn-purchase', PURCHASE_SIP: 'txn-sip', REDEMPTION: 'txn-redemption', SWITCH_IN: 'txn-switch', SWITCH_OUT: 'txn-switch', DIVIDEND: 'txn-dividend', DIVIDEND_REINVEST: 'txn-dividend', OTHER: 'txn-other' };
    document.getElementById('txn-tbody').innerHTML = txns.map(t => {
      const cls = typeClass[t.type] || 'txn-other';
      const label = t.type?.replace(/_/g, ' ') || 'OTHER';
      const amtCls = ['REDEMPTION', 'SWITCH_OUT'].includes(t.type) ? 'positive' : ['PURCHASE', 'PURCHASE_SIP', 'SWITCH_IN'].includes(t.type) ? 'negative' : '';
      return `<tr><td>${fmtDate(t.date)}</td><td><span class="txn-type-badge ${cls}">${label}</span></td><td style="text-align:right" class="${amtCls}">${t.rawAmount ? fmt(t.rawAmount) : '—'}</td><td style="text-align:right">${t.units ? fmtUnits(t.units) : '—'}</td><td style="text-align:right">${t.nav ? fmtNav(t.nav) : '—'}</td><td style="text-align:right">${t.balance ? fmtUnits(t.balance) : '—'}</td></tr>`;
    }).join('');

    panel.style.display = 'flex'; overlay.style.display = '';
  }

  function closeTransactionPanel() {
    document.getElementById('txn-panel').style.display = 'none';
    document.getElementById('panel-overlay').style.display = 'none';
  }

  function setScreen(id) {
    try {
      // 1. Hide all screens
      document.querySelectorAll('.screen').forEach(s => s.style.display = 'none');
      document.querySelectorAll('.screen-tab').forEach(t => t.classList.remove('active'));

      // 2. Show active screen
      const activeScreen = document.getElementById(`screen-${id}`);
      if (activeScreen) {
        activeScreen.style.display = 'flex';
        const activeTab = document.querySelector(`.screen-tab[data-screen="${id}"]`);
        if (activeTab) activeTab.classList.add('active');
      }

      // 3. Sync internal visibility
      const hasMF = (global.appState?.portfolios?.length > 0);
      const hasNPS = (global.appState?.npsPortfolios?.length > 0);
      const hasStocks = (global.appState?.stocksPortfolios?.length > 0);
      const hasSavings = (global.appState?.savings?.accounts?.length > 0 || global.appState?.savings?.fds?.length > 0 || global.appState?.savings?.rds?.length > 0);

      // Explicitly update MF view if switching to MF
      if (id === 'mf') updateMFViewState(hasMF);
      // Explicitly update Overview if switching to Overview
      if (id === 'overview') updateOverviewState(hasMF || hasNPS || hasStocks || hasSavings);
      // Render Goals screen if switching to Goals
      if (id === 'goals') renderGoalsDashboard(global.appState?.portfolios || [], global.appState?.npsPortfolios || []);
      // Explicitly update NPS if switching to NPS
      if (id === 'nps') updateNPSViewState(hasNPS);
      // Explicitly update Stocks if switching to Stocks
      if (id === 'stocks-in') updateStocksViewState(hasStocks);
      // Explicitly update Savings if switching to Savings
      if (id === 'savings') renderSavingsDashboard(global.appState?.savings);

      // 4. Update Global Nav Actions
      const addBtn = document.getElementById('nav-add-btn');
      const expBtn = document.getElementById('nav-export-btn');
      const impBtn = document.getElementById('nav-import-btn');
      const tabs   = document.getElementById('nav-person-tabs');
      const debug  = document.getElementById('nav-debug-btn');

      const showAdd = (id === 'mf' && hasMF) || (id === 'nps' && hasNPS) || (id === 'stocks-in' && hasStocks);

      if (addBtn) addBtn.style.display = showAdd ? '' : 'none';
      if (expBtn) expBtn.style.display = (id === 'mf' || id === 'nps' || id === 'stocks-in' || (id === 'overview' && (hasMF || hasNPS || hasStocks))) ? '' : 'none';
      if (impBtn) impBtn.style.display = (id === 'mf' || id === 'nps' || id === 'stocks-in' || (id === 'overview' && (hasMF || hasNPS || hasStocks))) ? '' : 'none';
      if (tabs)   tabs.style.display   = (id === 'mf' && hasMF) ? 'flex' : 'none';
      if (debug)  debug.style.display  = ((id === 'mf' && hasMF) || (id === 'nps' && hasNPS)) ? '' : 'none';

      // 5. Refresh data if necessary
      if (id === 'overview' && hasData) {
        setTimeout(() => renderLandingPage(global.appState), 10);
      }
    } catch (err) {
      console.error('FolioSense Navigation Error:', err);
      toast('error', 'Navigation Error', 'Something went wrong while switching screens.');
    }
  }

  function updateMFViewState(hasData) {
    const emptyEl = document.getElementById('mf-empty');
    const dashEl  = document.getElementById('mf-dashboard');
    if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';
    if (dashEl)  dashEl.style.display  = hasData ? 'flex' : 'none';
  }

  function updateNPSViewState(hasData) {
    const emptyEl = document.getElementById('nps-empty');
    const dashEl  = document.getElementById('nps-dashboard');
    const addBtn  = document.getElementById('nps-add-btn');
    if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';
    if (dashEl)  dashEl.style.display  = hasData ? 'flex' : 'none';
    if (addBtn)  addBtn.style.display  = hasData ? 'flex' : 'none';
  }

  function updateOverviewState(hasData) {
    const emptyEl = document.getElementById('ov-empty');
    const contentEl = document.getElementById('ov-content');
    if (emptyEl)   emptyEl.style.display   = hasData ? 'none' : 'flex';
    if (contentEl) contentEl.style.display = hasData ? 'grid' : 'none';
  }

  function updateStocksViewState(hasData) {
    const emptyEl = document.getElementById('stocks-in-broker-selection');
    const dashEl  = document.getElementById('stocks-in-dashboard');
    const uploadEl = document.getElementById('stocks-in-zerodha-upload');
    if (dashEl) dashEl.style.display = hasData ? 'flex' : 'none';
    if (emptyEl) emptyEl.style.display = hasData ? 'none' : 'flex';
    if (uploadEl) uploadEl.style.display = 'none'; // always hide upload initially
  }

  function renderStocksDashboard(stocksPortfolios) {
    if (!stocksPortfolios || stocksPortfolios.length === 0) return;
    
    let totalInvested = 0, currentCorpus = 0, totalPnL = 0;
    const allHoldings = [];

    stocksPortfolios.forEach(p => {
      totalInvested += p._summary.totalInvested || 0;
      currentCorpus += p._summary.totalCurrentValue || 0;
      totalPnL += p._summary.totalPnL || 0;
      allHoldings.push(...(p.holdings || []));
    });

    const gainPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
    
    const invEl = document.getElementById('st-invested-val');
    if (invEl) invEl.textContent = fmt(totalInvested);
    
    const curEl = document.getElementById('st-current-val');
    if (curEl) curEl.textContent = fmt(currentCorpus);
    
    const gainValEl = document.getElementById('st-gain-val');
    const gainPctEl = document.getElementById('st-gain-pct');
    if (gainValEl) {
      gainValEl.textContent = (totalPnL >= 0 ? '+' : '') + fmt(totalPnL);
      gainValEl.parentElement.classList.toggle('negative', totalPnL < 0);
    }
    if (gainPctEl) {
      gainPctEl.textContent = fmtPct(gainPct);
      gainPctEl.className = 'sc-sub ' + (gainPct >= 0 ? 'positive' : 'negative');
    }

    const topPerfEl = document.getElementById('st-top-perf');
    if (topPerfEl && allHoldings.length > 0) {
      const best = [...allHoldings].sort((a,b) => b.netChangePct - a.netChangePct)[0];
      topPerfEl.textContent = best.instrument;
      const sub = document.getElementById('st-top-perf-sub');
      if (sub) {
        sub.textContent = fmtPct(best.netChangePct);
        sub.className = 'sc-sub positive';
      }
    }
    
    const tbody = document.getElementById('stocks-tbody');
    if (tbody) {
      tbody.innerHTML = allHoldings.map(h => {
        const pClass = (h.pnl || 0) >= 0 ? 'positive' : 'negative';
        const dClass = (h.dayChangePct || 0) >= 0 ? 'positive' : 'negative';
        const pSign = (h.pnl || 0) >= 0 ? '+' : '';
        const dSign = (h.dayChangePct || 0) >= 0 ? '+' : '';
        return `<tr>
          <td><div class="td-fund-name">${h.instrument}</div></td>
          <td style="text-align:right">${h.qty}</td>
          <td style="text-align:right">${fmt(h.avgCost)}</td>
          <td style="text-align:right">${fmt(h.ltp)}</td>
          <td style="text-align:right">${fmt(h.invested)}</td>
          <td style="text-align:right"><strong>${fmt(h.currentValue)}</strong></td>
          <td style="text-align:right" class="${pClass}">${pSign}${fmt(h.pnl)}<br/><small>${fmtPct(h.netChangePct)}</small></td>
          <td style="text-align:right" class="${dClass}">${dSign}${fmtPct(h.dayChangePct)}</td>
        </tr>`;
      }).join('');
    }
  }

  /* ═══════════════════════════════════════════════ LANDING PAGE */
  let landingAllocChart = null;

  function renderLandingPage(state) {
    const portfolios = state.portfolios;
    const hasData = portfolios.length > 0
      || (state.stocksPortfolios && state.stocksPortfolios.length > 0)
      || (state.npsPortfolios && state.npsPortfolios.length > 0)
      || (state.savings && (state.savings.accounts.length > 0 || state.savings.fds.length > 0 || state.savings.rds.length > 0))
      || (state.nsc && state.nsc.length > 0);
    updateOverviewState(hasData);
    if (!hasData) return;

    // ── Mutual Funds ─────────────────────────────────────────────────────
    const summary = portfolios.length > 0
      ? Analytics.computePortfolioSummary(portfolios, state.liveNavMap)
      : { totalCurrentValue: 0, absoluteReturn: 0 };
    const mfTotal = summary.totalCurrentValue || 0;

    // ── Indian Stocks ────────────────────────────────────────────────────
    let stocksTotal = 0;
    if (state.stocksPortfolios && state.stocksPortfolios.length > 0) {
      state.stocksPortfolios.forEach(p => { stocksTotal += p._summary?.totalCurrentValue || 0; });
    }

    // ── NPS ───────────────────────────────────────────────────────────────
    let npsTotal = 0;
    if (state.npsPortfolios && state.npsPortfolios.length > 0) {
      state.npsPortfolios.forEach(portfolio => {
        (portfolio.tiers || []).forEach(tier => {
          (tier.schemes || []).forEach(scheme => {
            npsTotal += scheme.analytics?.currentValue || scheme.currentValue || 0;
          });
        });
      });
    }

    // ── Foreign Equities (ESOPs) ──────────────────────────────────────────
    let foreignTotal = 0;
    if (state.foreignEquities?.barclays?.grants?.length > 0) {
      const BARC_PRICE_GBP = 2.52; 
      const GBP_INR = 105.40;
      state.foreignEquities.barclays.grants.forEach(g => {
        foreignTotal += (parseFloat(g.qty) || 0) * BARC_PRICE_GBP * GBP_INR;
      });
    }

    // ── Bank Savings ──────────────────────────────────────────────────────
    let savingsTotal = 0;
    if (state.savings) {
      [...state.savings.accounts, ...state.savings.fds, ...state.savings.rds].forEach(item => {
        savingsTotal += (parseFloat(item.balance) || parseFloat(item.principal) || 0);
      });
    }

    // ── NSC ───────────────────────────────────────────────────────────────
    let nscTotal = 0;
    if (state.nsc) {
        state.nsc.forEach(item => {
            const principal = parseFloat(item.amount) || 0;
            const rate = (parseFloat(item.rate) || 7.7) / 100;
            const pDate = new Date(item.date);
            const yearsHeld = (new Date() - pDate) / (1000 * 60 * 60 * 24 * 365.25);
            nscTotal += principal * Math.pow(1 + rate, Math.max(0, yearsHeld));
        });
    }

    // ── EPF ───────────────────────────────────────────────────────────────
    let epfTotal = 0;
    if (state.epf) {
        state.epf.forEach(item => {
            epfTotal += (parseFloat(item.employeeShare) || 0) + (parseFloat(item.employerShare) || 0);
        });
    }

    const grandTotal = mfTotal + stocksTotal + npsTotal + savingsTotal + foreignTotal + nscTotal + epfTotal;

    // ── Update header ─────────────────────────────────────────────────────
    document.getElementById('landing-total-val').textContent = fmt(grandTotal);
    const deltaEl = document.getElementById('landing-total-delta');
    deltaEl.textContent = `${fmtPct(summary.absoluteReturn)} MF return`;
    deltaEl.className = 'ln-delta ' + (summary.absoluteReturn >= 0 ? 'positive' : 'negative');

    // ── Update asset cards ────────────────────────────────────────────────
    document.getElementById('ls-val-mf').textContent = fmt(mfTotal);
    const stocksEl = document.getElementById('ls-val-stocks');
    if (stocksEl) stocksEl.textContent = fmt(stocksTotal);
    const npsEl = document.getElementById('ls-val-nps');
    if (npsEl) npsEl.textContent = fmt(npsTotal);
    const foreignEl = document.getElementById('ls-val-foreign');
    if (foreignEl) foreignEl.textContent = fmt(foreignTotal);
    const savingsEl = document.getElementById('ls-val-savings');
    if (savingsEl) savingsEl.textContent = fmt(savingsTotal);
    const nscEl = document.getElementById('ls-val-nsc');
    if (nscEl) nscEl.textContent = fmt(nscTotal);
    const epfEl = document.getElementById('ls-val-epf');
    if (epfEl) epfEl.textContent = fmt(epfTotal);

    renderLandingGoals(summary, portfolios);
    renderLandingChart(mfTotal, stocksTotal, npsTotal, savingsTotal, foreignTotal, nscTotal, epfTotal);
  }

  function _buildGoalCards(portfolios, npsPortfolios, containerEl, onMetaChange) {
    containerEl.innerHTML = '';
    const goalsMeta = getGoalsMeta();
    const rows = buildRows(portfolios);
    const goalValues = {};
    const goalSIPs = {}; // goalName → total active SIP ₹/month from MF transactions

    // ── MF contributions to goals ─────────────────────────────────────
    rows.forEach(r => {
      const g = r.goal?.trim();
      if (!g) return;
      goalValues[g] = (goalValues[g] || 0) + (r.analytics?.currentValue || 0);
      const activeSIP = Analytics.computeActiveSIP(r.transactions || []);
      if (activeSIP > 0) goalSIPs[g] = (goalSIPs[g] || 0) + activeSIP;
    });

    // ── NPS contributions to goals ────────────────────────────────────
    const globalNPSGoal = getGoal('NPS_GLOBAL_GOAL')?.trim();
    (npsPortfolios || []).forEach(portfolio => {
      (portfolio.tiers || []).forEach(tier => {
        (tier.schemes || []).forEach(scheme => {
          const tierKey = tier.tier.replace(/\s+/g, '');
          const goalKey = `NPS_${tierKey}_${scheme.assetClass}`;
          // Prioritize specific goal if it exists, otherwise use global NPS goal
          const g = getGoal(goalKey)?.trim() || globalNPSGoal;
          if (!g) return;
          const val = scheme.analytics?.currentValue || scheme.currentValue || 0;
          goalValues[g] = (goalValues[g] || 0) + val;
        });
      });
    });

    // ── Bank Savings contributions to goals ───────────────────────────
    const savings = global.appState?.savings || { accounts: [], fds: [], rds: [] };
    [...savings.accounts, ...savings.fds, ...savings.rds].forEach(item => {
      const g = item.goal?.trim();
      if (!g) return;
      const val = parseFloat(item.balance || item.principal || 0);
      goalValues[g] = (goalValues[g] || 0) + val;
    });

    // ── Foreign Equities contributions to goals ───────────────────────
    const foreign = global.appState?.foreignEquities || {};
    if (foreign.barclays && foreign.barclays.goal) {
        const g = foreign.barclays.goal;
        const BARC_PRICE_GBP = 2.52; 
        const GBP_INR = 105.40;
        let bVal = 0;
        (foreign.barclays.grants || []).forEach(gr => {
            bVal += (parseFloat(gr.qty) || 0) * BARC_PRICE_GBP * GBP_INR;
        });
        goalValues[g] = (goalValues[g] || 0) + bVal;
    }

    // ── NSC contributions to goals ────────────────────────────────────
    const nsc = global.appState?.nsc || [];
    nsc.forEach(item => {
        const g = item.goal?.trim();
        if (!g) return;
        const principal = parseFloat(item.amount) || 0;
        const rate = (parseFloat(item.rate) || 7.7) / 100;
        const pDate = new Date(item.date);
        const yearsHeld = (new Date() - pDate) / (1000 * 60 * 60 * 24 * 365.25);
        const val = principal * Math.pow(1 + rate, Math.max(0, yearsHeld));
        goalValues[g] = (goalValues[g] || 0) + val;
    });

    // ── EPF contributions to goals ────────────────────────────────────
    const epf = global.appState?.epf || [];
    epf.forEach(item => {
        const g = item.goal?.trim();
        if (!g) return;
        const val = (parseFloat(item.employeeShare) || 0) + (parseFloat(item.employerShare) || 0);
        goalValues[g] = (goalValues[g] || 0) + val;
    });

    const allGoalNames = Array.from(new Set([...Object.keys(goalsMeta), ...Object.keys(goalValues)]));

    if (allGoalNames.length === 0) return false;

    const grid = document.createElement('div');
    grid.className = 'ov-goals-grid';

    allGoalNames.forEach(name => {
      const meta = goalsMeta[name] || { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
      const current = goalValues[name] || 0;
      const target = meta.targetAmount || 0;
      const years = meta.yearsToGoal || 10;
      const expectedReturn = meta.expectedReturn || 12;
      const inflation = (meta.inflation != null ? meta.inflation : 7);

      const currentSIP = goalSIPs[name] || 0;

      const adjTarget = Analytics.computeFutureValue(target, inflation / 100, years);
      const totalSIPNeeded = Analytics.computeMonthlySIP(adjTarget, current, expectedReturn / 100, years);
      const additionalSIPNeeded = Math.max(0, totalSIPNeeded - currentSIP);
      const fvOfCurrent = Analytics.computeFutureValue(current, expectedReturn / 100, years);
      const isAhead = (fvOfCurrent >= adjTarget);
      const sipFullyCovered = currentSIP > 0 && currentSIP >= totalSIPNeeded;
      const progressPct = adjTarget > 0 ? Math.min(100, (current / adjTarget) * 100) : 0;

      let statusLabel;
      if (isAhead || sipFullyCovered) {
        statusLabel = '<span class="status-badge ahead">✅ On Track</span>';
      } else if (totalSIPNeeded > 0) {
        statusLabel = `<span class="status-badge lagging">SIP Needed: ${fmt(totalSIPNeeded)}/mo</span>`;
      } else {
        statusLabel = '<span class="status-badge ahead">✅ On Track</span>';
      }

      let sipBlock = '';
      if (currentSIP > 0) {
        if (sipFullyCovered || isAhead) {
          sipBlock = `
            <div class="og-sip-block og-sip-ok">
              <div class="og-sip-row"><span class="og-label">Current MF SIP</span><span class="og-sip-val positive">${fmt(currentSIP)}<small>/mo</small></span></div>
              <div class="og-sip-suggestion ok">✅ Your current SIP is sufficient for this goal.</div>
            </div>`;
        } else {
          sipBlock = `
            <div class="og-sip-block og-sip-gap">
              <div class="og-sip-row"><span class="og-label">Current MF SIP</span><span class="og-sip-val">${fmt(currentSIP)}<small>/mo</small></span></div>
              <div class="og-sip-row"><span class="og-label">Total SIP Needed</span><span class="og-sip-val">${fmt(totalSIPNeeded)}<small>/mo</small></span></div>
              <div class="og-sip-suggestion gap">⚡ Increase SIP by <strong>${fmt(additionalSIPNeeded)}/mo</strong> to stay on track.</div>
            </div>`;
        }
      } else if (totalSIPNeeded > 0 && !isAhead) {
        sipBlock = `
          <div class="og-sip-block og-sip-gap">
            <div class="og-sip-suggestion gap">⚡ Start a SIP of <strong>${fmt(totalSIPNeeded)}/mo</strong> to reach this goal.</div>
          </div>`;
      }

      const card = document.createElement('div');
      card.className = 'ov-goal-card';
      card.innerHTML = `
        <div class="og-card-header">
          <div class="og-goal-info">
            <h4 class="og-name">${name}</h4>
            <div class="og-target-wrap"><span class="og-label">Inflation-Adj. Target</span><span class="og-adj-target">${fmt(adjTarget)}</span></div>
          </div>
          <div class="og-status-wrap">${statusLabel}</div>
        </div>
        <div class="og-progress-section">
          <div class="og-progress-labels"><span>Progress to Goal</span><span>${progressPct.toFixed(1)}%</span></div>
          <div class="og-bar-bg"><div class="og-bar-fill" style="width:${progressPct}%"></div></div>
        </div>
        <div class="og-details-grid">
          <div class="og-detail"><span class="og-label">Allocated Savings</span><span class="og-val">${fmt(current)}</span></div>
          <div class="og-detail"><span class="og-label">Target Amount (Today)</span><div class="og-input-wrap">₹<input type="text" class="goal-meta-input" data-goal="${name}" data-field="targetAmount" value="${target}" /></div></div>
          <div class="og-detail"><span class="og-label">Years to Goal</span><div class="og-input-wrap"><input type="text" class="goal-meta-input semibold" data-goal="${name}" data-field="yearsToGoal" value="${years}" /> yr</div></div>
          <div class="og-detail"><span class="og-label">Expected Return</span><div class="og-input-wrap"><input type="text" class="goal-meta-input semibold" data-goal="${name}" data-field="expectedReturn" value="${expectedReturn}" /> %</div></div>
          <div class="og-detail"><span class="og-label">Inflation Rate</span><div class="og-input-wrap"><input type="text" class="goal-meta-input semibold" data-goal="${name}" data-field="inflation" value="${inflation}" /> %</div></div>
        </div>
        ${sipBlock}
      `;
      grid.appendChild(card);
    });
    containerEl.appendChild(grid);

    containerEl.querySelectorAll('.goal-meta-input').forEach(input => {
      input.addEventListener('blur', (e) => {
        const { goal, field } = e.target.dataset;
        const val = parseFloat(e.target.value.replace(/,/g, '')) || 0;
        const meta = getGoalsMeta();
        const existing = meta[goal] || { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12, inflation: 7 };
        existing[field] = val;
        saveGoalMeta(goal, existing);
        if (onMetaChange) onMetaChange();
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    });

    return true; // has goals
  }

  function renderGoalsDashboard(portfolios, npsPortfolios) {
    const dashEl  = document.getElementById('goals-dashboard');
    const emptyEl = document.getElementById('goals-empty');
    const container = document.getElementById('goals-container');
    if (!dashEl || !emptyEl || !container) return;

    const hasGoals = _buildGoalCards(portfolios, npsPortfolios || [], container, () => renderGoalsDashboard(portfolios, npsPortfolios));

    if (hasGoals) {
      dashEl.style.display  = 'flex';
      emptyEl.style.display = 'none';
    } else {
      dashEl.style.display  = 'none';
      emptyEl.style.display = 'flex';
    }

    // Wire the dedicated "Add New Goal" button on this screen
    const addBtn = document.getElementById('btn-add-goal-dedicated');
    if (addBtn && !addBtn._wired) {
      addBtn._wired = true;
      addBtn.addEventListener('click', () => {
        openGoalManager(() => renderGoalsDashboard(portfolios, npsPortfolios));
      });
    }
  }

  function renderLandingGoals(summary, portfolios) {
    // This function is intentionally a no-op because the Overview page
    // no longer embeds a goals section — goals live on the dedicated Goals screen.
  }

  function renderNPSDashboard(npsPortfolios) {
    const tiersContainer = document.getElementById('nps-tiers-container');
    const preSchemes = document.getElementById('debug-schemes');
    const preLines = document.getElementById('debug-lines');

    if (!npsPortfolios || npsPortfolios.length === 0) {
      if (tiersContainer) tiersContainer.innerHTML = '';
      if (preSchemes) preSchemes.textContent = 'No NPS data loaded.';
      if (preLines) preLines.textContent = '';
      return;
    }
    
    if (tiersContainer) tiersContainer.innerHTML = '';

    let totalInvested = 0, currentCorpus = 0, gainLoss = 0;
    const allCashflows = [];
    let pfmLabel = '';

    npsPortfolios.forEach(portfolio => {
      if (portfolio.pfm) pfmLabel = portfolio.pfm;
      // If we have a summary total but schemes won't yield it, we'll try to use it
      let portfolioInvested = portfolio._summary?.totalInvested || 0;
      let schemesInvestedSum = 0;

      portfolio.tiers.forEach(tier => {
        const tierBlock = document.createElement('div');
        tierBlock.className = 'table-section';
        tierBlock.style.marginTop = '24px';
        
        let headerHTML = `<div class="table-header-row"><h3 class="table-heading">${tier.tier}</h3></div>`;
        let tableHTML = `<div class="table-wrap"><table class="txn-table">
          <thead>
            <tr>
              <th>Scheme Name</th>
              <th style="text-align:right">Units</th>
              <th style="text-align:right">NAV</th>
              <th style="text-align:right">Invested</th>
              <th style="text-align:right">Current</th>
              <th style="text-align:right">Gain</th>
              <th style="text-align:right">XIRR</th>
            </tr>
          </thead>
          <tbody>`;

        tier.schemes.forEach(scheme => {
          const a = scheme.analytics || {};
          schemesInvestedSum += a.totalInvested || 0;
          currentCorpus += a.currentValue || 0;

          if (scheme.transactions) {
            scheme.transactions.forEach(txn => {
              const isContrib = ['CONTRIBUTION','EMPLOYEE_CONTRIBUTION','EMPLOYER_CONTRIBUTION','VOLUNTARY_CONTRIBUTION'].includes(txn.type);
              const isWithdraw = txn.type === 'WITHDRAWAL';
              const amt = Math.abs(txn.rawAmount || 0);
              if (isContrib && amt > 0) {
                allCashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: -amt });
              } else if (isWithdraw && amt > 0) {
                allCashflows.push({ date: txn.date instanceof Date ? txn.date : new Date(txn.date), amount: amt });
              }
            });
          }

          const gSign = (a.gainLoss || 0) >= 0 ? '+' : '';
          const gClass = (a.gainLoss || 0) >= 0 ? 'positive' : 'negative';
          const xClass = (a.xirr || 0) >= 0 ? 'positive' : 'negative';

          tableHTML += `
            <tr>
              <td><div class="td-fund-name">${scheme.name}</div><div class="td-amc">Asset Class ${scheme.assetClass}</div></td>
              <td style="text-align:right">${fmtUnits(scheme.units)}</td>
              <td style="text-align:right">${fmtNav(scheme.nav)}</td>
              <td style="text-align:right">${fmt(a.totalInvested)}</td>
              <td style="text-align:right"><strong>${fmt(a.currentValue)}</strong></td>
              <td style="text-align:right" class="${gClass}">${gSign}${fmt(a.gainLoss)}<br/><small>${fmtPct(a.absoluteReturn)}</small></td>
              <td style="text-align:right" class="${xClass}"><strong>${a.xirr != null ? fmtXIRR(a.xirr) : '—'}</strong></td>
            </tr>
          `;
        });

        tableHTML += `</tbody></table></div>`;
        tierBlock.innerHTML = headerHTML + tableHTML;
        if (tiersContainer) tiersContainer.appendChild(tierBlock);
      });
      // After all tiers, check if we found any invested amount. If not, use the summary if available.
      if (schemesInvestedSum > 0) totalInvested += schemesInvestedSum;
      else totalInvested += portfolioInvested;
    });

    // Handle Global NPS Goal
    const globalGoalInput = document.getElementById('nps-global-goal');
    if (globalGoalInput) {
      globalGoalInput.value = getGoal('NPS_GLOBAL_GOAL');
      
      // Remove existing listener to avoid duplicates if possible (or just use one-time assignment if not already done)
      // Since renderNPSDashboard is called on every screen switch, we should be careful.
      // However, it's safer to just replace the element or clear listeners if we had a reference.
      // For now, we'll just add it once or ensure it's not multiplying.
      const newGlobalGoalInput = globalGoalInput.cloneNode(true);
      globalGoalInput.parentNode.replaceChild(newGlobalGoalInput, globalGoalInput);
      
      newGlobalGoalInput.addEventListener('blur', (e) => {
        saveGoal('NPS_GLOBAL_GOAL', e.target.value);
        if (global._FolioSense) {
          global._FolioSense.isDirtySinceExport = true;
          const dot = document.getElementById('export-reminder-dot');
          if (dot) dot.style.display = 'block';
        }
      });
      newGlobalGoalInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
    }

    gainLoss = currentCorpus - totalInvested;
    const absReturn = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;
    
    if (currentCorpus > 0 && allCashflows.length > 0) {
      allCashflows.push({ date: new Date(), amount: currentCorpus });
    }
    
    let xirrVal = null;
    if (global.Analytics?.xirr && allCashflows.length >= 2) {
      xirrVal = global.Analytics.xirr(allCashflows.filter(f => Math.abs(f.amount) > 0.01));
    }

    const pfmEl = document.getElementById('nps-pfm-label');
    if (pfmEl) pfmEl.textContent = pfmLabel || 'Protean CRA';
    
    const invEl = document.getElementById('nps-sc-invested');
    if (invEl) invEl.textContent = fmt(totalInvested);
    
    const curEl = document.getElementById('nps-sc-current');
    if (curEl) curEl.textContent = fmt(currentCorpus);
    
    const gainValEl = document.getElementById('nps-sc-gain');
    const gainPctEl = document.getElementById('nps-sc-gain-pct');
    if (gainValEl) {
      gainValEl.textContent = (gainLoss >= 0 ? '+' : '-') + fmt(Math.abs(gainLoss));
      gainValEl.parentElement.classList.toggle('negative', gainLoss < 0);
    }
    if (gainPctEl) {
      gainPctEl.textContent = fmtPct(absReturn);
      gainPctEl.className = 'sc-sub ' + (absReturn >= 0 ? 'positive' : 'negative');
    }
    
    const xirrEl = document.getElementById('nps-sc-xirr');
    if (xirrEl) xirrEl.textContent = xirrVal != null ? fmtXIRR(xirrVal) : '—';

    // Update Debug Panel
    if (preSchemes) preSchemes.textContent = JSON.stringify(npsPortfolios.map(p => ({
        investor: p.investor, pfm: p.pfm, summary: p._summary,
        tiers: p.tiers.map(t => ({ tier: t.tier, schemes: t.schemes.map(s => ({ name: s.name, ac: s.assetClass, units: s.units, nav: s.nav, val: s.currentValue, txns: s.transactions?.length })) }))
    })), null, 2);
    if (preLines && npsPortfolios[0]?._rawLines) preLines.textContent = npsPortfolios[0]._rawLines.slice(0, 80).join('\n');
  }

  /* ════════════════════════════════════════════════ FOREIGN EQUITIES DASHBOARD */
  function renderForeignEquitiesDashboard(fnData) {
    if (!fnData || !fnData.barclays) return;
    const { grants = [], goal = '' } = fnData.barclays;

    const BARC_PRICE_GBP = 2.52; 
    const GBP_INR = 105.40;

    let totalShares = 0;
    let totalValGBP = 0;
    let vestedShares = 0;
    let unvestedShares = 0;
    
    // For XIRR/CAGR calculation
    // We treat each grant as an inflow at Grant Price and today's valuation as a final outflow
    const cashflows = [];
    let initialDate = null;
    let totalInvestedGBP = 0;

    const tbody = document.getElementById('barclays-tbody');
    if (tbody) {
      if (grants.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:40px; color:var(--text3)">No grants added yet. Click "Add Grant" to begin.</td></tr>`;
      } else {
        tbody.innerHTML = grants.map((g, idx) => {
          const qty = (parseFloat(g.qty) || 0);
          const strike = (parseFloat(g.strike) || 0);
          const gDate = new Date(g.date);
          if (!initialDate || gDate < initialDate) initialDate = gDate;
          
          totalShares += qty;
          const valGBP = qty * BARC_PRICE_GBP;
          totalValGBP += valGBP;
          totalInvestedGBP += (qty * strike);

          if (g.status === 'Vested') vestedShares += qty;
          else unvestedShares += qty;
          
          // Cashflow for XIRR: -Cost at Grant Date
          // We use strike price as cost. If strike is 0 (award), cost is 0.
          cashflows.push({ date: gDate, amount: -(qty * strike) });

          const statusClass = g.status === 'Vested' ? 'positive' : 'warning';
          
          return `<tr>
            <td><div class="td-fund-name">${fmtDate(g.date)}</div><div class="td-amc">${g.plan || 'ESOP'}</div></td>
            <td><span style="font-size:11px; font-weight:600; padding:2px 8px; border-radius:12px; background:rgba(var(--${statusClass}-rgb),0.1); color:var(--${statusClass})">${g.status}</span></td>
            <td style="text-align:right">${qty.toLocaleString()}</td>
            <td style="text-align:right">£${strike.toFixed(2)}</td>
            <td style="text-align:right"><strong>£${valGBP.toLocaleString('en-GB', {minimumFractionDigits:2})}</strong></td>
            <td style="text-align:right">
              <button class="btn-icon btn-delete-esop" data-idx="${idx}" title="Delete" style="background:none; border:none; cursor:pointer; opacity:0.6">🗑️</button>
            </td>
          </tr>`;
        }).join('');
      }
    }

    // Final outflow for XIRR
    if (totalValGBP > 0) {
        cashflows.push({ date: new Date(), amount: totalValGBP });
    }

    // Calculate XIRR
    let xirrVal = null;
    if (cashflows.length >= 2) {
        // If all grants are free (strike 0), XIRR is infinite. 
        // We'll add a tiny cost to the first grant to allow calculation if needed, 
        // or just accept null which displays '—'
        try { xirrVal = Analytics.xirr(cashflows); } catch(e) { console.error(e); }
    }

    // Calculate Abs Return / CAGR
    let cagrVal = null;
    if (initialDate && totalInvestedGBP > 0) {
        const years = (new Date() - initialDate) / (1000 * 60 * 60 * 24 * 365.25);
        if (years > 0.1) {
            cagrVal = (Math.pow(totalValGBP / totalInvestedGBP, 1 / years) - 1);
        }
    }

    const setT = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setT('ba-total-shares', totalShares.toLocaleString());
    setT('ba-total-val-gbp', '£' + totalValGBP.toLocaleString('en-GB', {maximumFractionDigits:0}));
    setT('ba-total-val-inr', fmt(totalValGBP * GBP_INR));
    setT('ba-vested-split', `${vestedShares.toLocaleString()} Vested · ${unvestedShares.toLocaleString()} Unvested`);
    setT('ba-price-hint', `Price: £${BARC_PRICE_GBP.toFixed(4)}`);
    
    let xirrDisplay = '—';
    if (xirrVal != null) {
      xirrDisplay = (xirrVal * 100).toFixed(1) + '%';
    } else if (totalInvestedGBP === 0 && totalValGBP > 0) {
      xirrDisplay = '∞% (Bonus)';
    }
    setT('ba-xirr', xirrDisplay);
    setT('ba-cagr', cagrVal != null ? 'CAGR: ' + (cagrVal * 100).toFixed(1) + '%' : '—');

    // Populate Goal datalist
    const goalInput = document.getElementById('barclays-goal-input');
    const goalList = document.getElementById('barclays-goals-list');
    if (goalInput && goalList) {
        goalInput.value = goal || '';
        const goalNames = Object.keys(global.appState.goalsMetadata || {});
        goalList.innerHTML = goalNames.map(name => `<option value="${name}">`).join('');
    }
  }

  function renderNSCDashboard(nscList) {
    const list = nscList || [];
    const tbody = document.getElementById('nsc-tbody');
    const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    let totalInvested = 0;
    let totalCurrent = 0;

    if (tbody) {
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text3)">No NSC certificates added. Click "Add Certificate" to begin.</td></tr>`;
        } else {
            tbody.innerHTML = list.map(item => {
                const principal = parseFloat(item.amount) || 0;
                const rate = (parseFloat(item.rate) || 7.7) / 100;
                const pDate = new Date(item.date);
                const yearsHeld = (new Date() - pDate) / (1000 * 60 * 60 * 24 * 365.25);
                const maturityDate = new Date(pDate);
                maturityDate.setFullYear(maturityDate.getFullYear() + 5);

                // Annual compounding formula for NSC: P * (1 + r)^t
                // Though NSC is technically semi-annual but compounding is annual for interest.
                const val = principal * Math.pow(1 + rate, Math.max(0, yearsHeld));
                
                totalInvested += principal;
                totalCurrent += val;

                return `<tr>
                    <td><div class="td-fund-name">${item.label}</div><div class="td-amc">${item.goal || 'No Goal'}</div></td>
                    <td>${fmtDate(item.date)}</td>
                    <td>${fmtDate(maturityDate)}</td>
                    <td style="text-align:right">${fmt(principal)}</td>
                    <td style="text-align:right">${(rate * 100).toFixed(1)}%</td>
                    <td style="text-align:right"><strong>${fmt(val)}</strong></td>
                    <td style="text-align:right">
                        <button class="btn-icon btn-delete-nsc" data-id="${item.id}" title="Delete" style="background:none; border:none; cursor:pointer; opacity:0.6">🗑️</button>
                    </td>
                </tr>`;
            }).join('');
        }
    }

    const totalGains = totalCurrent - totalInvested;
    const yieldPct = totalInvested > 0 ? (totalGains / totalInvested) * 100 : 0;

    setT('nsc-total-invested', fmt(totalInvested));
    setT('nsc-total-current', fmt(totalCurrent));
    setT('nsc-total-gains', fmt(totalGains));
    setT('nsc-count', `${list.length} Certificate${list.length !== 1 ? 's' : ''}`);
    setT('nsc-yield', `${yieldPct.toFixed(1)}% Absolute Gain`);
  }

  function renderEPFDashboard(epfList) {
    const list = epfList || [];
    const tbody = document.getElementById('epf-tbody');
    const setT = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

    let totalEmployee = 0;
    let totalEmployer = 0;
    let totalMonthly = 0;

    if (tbody) {
        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:var(--text3)">No EPF accounts added. Click "Add Account" to begin.</td></tr>`;
        } else {
            tbody.innerHTML = list.map(item => {
                const emp = parseFloat(item.employeeShare) || 0;
                const mbr = parseFloat(item.employerShare) || 0;
                const mth = parseFloat(item.monthly) || 0;
                const total = emp + mbr;
                
                totalEmployee += emp;
                totalEmployer += mbr;
                totalMonthly += mth;

                return `<tr>
                    <td><div class="td-fund-name">${item.name}</div></td>
                    <td>${item.goal || 'No Goal'}</td>
                    <td style="text-align:right">${fmt(emp)}</td>
                    <td style="text-align:right">${fmt(mbr)}</td>
                    <td style="text-align:right"><strong>${fmt(total)}</strong></td>
                    <td style="text-align:right" class="positive">+${fmt(mth)}</td>
                    <td style="text-align:right">
                        <button class="btn-icon btn-delete-epf" data-id="${item.id}" title="Delete" style="background:none; border:none; cursor:pointer; opacity:0.6">🗑️</button>
                    </td>
                </tr>`;
            }).join('');
        }
    }

    setT('epf-total-employee', fmt(totalEmployee));
    setT('epf-total-employer', fmt(totalEmployer));
    setT('epf-total-current', fmt(totalEmployee + totalEmployer));
    setT('epf-total-monthly', fmt(totalMonthly) + ' monthly addition');
  }

  /* ════════════════════════════════════════════════ NSC DASHBOARD */
  let _activeSavingsType = 'account';

  function renderSavingsDashboard(savings) {
    if (!savings) return;
    const { accounts = [], fds = [], rds = [] } = savings;

    let totalBank = 0; accounts.forEach(a => totalBank += (parseFloat(a.balance) || 0));
    let totalFD = 0; fds.forEach(f => totalFD += (parseFloat(f.principal) || 0));
    let totalRD = 0; rds.forEach(r => totalRD += (parseFloat(r.principal) || 0));

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = fmt(val); };
    setVal('savings-total-bank', totalBank);
    setVal('savings-total-fd', totalFD);
    setVal('savings-total-rd', totalRD);

    const renderTable = (tbodyId, emptyId, data, type) => {
      const tbody = document.getElementById(tbodyId);
      const empty = document.getElementById(emptyId);
      if (!tbody || !empty) return;
      tbody.innerHTML = '';
      if (data.length === 0) { empty.style.display = 'block'; return; }
      empty.style.display = 'none';

      data.forEach((item, idx) => {
        const tr = document.createElement('tr');
        if (type === 'account') {
          tr.innerHTML = `
            <td><div class="td-fund-name">${item.bank}</div></td>
            <td>${item.type}</td>
            <td>${item.goal || '—'}</td>
            <td style="text-align:right"><strong>${fmt(item.balance)}</strong></td>
            <td style="text-align:right"><button class="btn btn-ghost" style="padding:4px" onclick="UI.deleteSavings('accounts', ${idx})">🗑️</button></td>
          `;
        } else {
          tr.innerHTML = `
            <td><div class="td-fund-name">${item.bank}</div></td>
            <td>${fmt(item.principal)}</td>
            <td>${item.rate}%</td>
            <td>${fmtDate(item.maturityDate)}</td>
            <td>${item.goal || '—'}</td>
            <td style="text-align:right"><strong>${fmt(item.maturityValue)}</strong></td>
            <td style="text-align:right"><button class="btn btn-ghost" style="padding:4px" onclick="UI.deleteSavings('${type}s', ${idx})">🗑️</button></td>
          `;
        }
        tbody.appendChild(tr);
      });
    };

    renderTable('savings-accounts-tbody', 'savings-accounts-empty', accounts, 'account');
    renderTable('savings-fd-tbody', 'savings-fd-empty', fds, 'fd');
    renderTable('savings-rd-tbody', 'savings-rd-empty', rds, 'rd');
  }

  function openSavingsModal(type) {
    _activeSavingsType = type;
    const modal = document.getElementById('savings-modal');
    const title = document.getElementById('savings-modal-title');
    const row2 = document.getElementById('sav-row-2');
    
    // Reset fields
    ['sav-bank','sav-val-1','sav-val-2','sav-date','sav-rate','sav-goal'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });

    if (type === 'account') {
      title.textContent = 'Add Savings Account';
      document.getElementById('sav-val-label-1').textContent = 'Current Balance (₹)';
      document.getElementById('sav-val-label-2').textContent = 'Account Type';
      document.getElementById('sav-val-2').placeholder = 'e.g. Savings, Salary...';
      row2.style.display = 'none';
    } else {
      title.textContent = type === 'fd' ? 'Add Fixed Deposit (FD)' : 'Add Recurring Deposit (RD)';
      document.getElementById('sav-val-label-1').textContent = type === 'fd' ? 'Principal Amount (₹)' : 'Monthly Deposit (₹)';
      document.getElementById('sav-val-label-2').textContent = 'Maturity Value (₹)';
      document.getElementById('sav-val-2').placeholder = 'Estimated maturity value';
      row2.style.display = 'grid';
    }
    modal.style.display = 'flex';
  }

  function closeSavingsModal() {
    document.getElementById('savings-modal').style.display = 'none';
  }

  function deleteSavings(category, idx) {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    const savings = global.appState?.savings;
    if (savings && savings[category]) {
      savings[category].splice(idx, 1);
      global.appState.isDirtySinceExport = true;
      if (global.refreshDashboard) global.refreshDashboard();
      else renderSavingsDashboard(savings);
    }
  }

  function getActiveSavingsType() { return _activeSavingsType; }

  function renderLandingChart(mfTotal, stocksTotal, npsTotal, savingsTotal, foreignTotal, nscTotal, epfTotal) {
    if (landingAllocChart) landingAllocChart.destroy();
    const ctx = document.getElementById('chart-landing-allocation').getContext('2d');
    if (!ctx) return;
    const data    = [mfTotal, stocksTotal, npsTotal, savingsTotal, foreignTotal, nscTotal || 0, epfTotal || 0];
    const labels  = ['Mutual Funds', 'Stocks', 'NPS', 'Savings', 'Foreign', 'NSC', 'EPF'];
    const colors  = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#facc15', '#6366f1'];
    // Only keep slices with a value
    const filtered = labels.map((l, i) => ({ l, d: data[i], c: colors[i] })).filter(x => x.d > 0);
    landingAllocChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: filtered.map(x => x.l),
        datasets: [{ data: filtered.map(x => x.d), backgroundColor: filtered.map(x => x.c), borderColor: 'transparent', hoverOffset: 10 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: '75%', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${fmt(ctx.raw)}` } } } }
    });
  }

  function openGoalManager(onSave) {
    const name = prompt("Enter Goal Name (e.g. Retirement, Children Education):");
    if (!name || !name.trim()) return;
    const gName = name.trim();
    const goalsMeta = getGoalsMeta();
    if (!goalsMeta[gName]) saveGoalMeta(gName, { targetAmount: 0, yearsToGoal: 10, expectedReturn: 12 });
    renderLandingPage(global.appState);
    if (onSave) onSave();
  }

  function updateBackupReminder(isVisible) {
    const dot = document.getElementById('export-reminder-dot');
    if (dot) dot.style.display = isVisible ? 'block' : 'none';
  }

  global.UI = {
    toast, showLoading, setLoading, hideLoading,
    renderSummaryCards, renderPersonTabs, renderCharts, renderTable, renderTableBody, initTableSort,
    openTransactionPanel, closeTransactionPanel, setScreen, updateMFViewState,
    renderLandingPage, renderGoalsDashboard, openGoalManager, buildRows, personColor, exportFullBackup, importFullData, updateBackupReminder,
    updateNPSViewState, renderNPSDashboard,
    renderNSCDashboard,
    renderStocksDashboard, updateStocksViewState,
    renderSavingsDashboard, renderForeignEquitiesDashboard, openSavingsModal, closeSavingsModal, deleteSavings, getActiveSavingsType
  };
})(window);
