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
    return dt.toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' });
  };

  /* ══════════════════════════════════════════ PERSON COLORS */
  const PERSON_COLORS = ['#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444','#ec4899','#14b8a6'];

  function personColor(idx) { return PERSON_COLORS[idx % PERSON_COLORS.length]; }

  /* ══════════════════════════════════════════ TOAST */
  function toast(type, title, msg, durationMs = 4000) {
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type]||'🔔'}</span>
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
    if (sub)   document.getElementById('loading-sub').textContent   = sub;
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

  /* ══════════════════════════════════════════ SUMMARY CARDS */
  function renderSummaryCards(summary) {
    const { totalInvested, totalCurrentValue, totalGainLoss, absoluteReturn, portfolioXIRR } = summary;

    document.getElementById('sc-invested-val').textContent = fmt(totalInvested);
    document.getElementById('sc-invested-sub').textContent = '';
    document.getElementById('sc-current-val').textContent  = fmt(totalCurrentValue);

    const gainEl    = document.getElementById('sc-gain');
    const gainValEl = document.getElementById('sc-gain-val');
    const gainPctEl = document.getElementById('sc-gain-pct');
    const glSign    = totalGainLoss >= 0 ? '+' : '-';
    gainValEl.textContent = glSign + fmt(Math.abs(totalGainLoss));
    gainPctEl.textContent = fmtPct(absoluteReturn);
    gainPctEl.className   = 'sc-sub ' + (absoluteReturn >= 0 ? 'positive' : 'negative');
    gainEl.classList.toggle('negative', totalGainLoss < 0);

    document.getElementById('sc-xirr-val').textContent =
      portfolioXIRR != null ? fmtXIRR(portfolioXIRR) : '—';
  }

  /* ══════════════════════════════════════════ PERSON TABS */
  function renderPersonTabs(portfolios, activeIdx, onSelect) {
    const container = document.getElementById('nav-person-tabs');
    const filterSel = document.getElementById('table-filter-person');
    container.innerHTML = '';
    filterSel.innerHTML = '<option value="">All Persons</option>';

    // "Combined" tab
    const allTab = document.createElement('button');
    allTab.className   = 'person-tab' + (activeIdx === -1 ? ' active' : '');
    allTab.textContent = '🔗 Combined';
    allTab.onclick     = () => onSelect(-1);
    container.appendChild(allTab);

    portfolios.forEach((p, idx) => {
      const name  = p.investor?.name || p._filename || `Portfolio ${idx + 1}`;
      const color = personColor(idx);

      const tab = document.createElement('button');
      tab.className  = 'person-tab' + (activeIdx === idx ? ' active' : '');
      tab.innerHTML  = `<span class="tab-dot" style="background:${color}"></span>${name}`;
      tab.onclick    = () => onSelect(idx);
      container.appendChild(tab);

      const opt = document.createElement('option');
      opt.value       = idx;
      opt.textContent = name;
      filterSel.appendChild(opt);
    });

    container.style.display    = 'flex';
    document.getElementById('nav-person-tabs').style.display = 'flex';
  }

  /* ══════════════════════════════════════════ CHARTS */
  let chartAMC = null, chartCat = null, chartTop = null;

  const CHART_COLORS = [
    '#10b981','#3b82f6','#f59e0b','#8b5cf6','#ef4444',
    '#ec4899','#14b8a6','#f97316','#06b6d4','#a3e635',
    '#e879f9','#fb923c','#22d3ee','#84cc16','#c084fc',
  ];

  function destroyCharts() {
    [chartAMC, chartCat, chartTop].forEach(c => c?.destroy());
    chartAMC = chartCat = chartTop = null;
  }

  function renderCharts(rows) {
    destroyCharts();

    // ── AMC allocation ──────────────────────────────────────
    const amcMap = {};
    for (const r of rows) {
      amcMap[r.amc] = (amcMap[r.amc] || 0) + (r.analytics?.currentValue || 0);
    }
    const amcLabels = Object.keys(amcMap).sort((a,b) => amcMap[b] - amcMap[a]);
    const amcData   = amcLabels.map(k => amcMap[k]);

    chartAMC = new Chart(document.getElementById('chart-amc'), {
      type: 'doughnut',
      data: {
        labels:   amcLabels,
        datasets: [{
          data:            amcData,
          backgroundColor: CHART_COLORS,
          borderColor:     'transparent',
          hoverOffset:     6,
        }],
      },
      options: chartDoughnutOptions(),
    });

    // ── Category split ──────────────────────────────────────
    const catMap = { EQUITY:0, DEBT:0, HYBRID:0, OTHER:0 };
    for (const r of rows) catMap[r.analytics?.category || 'EQUITY'] += (r.analytics?.currentValue || 0);
    const catColors = { EQUITY:'#3b82f6', DEBT:'#f59e0b', HYBRID:'#10b981', OTHER:'#8b5cf6' };
    const catEntries= Object.entries(catMap).filter(([,v]) => v > 0);

    chartCat = new Chart(document.getElementById('chart-cat'), {
      type: 'doughnut',
      data: {
        labels:   catEntries.map(([k]) => k.charAt(0) + k.slice(1).toLowerCase()),
        datasets: [{
          data:            catEntries.map(([,v]) => v),
          backgroundColor: catEntries.map(([k]) => catColors[k]),
          borderColor:     'transparent',
          hoverOffset:     6,
        }],
      },
      options: chartDoughnutOptions(),
    });

    // ── Top holdings bar ────────────────────────────────────
    const sorted = [...rows].sort((a,b) => (b.analytics?.currentValue||0) - (a.analytics?.currentValue||0)).slice(0, 8);
    chartTop = new Chart(document.getElementById('chart-top'), {
      type: 'bar',
      data: {
        labels:   sorted.map(r => r.name.length > 25 ? r.name.slice(0,23)+'…' : r.name),
        datasets: [{
          label:           'Current Value',
          data:            sorted.map(r => r.analytics?.currentValue || 0),
          backgroundColor: sorted.map((_, i) => CHART_COLORS[i % CHART_COLORS.length] + 'cc'),
          borderRadius:    6,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => fmt(ctx.raw) } } },
        scales: {
          x: { ticks: { color:'#475569', callback: v => '₹' + (v/1e5).toFixed(0)+'L' }, grid: { color:'rgba(255,255,255,0.04)' }, border:{display:false} },
          y: { ticks: { color:'#94a3b8', font:{size:11} }, grid: { display: false }, border:{display:false} },
        },
      },
    });
  }

  function chartDoughnutOptions() {
    return {
      responsive: true, maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color:'#94a3b8', boxWidth:12, padding:12, font:{size:11} },
        },
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
      const pName  = portfolio.investor?.name || portfolio._filename || `Portfolio ${pIdx+1}`;
      const pColor = personColor(pIdx);

      for (const folio of (portfolio.folios || [])) {
        for (const scheme of (folio.schemes || [])) {
          const goalKey = (folio.folio || 'NA') + '_' + (scheme.isin || scheme.amfiCode || scheme.name || 'NA');
          rows.push({
            ...scheme,
            amc:       folio.amc || '',
            folio:     folio.folio || '',
            personIdx: pIdx,
            personName:pName,
            personColor:pColor,
            name:      scheme.name || '—',
            goalKey:   goalKey,
            goal:      getGoal(goalKey),
          });
        }
      }
    });
    return rows;
  }

  function filterRows(rows, searchTerm, catFilter, personFilter) {
    return rows.filter(r => {
      if (searchTerm) {
        const q   = searchTerm.toLowerCase();
        const hit = r.name.toLowerCase().includes(q) || r.amc.toLowerCase().includes(q);
        if (!hit) return false;
      }
      if (catFilter && r.analytics?.category !== catFilter) return false;
      if (personFilter !== '' && personFilter != null && r.personIdx !== +personFilter) return false;
      return true;
    });
  }

  function sortRows(rows, col, dir) {
    const get = (r) => {
      switch(col) {
        case 'name':    return r.name?.toLowerCase() || '';
        case 'person':  return r.personName?.toLowerCase() || '';
        case 'goal':    return r.goal?.toLowerCase() || '';
        case 'units':   return r.analytics?.units || 0;
        case 'nav':     return r.analytics?.casNav || 0;
        case 'liveNav': return r.analytics?.liveNav || r.analytics?.casNav || 0;
        case 'invested':return r.analytics?.totalInvested || 0;
        case 'current': return r.analytics?.currentValue || 0;
        case 'gain':    return r.analytics?.gainLoss || 0;
        case 'xirr':    return r.analytics?.xirr ?? -99;
        default:        return 0;
      }
    };
    return [...rows].sort((a,b) => {
      const va = get(a), vb = get(b);
      if (typeof va === 'string') return dir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return dir === 'asc' ? va - vb : vb - va;
    });
  }

  function renderTable(portfolios, activePersonIdx, onRowClick) {
    _allRows = buildRows(portfolios);
    renderTableBody(portfolios, onRowClick, activePersonIdx);
  }

  function renderTableBody(portfolios, onRowClick, activePersonIdx) {
    const search    = (document.getElementById('table-search')?.value || '').trim();
    const catFilter = document.getElementById('table-filter-cat')?.value || '';
    const pFilter   = document.getElementById('table-filter-person')?.value ?? '';

    let rows = filterRows(_allRows, search, catFilter, pFilter);
    rows     = sortRows(rows, _sortCol, _sortDir);

    const tbody   = document.getElementById('holdings-tbody');
    const emptyEl = document.getElementById('table-empty');
    tbody.innerHTML = '';

    if (rows.length === 0) {
      emptyEl.style.display = '';
      return;
    }
    emptyEl.style.display = 'none';

    const multiPerson = portfolios.length > 1;
    const personTh    = document.querySelector('.th-person');
    if (personTh) personTh.style.display = multiPerson ? '' : 'none';

    rows.forEach(r => {
      const a         = r.analytics || {};
      const catClass  = { EQUITY:'badge-equity', DEBT:'badge-debt', HYBRID:'badge-hybrid', OTHER:'badge-other' }[a.category||'EQUITY'] || 'badge-other';
      const gainSign  = (a.gainLoss || 0) >= 0 ? 'positive' : 'negative';
      const xirrSign  = (a.xirr || 0) >= 0 ? 'positive' : 'negative';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="td-fund-name">${r.name}</div>
          <div class="td-amc">${r.amc} · ${r.folio}</div>
          <span class="td-cat-badge ${catClass}">${(a.category||'EQUITY').charAt(0)+(a.category||'EQUITY').slice(1).toLowerCase()}</span>
        </td>
        ${multiPerson ? `<td><span class="td-person-badge" style="background:${r.personColor}22;color:${r.personColor}">${r.personName}</span></td>` : ''}
        <td>
          <input type="text" class="goal-input" data-key="${r.goalKey}" value="${r.goal || ''}" placeholder="Add goal..." />
        </td>
        <td>${fmtUnits(a.units)}</td>
        <td>${fmtNav(a.casNav)}</td>
        <td class="td-live-nav">
          ${fmtNav(a.liveNav || a.casNav)}
          ${a.isLiveNav ? '<span class="live-tag">LIVE</span>' : '<span class="cas-tag">CAS</span>'}
        </td>
        <td>${fmt(a.totalInvested)}</td>
        <td><strong>${fmt(a.currentValue)}</strong></td>
        <td class="${gainSign}">
          ${(a.gainLoss||0) >= 0 ? '+' : ''}${fmt(a.gainLoss)}<br/>
          <small>${fmtPct(a.absoluteReturn)}</small>
        </td>
        <td class="${xirrSign}"><strong>${a.xirr != null ? fmtXIRR(a.xirr) : '—'}</strong></td>
      `.trim();

      tr.addEventListener('click', (e) => {
        if (!e.target.classList.contains('goal-input')) {
          onRowClick && onRowClick(r);
        }
      });
      tbody.appendChild(tr);
    });

    // Attach event listeners to goal inputs
    document.querySelectorAll('.goal-input').forEach(input => {
      // Save on blur
      input.addEventListener('blur', (e) => {
        const key = e.target.dataset.key;
        saveGoal(key, e.target.value);
        // update the cached row data
        const rowData = _allRows.find(r => r.goalKey === key);
        if (rowData) rowData.goal = e.target.value.trim();
      });
      // Save on enter
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') e.target.blur();
      });
    });
  }

  function initTableSort(portfolios, onRowClick) {
    document.querySelectorAll('#holdings-table th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.col;
        if (_sortCol === col) _sortDir = _sortDir === 'asc' ? 'desc' : 'asc';
        else { _sortCol = col; _sortDir = 'desc'; }
        document.querySelectorAll('#holdings-table th').forEach(t => t.classList.remove('sort-asc','sort-desc'));
        th.classList.add(_sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
        renderTableBody(portfolios, onRowClick);
      });
    });
  }

  /* ═══════════════════════════════════════ TRANSACTION PANEL */
  function openTransactionPanel(row) {
    const a      = row.analytics || {};
    const panel  = document.getElementById('txn-panel');
    const overlay= document.getElementById('panel-overlay');

    document.getElementById('txn-panel-title').textContent = row.name;
    document.getElementById('txn-panel-sub').textContent   =
      `${row.amc}  ·  ISIN: ${row.isin || '—'}  ·  AMFI: ${row.amfiCode || '—'}`;

    // Stats
    document.getElementById('txn-panel-stats').innerHTML = `
      <div class="panel-stat">
        <div class="panel-stat-label">Invested</div>
        <div class="panel-stat-value">${fmt(a.totalInvested)}</div>
      </div>
      <div class="panel-stat">
        <div class="panel-stat-label">Current Value</div>
        <div class="panel-stat-value">${fmt(a.currentValue)}</div>
      </div>
      <div class="panel-stat">
        <div class="panel-stat-label">XIRR</div>
        <div class="panel-stat-value ${(a.xirr||0)>=0?'positive':'negative'}">${a.xirr != null ? fmtXIRR(a.xirr) : '—'}</div>
      </div>
    `;

    // Transactions
    const tbody    = document.getElementById('txn-tbody');
    const txns     = [...(row.transactions || [])].sort((a,b) => b.date - a.date);
    const typeClass= {
      PURCHASE:'txn-purchase', PURCHASE_SIP:'txn-sip', REDEMPTION:'txn-redemption',
      SWITCH_IN:'txn-switch', SWITCH_OUT:'txn-switch',
      DIVIDEND:'txn-dividend', DIVIDEND_REINVEST:'txn-dividend', OTHER:'txn-other',
    };

    tbody.innerHTML = txns.map(t => {
      const cls   = typeClass[t.type] || 'txn-other';
      const label = t.type?.replace(/_/g,' ') || 'OTHER';
      const amtCls= ['REDEMPTION','SWITCH_OUT'].includes(t.type) ? 'positive' : ['PURCHASE','PURCHASE_SIP','SWITCH_IN'].includes(t.type) ? 'negative' : '';
      return `<tr>
        <td>${fmtDate(t.date)}</td>
        <td><span class="txn-type-badge ${cls}">${label}</span></td>
        <td style="text-align:right" class="${amtCls}">${t.rawAmount ? fmt(t.rawAmount) : '—'}</td>
        <td style="text-align:right">${t.units ? fmtUnits(t.units) : '—'}</td>
        <td style="text-align:right">${t.nav ? fmtNav(t.nav) : '—'}</td>
        <td style="text-align:right">${t.balance ? fmtUnits(t.balance) : '—'}</td>
      </tr>`;
    }).join('');

    panel.style.display   = 'flex';
    overlay.style.display = '';
  }

  function closeTransactionPanel() {
    document.getElementById('txn-panel').style.display    = 'none';
    document.getElementById('panel-overlay').style.display= 'none';
  }

  /* ═══════════════════════════════════════════════ SCREEN SWITCH */
  function showDashboard() {
    document.getElementById('upload-screen').style.display    = 'none';
    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('dashboard-screen').style.display = 'flex';
    document.getElementById('nav-add-btn').style.display      = '';
    document.getElementById('nav-debug-btn').style.display    = '';
    document.getElementById('nav-person-tabs').style.display  = '';
  }
  function showUpload() {
    document.getElementById('upload-screen').style.display    = '';
    document.getElementById('upload-screen').classList.add('active');
    document.getElementById('dashboard-screen').style.display = 'none';
  }

  global.UI = {
    toast, showLoading, setLoading, hideLoading,
    renderSummaryCards, renderPersonTabs,
    renderCharts, renderTable, renderTableBody, initTableSort,
    openTransactionPanel, closeTransactionPanel,
    showDashboard, showUpload, buildRows,
    personColor,
  };
})(window);
