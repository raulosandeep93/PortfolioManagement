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
      const hasData = (global.appState?.portfolios?.length > 0);

      // Explicitly update MF view if switching to MF
      if (id === 'mf') updateMFViewState(hasData);
      // Explicitly update Overview if switching to Overview
      if (id === 'overview') updateOverviewState(hasData);
      // Render Goals screen if switching to Goals
      if (id === 'goals') renderGoalsDashboard(global.appState?.portfolios || []);

      // 4. Update Global Nav Actions
      const addBtn = document.getElementById('nav-add-btn');
      const expBtn = document.getElementById('nav-export-btn');
      const impBtn = document.getElementById('nav-import-btn');
      const tabs   = document.getElementById('nav-person-tabs');
      const debug  = document.getElementById('nav-debug-btn');

      if (addBtn) addBtn.style.display = (id === 'mf' && hasData) ? '' : 'none';
      if (expBtn) expBtn.style.display = (id === 'mf' || (id === 'overview' && hasData)) ? '' : 'none';
      if (impBtn) impBtn.style.display = (id === 'mf' || (id === 'overview' && hasData)) ? '' : 'none';
      if (tabs)   tabs.style.display   = (id === 'mf' && hasData) ? 'flex' : 'none';
      if (debug)  debug.style.display  = (id === 'mf' && hasData) ? '' : 'none';

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

  function updateOverviewState(hasData) {
    const emptyEl = document.getElementById('ov-empty');
    const contentEl = document.getElementById('ov-content');
    if (emptyEl)   emptyEl.style.display   = hasData ? 'none' : 'flex';
    if (contentEl) contentEl.style.display = hasData ? 'grid' : 'none';
  }

  /* ═══════════════════════════════════════════════ LANDING PAGE */
  let landingAllocChart = null;

  function renderLandingPage(state) {
    const portfolios = state.portfolios;
    const hasData = portfolios.length > 0;
    updateOverviewState(hasData);
    if (!hasData) return;

    const summary = Analytics.computePortfolioSummary(portfolios, state.liveNavMap);
    document.getElementById('landing-total-val').textContent = fmt(summary.totalCurrentValue);
    const deltaEl = document.getElementById('landing-total-delta');
    deltaEl.textContent = `${fmtPct(summary.absoluteReturn)} overall return`;
    deltaEl.className = 'ln-delta ' + (summary.absoluteReturn >= 0 ? 'positive' : 'negative');
    document.getElementById('ls-val-mf').textContent = fmt(summary.totalCurrentValue);

    renderLandingGoals(summary, portfolios);
    renderLandingChart(summary, portfolios);
  }

  function _buildGoalCards(portfolios, containerEl, onMetaChange) {
    containerEl.innerHTML = '';
    const goalsMeta = getGoalsMeta();
    const rows = buildRows(portfolios);
    const goalValues = {};
    const goalSIPs = {}; // goalName → total active SIP ₹/month from MF transactions
    rows.forEach(r => {
      const g = r.goal?.trim();
      if (!g) return;
      goalValues[g] = (goalValues[g] || 0) + (r.analytics?.currentValue || 0);
      const activeSIP = Analytics.computeActiveSIP(r.transactions || []);
      if (activeSIP > 0) goalSIPs[g] = (goalSIPs[g] || 0) + activeSIP;
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

  function renderGoalsDashboard(portfolios) {
    const dashEl  = document.getElementById('goals-dashboard');
    const emptyEl = document.getElementById('goals-empty');
    const container = document.getElementById('goals-container');
    if (!dashEl || !emptyEl || !container) return;

    const hasGoals = _buildGoalCards(portfolios, container, () => renderGoalsDashboard(portfolios));

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
        openGoalManager(() => renderGoalsDashboard(portfolios));
      });
    }
  }

  function renderLandingGoals(summary, portfolios) {
    // This function is intentionally a no-op because the Overview page
    // no longer embeds a goals section — goals live on the dedicated Goals screen.
  }

  function renderLandingChart(summary, portfolios) {
    if (landingAllocChart) landingAllocChart.destroy();
    const ctx = document.getElementById('chart-landing-allocation').getContext('2d');
    if (!ctx) return;
    landingAllocChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Mutual Funds', 'Stocks', 'NPS', 'Foreign', 'Savings'],
        datasets: [{ data: [summary.totalCurrentValue, 0, 0, 0, 0], backgroundColor: ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444'], borderColor: 'transparent', hoverOffset: 10 }]
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
    renderLandingPage, renderGoalsDashboard, openGoalManager, buildRows, personColor, exportFullBackup, importFullData, updateBackupReminder
  };
})(window);
