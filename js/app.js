/**
 * FinanzasPR — orquestación UI, router hash, tema, vistas.
 */
import {
  getSession,
  onAuthStateChange,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signOut,
  fetchProfile,
  updateProfile,
} from './auth.js';
import { createSharedSpace, joinSharedSpace, fetchMyGroup, fetchGroupMembers, updateGroupSettings } from './groups.js';
import {
  fetchCategories,
  fetchTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  startOfMonth,
  endOfMonth,
  shiftMonth,
  monthToInputValue,
  parseMonthInput,
  isFutureMonth,
  isSameMonth,
  normalizeMonth,
} from './transactions.js';
import { computeBalances, displayName, formatMoney, monthLabel, computeSharedContributions, resolveSplitRatio, sumMemberIncome } from './balances.js';
import {
  computeBucketRows,
  computeCategoryBreakdown,
  computeTopExpenses,
  formatMonthDelta,
} from './analytics.js';
import { getFinancialTip } from './tips.js';
import {
  fetchBudgets,
  upsertBudget,
  copyBudgetsFromPreviousMonth,
  computeBudgetUsage,
  computeBudgetEditorRows,
  computeBucketRemaining,
  bucketRemainingLabel,
} from './budgets.js';
import { fetchMonthlyTrend, countMonthsWithData, maxTrendExpenses } from './trends.js';
import {
  fetchGoals,
  fetchAllGoals,
  createGoal,
  completeGoal,
  deleteGoal,
  enrichGoalsWithProgress,
} from './goals.js';
import {
  fetchSettlementsForMonth,
  fetchSettlementsHistory,
  recordSettlement,
  isSettlementCovered,
} from './settlements.js';

/** @type {{ session: any, profile: any, group: any, members: any[], categories: any[], transactions: any[], budgets: any[], goals: any[], goalTransactions: any[], trendRows: any[], settlements: any[], settlementsHistory: any[] }} */
const state = {
  session: null,
  profile: null,
  group: null,
  members: [],
  categories: [],
  transactions: [],
  prevMonthTransactions: [],
  budgets: [],
  goals: [],
  goalTransactions: [],
  trendRows: [],
  settlements: [],
  settlementsHistory: [],
  selectedMonth: normalizeMonth(new Date()),
  monthPickerSync: false,
  sessionInitDone: false,
  authMode: 'login', // login | register
};

/** Categorías que ya mostraron toast de sobrepresupuesto en esta sesión. */
const budgetToastShown = new Set();

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function showToast(message, type = 'info') {
  const host = $('#toast-host');
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function copyText(text, successMessage = 'Copiado') {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, 'success');
  } catch {
    showToast(text, 'info');
  }
}

function setLoading(on) {
  $('#loading').classList.toggle('hidden', !on);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  $('#theme-toggle-icon').textContent = theme === 'dark' ? '☀️' : '🌙';
}

function initTheme() {
  const saved = localStorage.getItem('theme');
  const theme =
    saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(theme);
  $('#theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  });
}

function navigate(hash) {
  let view = (hash || '#login').replace('#', '') || 'login';
  const allowedGuest = ['login'];
  const needsAuth = !allowedGuest.includes(view);

  if (!state.session && needsAuth) {
    view = 'login';
    if (location.hash.replace('#', '') !== 'login') {
      location.hash = '#login';
    }
  } else if (state.session && view === 'login') {
    location.hash = state.profile?.group_id ? '#dashboard' : '#onboarding';
    return;
  } else if (state.session && !state.profile?.group_id && view !== 'onboarding' && view !== 'login' && view !== 'perfil') {
    location.hash = '#onboarding';
    return;
  }

  $$('.view').forEach((el) => el.classList.remove('active'));
  const target = $(`#view-${view}`) || (state.session ? $('#view-dashboard') : $('#view-login'));
  target?.classList.add('active');

  $$('#bottom-nav a, #sidebar a[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === view);
  });

  const showChrome = Boolean(state.session && state.profile?.group_id);
  $('#bottom-nav').classList.toggle('hidden', !showChrome);
  $('#sidebar').classList.toggle('hidden', !showChrome);
  $('#global-month-nav').classList.toggle('hidden', !showChrome);
  $('#user-chip').classList.toggle('hidden', !state.session);
  $('#user-chip')?.classList.toggle('active', view === 'perfil');
  $('#logout-btn').classList.toggle('hidden', !state.session);

  if (showChrome) updateMonthNavUi();

  try {
    if (view === 'dashboard' && showChrome) renderDashboard();
    if (view === 'transacciones' && showChrome) renderTransactions();
    if (view === 'liquidacion' && showChrome) renderSettlement();
    if (view === 'presupuestos' && showChrome) renderPresupuestos();
    if (view === 'informes' && showChrome) renderInformes();
    if (view === 'metas' && showChrome) renderMetas();
    if (view === 'perfil' && state.session) renderPerfil();
  } catch (err) {
    console.error('[FinanzasPR] Error renderizando vista:', view, err);
    showToast('Hubo un problema al mostrar esta vista. Revisa la consola.', 'error');
  }
}

function refreshCurrentView() {
  const view = location.hash.replace('#', '') || 'dashboard';
  if (view === 'transacciones') renderTransactions();
  else if (view === 'liquidacion') renderSettlement();
  else if (view === 'presupuestos') renderPresupuestos();
  else if (view === 'informes') renderInformes();
  else if (view === 'metas') renderMetas();
  else if (view === 'perfil') renderPerfil();
  else renderDashboard();
}

function updateUserChip() {
  if (!state.session) return;
  const name = displayName(state.profile) || state.session.user.email;
  $('#user-name').textContent = name;
  const sidebarName = $('#sidebar-user-name');
  if (sidebarName) sidebarName.textContent = name;
  const avatar = $('#user-avatar');
  const sidebarAvatar = $('#sidebar-avatar');
  const initial = (name || '?').charAt(0).toUpperCase();
  avatar.textContent = initial;
  if (sidebarAvatar) sidebarAvatar.textContent = initial;
}

async function fetchOptional(label, promise, fallback) {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[FinanzasPR] No se pudo cargar ${label}:`, err);
    return fallback;
  }
}

async function refreshData() {
  if (!state.session?.user) return;
  const userId = state.session.user.id;
  state.profile = await fetchProfile(userId);
  updateUserChip();

  if (!state.profile?.group_id) {
    state.group = null;
    state.members = [];
    state.categories = [];
    state.transactions = [];
    state.prevMonthTransactions = [];
    state.budgets = [];
    state.goals = [];
    state.goalTransactions = [];
    state.trendRows = [];
    state.settlements = [];
    state.settlementsHistory = [];
    return;
  }

  state.group = await fetchMyGroup(state.profile.group_id);
  state.members = await fetchGroupMembers(state.profile.group_id);
  state.categories = await fetchCategories(state.profile.group_id);

  const month = state.selectedMonth;
  const prevMonth = shiftMonth(month, -1);
  const fetchWithTimeout = (promise, ms = 15000) =>
    Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tiempo de espera agotado al cargar datos')), ms)
      ),
    ]);

  const [transactions, prevMonthTransactions, budgets, goals, settlements, settlementsHistory, trendRows] =
    await Promise.all([
      fetchWithTimeout(
        fetchTransactions(state.profile.group_id, {
          from: startOfMonth(month),
          to: endOfMonth(month),
        })
      ),
      fetchWithTimeout(
        fetchTransactions(state.profile.group_id, {
          from: startOfMonth(prevMonth),
          to: endOfMonth(prevMonth),
        })
      ),
      fetchOptional('presupuestos', fetchWithTimeout(fetchBudgets(state.profile.group_id, month)), []),
      fetchOptional('metas', fetchWithTimeout(fetchGoals(userId)), []),
      fetchOptional(
        'liquidaciones del mes',
        fetchWithTimeout(fetchSettlementsForMonth(state.profile.group_id, month)),
        []
      ),
      fetchOptional(
        'historial de liquidaciones',
        fetchWithTimeout(fetchSettlementsHistory(state.profile.group_id)),
        []
      ),
      fetchOptional(
        'tendencias',
        fetchWithTimeout(fetchMonthlyTrend(state.profile.group_id, month, userId, state.members)),
        []
      ),
    ]);

  const hasCategoryGoals = goals.some((g) => g.category_id);
  const goalTransactions = hasCategoryGoals
    ? await fetchOptional(
        'movimientos para metas',
        fetchWithTimeout(fetchTransactions(state.profile.group_id)),
        []
      )
    : [];

  state.transactions = transactions;
  state.prevMonthTransactions = prevMonthTransactions;
  state.budgets = budgets;
  state.goals = goals;
  state.goalTransactions = goalTransactions;
  state.settlements = settlements;
  state.settlementsHistory = settlementsHistory;
  state.trendRows = trendRows;
}

function updateMonthNavUi() {
  const picker = $('#month-picker');
  const nextBtn = $('#month-next');
  if (!picker) return;
  state.monthPickerSync = true;
  picker.value = monthToInputValue(state.selectedMonth);
  picker.max = monthToInputValue(new Date());
  if (nextBtn) nextBtn.disabled = isSameMonth(state.selectedMonth, new Date());
  state.monthPickerSync = false;
}

async function changeSelectedMonth(nextDate) {
  if (isFutureMonth(nextDate)) return;
  state.selectedMonth = normalizeMonth(nextDate);
  updateMonthNavUi();
  setLoading(true);
  try {
    await refreshData();
    const view = location.hash.replace('#', '') || 'dashboard';
    if (view === 'transacciones') renderTransactions();
    else if (view === 'liquidacion') renderSettlement();
    else if (view === 'presupuestos') renderPresupuestos();
    else if (view === 'informes') renderInformes();
    else if (view === 'metas') renderMetas();
    else renderDashboard();
  } catch (err) {
    showToast(err.message || 'No se pudo cargar el mes', 'error');
  } finally {
    setLoading(false);
  }
}

function renderCardDelta(elId, current, previous, options = {}) {
  const el = $(elId);
  if (!el) return;
  const delta = formatMonthDelta(current, previous, options);
  if (!delta) {
    el.textContent = '';
    el.className = 'card-delta hidden';
    return;
  }
  el.textContent = delta.text;
  el.className = `card-delta ${delta.class}`;
}

function txRowHtml(tx, { showActions = false } = {}) {
  const cat = tx.categories;
  const isIncome = cat?.type === 'ingreso';
  const amountClass = isIncome ? 'income' : 'expense';
  const sign = isIncome ? '+' : '−';
  const badge = tx.is_shared
    ? '<span class="badge">Compartido</span>'
    : '<span class="badge badge-personal">Personal</span>';
  const desc = tx.description || cat?.name || 'Movimiento';
  const actions = showActions
    ? `<div class="tx-actions">
        <button type="button" class="btn-edit-ghost" data-edit-tx="${tx.id}" title="Editar">Editar</button>
        <button type="button" class="btn-danger-ghost" data-delete-tx="${tx.id}" title="Eliminar">Eliminar</button>
      </div>`
    : '';

  return `
    <li class="tx-item" data-tx-id="${tx.id}">
      <div class="tx-icon">${cat?.icon || '💵'}</div>
      <div class="tx-body">
        <strong>${escapeHtml(desc)}${badge}</strong>
        <div class="tx-meta">${escapeHtml(cat?.name || '')} · ${tx.date}</div>
      </div>
      <div class="tx-side">
        <div class="tx-amount ${amountClass}">${sign}${formatMoney(tx.amount)}</div>
        ${actions}
      </div>
    </li>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function animateCountUp(el, endText, duration = 600) {
  if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (el) el.textContent = endText;
    return;
  }
  const match = endText.match(/^([^0-9\-]*)([\d,.\-]+)(.*)$/);
  if (!match) {
    el.textContent = endText;
    return;
  }
  const prefix = match[1];
  const suffix = match[3];
  const end = parseFloat(match[2].replace(/,/g, ''));
  if (Number.isNaN(end)) {
    el.textContent = endText;
    return;
  }
  const start = 0;
  const startTime = performance.now();
  el.classList.add('counting');
  function tick(now) {
    const t = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = start + (end - start) * eased;
    const formatted =
      match[2].includes('.') || match[2].includes(',')
        ? val.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : Math.round(val).toLocaleString('es-MX');
    el.textContent = `${prefix}${formatted}${suffix}`;
    if (t < 1) requestAnimationFrame(tick);
    else {
      el.textContent = endText;
      el.classList.remove('counting');
    }
  }
  requestAnimationFrame(tick);
}

function replayAnimations(root) {
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.animate-in').forEach((el) => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = '';
  });
}

function renderDashboard() {
  const userId = state.session.user.id;
  const stats = computeBalances(state.transactions, userId, state.members);
  const prevStats = computeBalances(state.prevMonthTransactions, userId, state.members);

  const greetingEl = $('#dashboard-greeting');
  if (greetingEl) {
    const name = displayName(state.profile);
    greetingEl.textContent = name ? `${getGreeting()}, ${name.split(' ')[0]}` : getGreeting();
  }

  const monthText = capitalize(monthLabel(state.selectedMonth));
  const isCurrent = isSameMonth(state.selectedMonth, new Date());
  $('#dashboard-month-label').textContent = isCurrent
    ? `${monthText} — claridad sin presión`
    : `${monthText} — mes seleccionado`;

  $('#sum-income').textContent = formatMoney(stats.ingresos);
  renderCardDelta('#sum-income-delta', stats.ingresos, prevStats.ingresos);

  $('#sum-expenses').textContent = formatMoney(stats.gastosTotales);
  renderCardDelta('#sum-expenses-delta', stats.gastosTotales, prevStats.gastosTotales, {
    invert: true,
  });

  if (stats.gastosTotales > 0) {
    $('#sum-expenses-ctx').textContent = `Personal ${formatMoney(stats.gastosPersonales)} · Hogar ${formatMoney(stats.gastosCompartidosMiParte)}`;
  } else {
    $('#sum-expenses-ctx').textContent = 'Personales + tu parte del hogar';
  }

  $('#sum-shared').textContent = formatMoney(stats.gastosCompartidosBruto);

  const netEl = $('#sum-net');
  const netFormatted = formatMoney(stats.balancePersonal);
  animateCountUp(netEl, netFormatted);
  netEl.classList.toggle('positive', stats.balancePersonal > 0);
  netEl.classList.toggle('negative', stats.balancePersonal < 0);
  renderCardDelta('#sum-net-delta', stats.balancePersonal, prevStats.balancePersonal);
  $('#sum-net-ctx').textContent =
    stats.balancePersonal < 0
      ? 'Este mes gastaste más de lo que entró'
      : 'Lo que te queda este mes (ingresos − gastos)';

  const savingsPct =
    stats.ingresos > 0 ? Math.round((stats.ahorro / stats.ingresos) * 100) : 0;
  const prevSavingsPct =
    prevStats.ingresos > 0 ? Math.round((prevStats.ahorro / prevStats.ingresos) * 100) : 0;
  $('#sum-savings-rate').textContent = stats.ingresos > 0 ? `${savingsPct}%` : '—';
  renderCardDelta('#sum-savings-delta', savingsPct, prevSavingsPct, { isPercentPoints: true });
  $('#sum-savings-ctx').textContent =
    stats.ingresos > 0
      ? `${formatMoney(stats.ahorro)} registrados · Meta ≥20%`
      : 'Meta: ≥20% de ingresos';

  if (stats.settlementAmount > 0) {
    $('#sum-couple').textContent = formatMoney(stats.settlementAmount);
    $('#sum-couple-ctx').textContent = 'Pendiente de liquidar';
  } else {
    $('#sum-couple').textContent = 'Al día';
    $('#sum-couple-ctx').textContent = 'Cuentas claras';
  }

  $('#health-pct').textContent = `${stats.healthScore}%`;
  $('#health-label').textContent = `Salud financiera · ${stats.healthLabel}`;
  const fill = $('#health-fill');
  fill.style.width = `${stats.healthScore}%`;
  fill.classList.toggle('warn', stats.healthScore > 0 && stats.healthScore < 40);
  $('#health-bar').setAttribute('aria-valuenow', String(stats.healthScore));
  $('#health-context').textContent =
    stats.ingresos > 0
      ? `Ahorro/inversión registrado: ${formatMoney(stats.ahorro)} (${Math.round((stats.ahorro / stats.ingresos) * 100) || 0}% de ingresos). Meta: ≥20%.`
      : 'Basado en la regla 50/30/20: aspirar a ahorrar al menos el 20% de tus ingresos.';

  renderTrendSummary('#trend-table-body', '#trend-wrap', '#trend-empty', { compact: true });
  renderGoalsDashboard();

  try {
    renderBudget503020(stats);
    const budgetUsage = computeBudgetUsage(state.transactions, state.budgets || [], userId);
    renderCategoryBreakdown(userId, budgetUsage);
    renderTopExpenses(userId);

    const tip = getFinancialTip(stats, budgetUsage);
    $('#tip-text').textContent = tip.text;
    const tipIcon = $('.tip-icon', $('#tip-card'));
    if (tipIcon) tipIcon.textContent = tip.icon;
  } catch (err) {
    console.error('[FinanzasPR] Error renderizando dashboard:', err);
  }

  const list = $('#dashboard-tx-list');
  const recent = state.transactions.slice(0, 5);
  list.innerHTML = recent.map((tx) => txRowHtml(tx)).join('');
  $('#dashboard-empty').classList.toggle('hidden', recent.length > 0);
  replayAnimations($('#view-dashboard'));
}

function renderBudget503020(stats) {
  const rowsEl = $('#budget-503020-rows');
  const emptyEl = $('#budget-503020-empty');
  const rows = computeBucketRows(stats);
  const remaining = computeBucketRemaining(stats);
  const remainingMap = new Map(remaining.map((r) => [r.key, r]));

  if (rows.length === 0) {
    rowsEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  rowsEl.innerHTML = rows
    .map((row) => {
      const fillPct = Math.min(row.pct * 100, 100);
      const targetPct = row.target * 100;
      const rem = remainingMap.get(row.key);
      const remLabel = rem ? bucketRemainingLabel(rem, formatMoney) : '';
      return `
        <div class="bucket-row">
          <div class="bucket-header">
            <span class="bucket-label">${escapeHtml(row.label)}</span>
            <div class="bucket-meta">
              <span class="bucket-pct">${row.pctLabel}</span>
              <span class="status-chip ${row.status}">${row.statusLabel}</span>
            </div>
          </div>
          <div class="bucket-bar-wrap">
            <div class="progress-track bucket-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(fillPct)}" aria-label="${escapeHtml(row.label)}: ${row.pctLabel}">
              <div class="progress-fill bucket-fill ${row.status}" style="width:${fillPct}%"></div>
              <div class="bucket-target" style="left:${targetPct}%" aria-hidden="true"></div>
            </div>
            <div class="bucket-foot">
              <span>${formatMoney(row.amount)}</span>
              <span class="bucket-target-label">Meta ${row.targetLabel}</span>
            </div>
            ${remLabel ? `<p class="bucket-remaining">${escapeHtml(remLabel)}</p>` : ''}
          </div>
        </div>
      `;
    })
    .join('');
}

function maybeShowBudgetOverrunToast(budgetUsage) {
  for (const item of budgetUsage) {
    if (item.status !== 'danger') continue;
    const key = `${state.selectedMonth.getFullYear()}-${state.selectedMonth.getMonth()}-${item.categoryId}`;
    if (budgetToastShown.has(key)) continue;
    budgetToastShown.add(key);
    showToast(
      `${item.name} superó tu presupuesto este mes. Un ajuste pequeño el resto del mes puede equilibrar.`,
      'info'
    );
    break;
  }
}

function renderCategoryBreakdown(userId, budgetUsage = []) {
  const listEl = $('#category-breakdown');
  const emptyEl = $('#category-breakdown-empty');
  const items = computeCategoryBreakdown(state.transactions, userId, 8);
  const usageMap = new Map(budgetUsage.map((u) => [u.categoryId, u]));

  if (items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.innerHTML = items
    .map((item) => {
      const usage = usageMap.get(item.categoryId);
      if (usage) {
        const barPct = Math.min(Math.round(usage.pct * 100), 100);
        const chip =
          usage.statusLabel
            ? `<span class="status-chip ${usage.status}">${escapeHtml(usage.statusLabel)}</span>`
            : '';
        return `
          <li class="category-row">
            <div class="category-row-head">
              <span class="category-name">${escapeHtml(item.icon)} ${escapeHtml(item.name)}</span>
              <span class="category-amount">${formatMoney(item.amount)} / ${formatMoney(usage.budget)}</span>
            </div>
            <div class="progress-track category-track budget-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${barPct}" aria-label="${escapeHtml(item.name)}: ${barPct}% del presupuesto">
              <div class="progress-fill budget-usage-fill ${usage.status}" style="width:${barPct}%"></div>
            </div>
            <div class="category-foot">
              <span class="category-pct">${barPct}% del presupuesto</span>
              ${chip}
            </div>
          </li>
        `;
      }

      const barPct = Math.round(item.pctOfExpenses * 100);
      return `
        <li class="category-row">
          <div class="category-row-head">
            <span class="category-name">${escapeHtml(item.icon)} ${escapeHtml(item.name)}</span>
            <span class="category-amount">${formatMoney(item.amount)}</span>
          </div>
          <div class="progress-track category-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${barPct}" aria-label="${escapeHtml(item.name)}: ${barPct}% del gasto">
            <div class="progress-fill category-fill" style="width:${barPct}%"></div>
          </div>
          <span class="category-pct">${barPct}% del gasto</span>
        </li>
      `;
    })
    .join('');

  maybeShowBudgetOverrunToast(budgetUsage);
}

function renderTopExpenses(userId) {
  const tbody = $('#top-expenses-body');
  const wrap = $('#top-expenses-wrap');
  const emptyEl = $('#top-expenses-empty');
  const items = computeTopExpenses(state.transactions, userId, 10);

  if (items.length === 0) {
    tbody.innerHTML = '';
    wrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  wrap.classList.remove('hidden');
  tbody.innerHTML = items
    .map((item) => {
      const sharedNote = item.isShared ? ' <span class="badge">Compartido</span>' : '';
      return `
        <tr>
          <td data-label="Fecha">${escapeHtml(item.date)}</td>
          <td data-label="Descripción">${escapeHtml(item.description)}${sharedNote}</td>
          <td data-label="Categoría">${escapeHtml(item.icon)} ${escapeHtml(item.categoryName)}</td>
          <td class="num" data-label="Monto">${formatMoney(item.amount)}</td>
          <td class="num" data-label="%">${Math.round(item.pctOfExpenses * 100)}%</td>
        </tr>
      `;
    })
    .join('');
}

function renderTransactions() {
  const list = $('#tx-list');
  list.innerHTML = state.transactions.map((tx) => txRowHtml(tx, { showActions: true })).join('');
  $('#tx-empty').classList.toggle('hidden', state.transactions.length > 0);

  list.onclick = async (e) => {
    const editBtn = e.target.closest('[data-edit-tx]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-edit-tx');
      const tx = state.transactions.find((t) => t.id === id);
      if (tx) openTxModal(tx);
      return;
    }

    const btn = e.target.closest('[data-delete-tx]');
    if (!btn) return;
    const id = btn.getAttribute('data-delete-tx');
    if (!confirm('¿Eliminar este movimiento?')) return;
    try {
      await deleteTransaction(id);
      showToast('Movimiento eliminado', 'success');
      await refreshData();
      refreshCurrentView();
    } catch (err) {
      showToast(err.message || 'No se pudo eliminar', 'error');
    }
  };
}

function renderSettlement() {
  const userId = state.session.user.id;
  const stats = computeBalances(state.transactions, userId, state.members);
  const covered =
    stats.fromUser &&
    stats.toUser &&
    isSettlementCovered(
      state.settlements,
      stats.settlementAmount,
      stats.fromUser.id,
      stats.toUser.id
    );

  const msg = $('#settlement-message');
  if (covered && stats.settlementAmount >= 0.01) {
    msg.textContent = 'Liquidación registrada este mes. ¡Cuentas claras, pareja en calma!';
    msg.classList.add('settlement-ok');
  } else {
    msg.textContent = stats.settlementMessage;
    msg.classList.toggle('settlement-ok', stats.settlementAmount === 0);
  }

  const actionsEl = $('#settlement-actions');
  const canMarkPaid =
    stats.partner &&
    stats.settlementAmount >= 0.01 &&
    stats.fromUser &&
    stats.toUser &&
    !covered;
  actionsEl?.classList.toggle('hidden', !canMarkPaid);

  const partnersEl = $('#settlement-partners');
  partnersEl.innerHTML = state.members
    .map((m) => {
      const credit = stats.credits[m.id] || 0;
      const label =
        credit > 0.009
          ? `Le deben ${formatMoney(credit)}`
          : credit < -0.009
            ? `Debe ${formatMoney(Math.abs(credit))}`
            : 'Al día';
      return `<div class="partner-row"><span>${escapeHtml(displayName(m))}${m.id === userId ? ' (tú)' : ''}</span><span class="muted">${label}</span></div>`;
    })
    .join('') || '<p class="card-context">Sin miembros.</p>';

  const contribsEl = $('#settlement-contributions');
  if (contribsEl && state.members.length >= 2) {
    const contribs = computeSharedContributions(state.transactions, state.members);
    contribsEl.innerHTML = contribs
      .filter((c) => c.paid > 0)
      .map(
        (c) =>
          `<p class="contribution-row">${escapeHtml(c.name)} — adelantó ${formatMoney(c.paid)} (${Math.round(c.pct * 100)}% del hogar)</p>`
      )
      .join('');
  } else if (contribsEl) {
    contribsEl.innerHTML = '';
  }

  renderSettlementHistory();

  const shared = state.transactions.filter((t) => t.is_shared && t.categories?.type === 'gasto');
  $('#shared-tx-list').innerHTML = shared.map((tx) => txRowHtml(tx)).join('');
  $('#shared-empty').classList.toggle('hidden', shared.length > 0);
}

function renderSettlementHistory() {
  const list = $('#settlement-history-list');
  const empty = $('#settlement-history-empty');
  if (!list) return;

  const history = state.settlementsHistory || [];
  if (history.length === 0) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  const nameById = Object.fromEntries(state.members.map((m) => [m.id, displayName(m)]));
  list.innerHTML = history
    .map((s) => {
      const from = nameById[s.from_user_id] || 'Usuario';
      const to = nameById[s.to_user_id] || 'Usuario';
      const month = s.month ? capitalize(monthLabel(new Date(s.month + 'T12:00:00'))) : '';
      const date = s.paid_at ? new Date(s.paid_at).toLocaleDateString('es-PR') : '';
      return `<li class="settlement-history-item"><span>${escapeHtml(month)} · ${escapeHtml(from)} → ${escapeHtml(to)}</span><span class="muted">${formatMoney(s.amount)} · ${date}</span></li>`;
    })
    .join('');
}

function trendRowHtml(row, { showBar = false, maxExpenses = 1, selectedMonthKey = null } = {}) {
  const { stats, label, monthKey, hasData } = row;
  const net = stats.balancePersonal;
  const netClass = net > 0 ? 'positive' : net < 0 ? 'negative' : '';
  const selected = selectedMonthKey && monthKey === selectedMonthKey ? ' trend-row-selected' : '';
  const barPct = showBar && hasData ? Math.round((stats.gastosTotales / maxExpenses) * 100) : 0;
  return `
    <tr class="${hasData ? '' : 'trend-row-empty'}${selected}">
      <td data-label="Mes">${escapeHtml(label)}</td>
      <td class="num" data-label="Ingresos">${hasData ? formatMoney(stats.ingresos) : '—'}</td>
      <td class="num" data-label="Gastos">${hasData ? formatMoney(stats.gastosTotales) : '—'}</td>
      ${showBar ? `<td class="num" data-label="Gastos (barra)"><div class="trend-mini-bar" style="width:${barPct}%"></div></td>` : ''}
      <td class="num" data-label="Ahorro">${hasData ? formatMoney(stats.ahorro) : '—'}</td>
      <td class="num ${netClass}" data-label="Neto">${hasData ? formatMoney(net) : '—'}</td>
    </tr>
  `;
}

function renderTrendSummary(tbodySel, wrapSel, emptySel, { compact = false, showBar = false } = {}) {
  const tbody = $(tbodySel);
  const wrap = $(wrapSel);
  const empty = $(emptySel);
  if (!tbody) return;

  const rows = state.trendRows || [];
  const monthsWithData = countMonthsWithData(rows);
  const selectedKey = startOfMonth(state.selectedMonth);

  if (monthsWithData < 2) {
    tbody.innerHTML = '';
    wrap?.classList.add('hidden');
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  wrap?.classList.remove('hidden');
  const maxExp = maxTrendExpenses(rows);
  const displayRows = compact ? rows.slice(-3) : rows;
  tbody.innerHTML = displayRows
    .map((row) => trendRowHtml(row, { showBar, maxExpenses: maxExp, selectedMonthKey: selectedKey }))
    .join('');
}

function renderInformes() {
  renderTrendSummary('#informes-trend-body', '#informes-trend-wrap', '#informes-trend-empty', {
    compact: false,
    showBar: true,
  });
}

function goalRowHtml(goal, { showActions = false } = {}) {
  const { progress } = goal;
  const barPct = Math.round(progress.pct * 100);
  const actions = showActions
    ? `<div class="goal-actions">
        ${progress.isComplete ? `<button type="button" class="btn btn-sm goal-complete-btn" data-goal-id="${goal.id}">Archivar</button>` : ''}
        <button type="button" class="btn btn-sm btn-danger-ghost goal-delete-btn" data-goal-id="${goal.id}">Eliminar</button>
      </div>`
    : '';
  return `
    <li class="goal-row">
      <div class="goal-row-head">
        <span class="goal-name">${escapeHtml(goal.icon || '🎯')} ${escapeHtml(goal.name)}</span>
        <span class="goal-amount">${formatMoney(progress.current)} / ${formatMoney(progress.target)}</span>
      </div>
      <div class="progress-track goal-track" role="progressbar" aria-valuenow="${barPct}" aria-valuemin="0" aria-valuemax="100">
        <div class="progress-fill goal-fill" style="width:${barPct}%"></div>
      </div>
      <div class="goal-foot">
        <span class="goal-pct">${progress.pctLabel}</span>
        ${actions}
      </div>
    </li>
  `;
}

function renderGoalsDashboard() {
  const list = $('#goals-dashboard-list');
  const empty = $('#goals-dashboard-empty');
  if (!list) return;

  const userId = state.session?.user?.id;
  if (!userId) return;

  const enriched = enrichGoalsWithProgress(state.goals || [], state.goalTransactions || [], userId).slice(
    0,
    3
  );

  if (enriched.length === 0) {
    list.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }

  empty?.classList.add('hidden');
  list.innerHTML = enriched.map((g) => goalRowHtml(g)).join('');
}

function renderMetas() {
  const userId = state.session.user.id;
  fetchAllGoals(userId)
    .then((allGoals) => {
      const active = allGoals.filter((g) => !g.is_completed);
      const enriched = enrichGoalsWithProgress(active, state.goalTransactions, userId);
      const list = $('#metas-list');
      const empty = $('#metas-empty');

      if (enriched.length === 0) {
        list.innerHTML = '';
        empty?.classList.remove('hidden');
        return;
      }

      empty?.classList.add('hidden');
      list.innerHTML = enriched.map((g) => goalRowHtml(g, { showActions: true })).join('');
    })
    .catch((err) => showToast(err.message || 'No se pudieron cargar las metas', 'error'));
}

async function markSettlementPaid() {
  const userId = state.session.user.id;
  const stats = computeBalances(state.transactions, userId, state.members);
  if (!stats.fromUser || !stats.toUser || stats.settlementAmount < 0.01) return;

  if (
    isSettlementCovered(
      state.settlements,
      stats.settlementAmount,
      stats.fromUser.id,
      stats.toUser.id
    )
  ) {
    showToast('Este mes ya tiene una liquidación registrada', 'info');
    return;
  }

  await recordSettlement({
    groupId: state.profile.group_id,
    month: state.selectedMonth,
    fromUserId: stats.fromUser.id,
    toUserId: stats.toUser.id,
    amount: stats.settlementAmount,
    userId,
  });
  showToast('Liquidación registrada', 'success');
  await refreshData();
  renderSettlement();
  renderDashboard();
}

function renderPresupuestos() {
  const userId = state.session.user.id;
  const monthText = capitalize(monthLabel(state.selectedMonth));
  const titleEl = $('#presupuestos-title');
  if (titleEl) titleEl.textContent = `Presupuestos — ${monthText}`;

  const rows = computeBudgetEditorRows(
    state.categories,
    state.budgets,
    state.transactions,
    userId
  );
  const tbody = $('#budgets-table-body');
  const wrap = $('#budgets-table-wrap');
  const emptyEl = $('#budgets-empty');

  if (rows.length === 0) {
    tbody.innerHTML = '';
    wrap?.classList.add('hidden');
    emptyEl?.classList.remove('hidden');
    return;
  }

  emptyEl?.classList.add('hidden');
  wrap?.classList.remove('hidden');
  tbody.innerHTML = rows
    .map((row) => {
      const chip =
        row.statusLabel
          ? `<span class="status-chip ${row.status}">${escapeHtml(row.statusLabel)}</span>`
          : '<span class="muted">—</span>';
      const inputVal = row.budget !== null ? row.budget : '';
      return `
        <tr data-category-id="${row.categoryId}">
          <td class="budget-cat" data-label="Categoría">${escapeHtml(row.icon)} ${escapeHtml(row.name)}</td>
          <td class="num" data-label="Presupuesto">
            <input type="number" class="budget-input" min="0.01" step="0.01" placeholder="—" value="${inputVal}" aria-label="Presupuesto ${escapeHtml(row.name)}" />
          </td>
          <td class="num" data-label="Gastado">${formatMoney(row.spent)}</td>
          <td data-label="Estado">${chip}</td>
          <td class="num" data-label="Acción">
            <button type="button" class="btn btn-sm budget-save-row" data-category-id="${row.categoryId}">Guardar</button>
          </td>
        </tr>
      `;
    })
    .join('');
}

async function saveBudgetForCategory(categoryId) {
  const row = $(`tr[data-category-id="${categoryId}"]`);
  if (!row) return;
  const input = $('.budget-input', row);
  const amount = Number(input?.value);
  if (!(amount > 0)) {
    showToast('El presupuesto debe ser mayor que cero', 'error');
    return;
  }
  await upsertBudget({
    groupId: state.profile.group_id,
    categoryId,
    month: state.selectedMonth,
    amount,
    userId: state.session.user.id,
  });
}

function setupPresupuestosUi() {
  $('#budgets-table-wrap')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.budget-save-row');
    if (!btn) return;
    const categoryId = btn.getAttribute('data-category-id');
    try {
      await saveBudgetForCategory(categoryId);
      showToast('Presupuesto guardado', 'success');
      await refreshData();
      renderPresupuestos();
      if (location.hash.replace('#', '') === 'dashboard') renderDashboard();
    } catch (err) {
      showToast(err.message || 'No se pudo guardar', 'error');
    }
  });

  $('#budgets-save-all')?.addEventListener('click', async () => {
    const inputs = $$('.budget-input', $('#budgets-table-wrap'));
    const toSave = inputs.filter((input) => {
      const val = Number(input.value);
      return val > 0;
    });
    if (toSave.length === 0) {
      showToast('Ingresa al menos un monto para guardar', 'error');
      return;
    }
    try {
      for (const input of toSave) {
        const row = input.closest('tr');
        const categoryId = row?.getAttribute('data-category-id');
        if (!categoryId) continue;
        await saveBudgetForCategory(categoryId);
      }
      showToast('Presupuestos guardados', 'success');
      await refreshData();
      renderPresupuestos();
      if (location.hash.replace('#', '') === 'dashboard') renderDashboard();
    } catch (err) {
      showToast(err.message || 'No se pudo guardar', 'error');
    }
  });

  $('#budgets-copy-prev')?.addEventListener('click', async () => {
    try {
      const count = await copyBudgetsFromPreviousMonth(
        state.profile.group_id,
        state.selectedMonth,
        state.session.user.id
      );
      if (count === 0) {
        showToast('No hay presupuestos en el mes anterior para copiar', 'info');
        return;
      }
      showToast(`Se copiaron ${count} presupuesto${count === 1 ? '' : 's'}`, 'success');
      await refreshData();
      renderPresupuestos();
    } catch (err) {
      showToast(err.message || 'No se pudo copiar', 'error');
    }
  });
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function renderPerfil() {
  if (!state.session?.user) return;

  const userId = state.session.user.id;
  const name = displayName(state.profile) || state.session.user.email || 'Usuario';
  const email = state.profile?.email || state.session.user.email || '';

  $('#profile-avatar-lg').textContent = (name || '?').charAt(0).toUpperCase();
  $('#profile-name-display').textContent = name;
  $('#profile-email-display').textContent = email;
  $('#profile-name-input').value = state.profile?.full_name || '';
  $('#profile-user-id').textContent = userId;

  const inviteSection = $('#profile-invite-section');
  const noGroupSection = $('#profile-no-group-section');

  if (state.group?.invite_code) {
    inviteSection?.classList.remove('hidden');
    noGroupSection?.classList.add('hidden');
    $('#profile-invite-code').textContent = state.group.invite_code;
    $('#profile-group-name').textContent = state.group.name || 'Mi espacio';

    const memberCount = state.members.length;
    const hint = $('#profile-invite-hint');
    if (hint) {
      hint.textContent =
        memberCount >= 2
          ? 'Tu espacio ya tiene 2 miembros. El código sigue visible por si lo necesitas de nuevo.'
          : 'Comparte este UUID con tu pareja para enlazar cuentas en el mismo espacio.';
    }

    const membersEl = $('#profile-members');
    if (membersEl) {
      if (state.members.length === 0) {
        membersEl.innerHTML = '<p class="card-context" style="margin:0;">Sin miembros cargados.</p>';
      } else {
        membersEl.innerHTML = state.members
          .map((m) => {
            const isYou = m.id === userId;
            const label = isYou ? 'Tú' : 'Pareja';
            const initial = (displayName(m) || '?').charAt(0).toUpperCase();
            return `
              <div class="profile-member-row">
                <span class="profile-member-name">
                  <span class="avatar" aria-hidden="true">${initial}</span>
                  ${escapeHtml(displayName(m))}
                </span>
                <span class="muted">${label}</span>
              </div>
            `;
          })
          .join('');
      }
    }
  } else {
    inviteSection?.classList.add('hidden');
    noGroupSection?.classList.remove('hidden');
  }
}

function setupPerfilUi() {
  $('#profile-name-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.session?.user) return;

    const errEl = $('#profile-name-error');
    errEl?.classList.add('hidden');

    const fullName = $('#profile-name-input').value.trim();
    try {
      state.profile = await updateProfile(state.session.user.id, { full_name: fullName });
      updateUserChip();
      renderPerfil();
      showToast('Nombre actualizado', 'success');
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'No se pudo guardar el nombre';
        errEl.classList.remove('hidden');
      }
    }
  });

  $('#copy-profile-invite-btn')?.addEventListener('click', () => {
    copyText($('#profile-invite-code')?.textContent, 'Código de invitación copiado');
  });

  $('#copy-profile-user-id-btn')?.addEventListener('click', () => {
    copyText(state.session?.user?.id, 'ID de usuario copiado');
  });

  $('#profile-logout-btn')?.addEventListener('click', async () => {
    await signOut();
    showToast('Sesión cerrada');
  });
}

/* ---------- Auth UI ---------- */
function setupAuthUi() {
  $$('[data-auth-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.authMode = tab.dataset.authTab;
      $$('[data-auth-tab]').forEach((t) => t.classList.toggle('active', t === tab));
      const isReg = state.authMode === 'register';
      $('#fullname-name-group').classList.toggle('hidden', !isReg);
      $('#auth-submit').textContent = isReg ? 'Crear cuenta' : 'Entrar';
      $('#auth-password').autocomplete = isReg ? 'new-password' : 'current-password';
      $('#auth-message').classList.add('hidden');
    });
  });

  $('#auth-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const fullName = $('#auth-name').value.trim();
    const msg = $('#auth-message');
    msg.classList.add('hidden');
    try {
      if (state.authMode === 'register') {
        const data = await signUpWithEmail(email, password, fullName);
        if (data.session) {
          showToast('Cuenta creada. ¡Bienvenido!', 'success');
        } else {
          msg.className = 'form-success';
          msg.textContent =
            'Revisa tu correo para confirmar la cuenta (si Supabase tiene confirmación activada). Luego inicia sesión.';
          msg.classList.remove('hidden');
          return;
        }
      } else {
        await signInWithEmail(email, password);
        showToast('Sesión iniciada', 'success');
      }
    } catch (err) {
      msg.className = 'form-error';
      msg.textContent = err.message || 'Error de autenticación';
      msg.classList.remove('hidden');
    }
  });

  $('#google-btn').addEventListener('click', async () => {
    try {
      await signInWithGoogle();
    } catch (err) {
      showToast(err.message || 'No se pudo abrir Google', 'error');
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await signOut();
    showToast('Sesión cerrada');
  });
}

/* ---------- Onboarding ---------- */
function setupOnboarding() {
  $('#create-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#group-name').value.trim();
    $('#onboarding-error').classList.add('hidden');
    try {
      const group = await createSharedSpace(name);
      $('#invite-result').classList.remove('hidden');
      $('#invite-code-display').textContent = group.invite_code;
      await refreshData();
      showToast('Espacio creado', 'success');
    } catch (err) {
      const el = $('#onboarding-error');
      el.textContent = err.message || 'No se pudo crear el espacio';
      el.classList.remove('hidden');
    }
  });

  $('#copy-invite-btn').addEventListener('click', async () => {
    const code = $('#invite-code-display').textContent;
    await copyText(code, 'Código copiado');
  });

  $('#goto-dashboard-btn').addEventListener('click', () => {
    location.hash = '#dashboard';
  });

  $('#join-group-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = $('#join-code').value.trim();
    $('#onboarding-error').classList.add('hidden');
    try {
      await joinSharedSpace(code);
      await refreshData();
      showToast('¡Te uniste al espacio!', 'success');
      location.hash = '#dashboard';
    } catch (err) {
      const el = $('#onboarding-error');
      el.textContent = err.message || 'No se pudo unir';
      el.classList.remove('hidden');
    }
  });
}

/* ---------- Transaction modal ---------- */
function openTxModal(tx = null) {
  const editing = tx && typeof tx === 'object' && tx.id;
  $('#tx-form').reset();
  $('#tx-form-error').classList.add('hidden');
  fillPayerSelect();

  if (editing) {
    $('#tx-modal-title').textContent = 'Editar movimiento';
    $('#tx-id').value = tx.id;
    const kind = tx.categories?.type === 'ingreso' ? 'ingreso' : 'gasto';
    const kindRadio = $(`input[name="tx-kind"][value="${kind}"]`);
    if (kindRadio) kindRadio.checked = true;
    syncTxKindUi();
    $('#tx-amount').value = tx.amount;
    $('#tx-date').value = tx.date;
    $('#tx-description').value = tx.description || '';
    $('#tx-category').value = tx.category_id;
    if (kind === 'gasto') {
      const sharedValue = tx.is_shared ? 'shared' : 'personal';
      const sharedRadio = $(`input[name="tx-shared"][value="${sharedValue}"]`);
      if (sharedRadio) sharedRadio.checked = true;
      syncTxKindUi();
      if (tx.is_shared && tx.paid_by_user_id) {
        $('#tx-payer').value = tx.paid_by_user_id;
      }
    }
  } else {
    $('#tx-modal-title').textContent = 'Nuevo movimiento';
    $('#tx-id').value = '';
    $('#tx-date').value = new Date().toISOString().slice(0, 10);
    fillCategorySelect('gasto');
    syncTxKindUi();
  }

  $('#tx-modal').classList.remove('hidden');
}

function closeTxModal() {
  $('#tx-modal').classList.add('hidden');
}

function fillCategorySelect(kind) {
  const sel = $('#tx-category');
  const cats = state.categories.filter((c) => c.type === kind);
  sel.innerHTML = cats
    .map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c.name)}</option>`)
    .join('');
}

function fillPayerSelect() {
  const sel = $('#tx-payer');
  const uid = state.session.user.id;
  sel.innerHTML = state.members
    .map(
      (m) =>
        `<option value="${m.id}" ${m.id === uid ? 'selected' : ''}>${escapeHtml(displayName(m))}</option>`
    )
    .join('');
}

function syncTxKindUi() {
  const kind = $('input[name="tx-kind"]:checked')?.value || 'gasto';
  fillCategorySelect(kind);
  const isIncome = kind === 'ingreso';
  $('#tx-shared-group').classList.toggle('hidden', isIncome);
  if (isIncome) {
    $('input[name="tx-shared"][value="personal"]').checked = true;
  }
  const shared = $('input[name="tx-shared"]:checked')?.value === 'shared';
  $('#tx-payer-group').classList.toggle('hidden', isIncome || !shared);

  const hint = $('#tx-split-hint');
  if (!hint) return;
  if (!shared || isIncome) {
    hint.classList.add('hidden');
    return;
  }
  const userId = state.session?.user?.id;
  const ratio = resolveSplitRatio(state.group, state.transactions, userId, state.members);
  const pct = Math.round(ratio * 100);
  if (state.group?.split_mode === 'income_proportional') {
    const myInc = sumMemberIncome(state.transactions, userId);
    const partner = state.members.find((m) => m.id !== userId);
    const partnerInc = partner ? sumMemberIncome(state.transactions, partner.id) : 0;
    if (myInc + partnerInc <= 0) {
      hint.textContent = 'Sin ingresos registrados este mes — usamos 50/50 por defecto.';
    } else {
      hint.textContent = `Tu parte: ${pct}% (según ingresos del mes).`;
    }
  } else {
    hint.textContent = `Tu parte de este gasto compartido: ${pct}% (split del hogar).`;
  }
  hint.classList.remove('hidden');
}

function setupTxModal() {
  const openModal = () => openTxModal();
  $('#open-tx-modal-btn').addEventListener('click', openModal);
  $('#fab-tx-btn')?.addEventListener('click', openModal);
  $('#sidebar-new-tx-btn')?.addEventListener('click', openModal);
  $('#dashboard-new-tx-btn')?.addEventListener('click', openModal);
  $('#close-tx-modal').addEventListener('click', closeTxModal);
  $('#tx-modal').addEventListener('click', (e) => {
    if (e.target === $('#tx-modal')) closeTxModal();
  });

  $$('input[name="tx-kind"]').forEach((r) => r.addEventListener('change', syncTxKindUi));
  $$('input[name="tx-shared"]').forEach((r) => r.addEventListener('change', syncTxKindUi));

  $('#tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#tx-form-error');
    errEl.classList.add('hidden');

    const id = $('#tx-id').value.trim();
    const kind = $('input[name="tx-kind"]:checked').value;
    const amount = Number($('#tx-amount').value);
    const description = $('#tx-description').value.trim();
    const category_id = $('#tx-category').value;
    const date = $('#tx-date').value;
    const is_shared = kind === 'gasto' && $('input[name="tx-shared"]:checked').value === 'shared';
    const paid_by_user_id = is_shared ? $('#tx-payer').value : state.session.user.id;

    if (!(amount > 0)) {
      errEl.textContent = 'El monto debe ser mayor que cero.';
      errEl.classList.remove('hidden');
      return;
    }

    const payload = {
      amount,
      description,
      category_id,
      is_shared,
      paid_by_user_id,
      date,
    };

    const userId = state.session.user.id;
    const split_ratio = is_shared
      ? resolveSplitRatio(state.group, state.transactions, userId, state.members)
      : 0.5;

    try {
      if (id) {
        const existing = state.transactions.find((t) => t.id === id);
        await updateTransaction(id, {
          ...payload,
          split_ratio: is_shared ? (existing?.split_ratio ?? split_ratio) : 0.5,
        });
        showToast('Movimiento actualizado', 'success');
      } else {
        await createTransaction({
          ...payload,
          user_id: userId,
          group_id: state.profile.group_id,
          split_ratio,
        });
        showToast('Movimiento guardado', 'success');
      }
      closeTxModal();
      await refreshData();
      refreshCurrentView();
    } catch (err) {
      errEl.textContent = err.message || 'No se pudo guardar';
      errEl.classList.remove('hidden');
    }
  });
}

function setupHouseholdModal() {
  const modal = $('#household-modal');
  const ratioGroup = $('#split-ratio-group');

  function syncHouseholdUi() {
    const mode = $('input[name="split-mode"]:checked')?.value || 'fixed';
    ratioGroup?.classList.toggle('hidden', mode === 'income_proportional');
  }

  $('#open-household-settings')?.addEventListener('click', () => {
    const group = state.group || {};
    const mode = group.split_mode || 'fixed';
    const ratio = String(group.default_split_ratio ?? 0.5);
    $$(`input[name="split-mode"]`).forEach((r) => {
      r.checked = r.value === mode;
    });
    const preset = ['0.5', '0.6', '0.7'].includes(ratio) ? ratio : '0.5';
    $$(`input[name="split-preset"]`).forEach((r) => {
      r.checked = r.value === preset;
    });
    syncHouseholdUi();
    modal?.classList.remove('hidden');
  });

  $('#close-household-modal')?.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
  $$('input[name="split-mode"]').forEach((r) => r.addEventListener('change', syncHouseholdUi));

  $('#household-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#household-form-error');
    errEl?.classList.add('hidden');
    const split_mode = $('input[name="split-mode"]:checked')?.value || 'fixed';
    const default_split_ratio = Number($('input[name="split-preset"]:checked')?.value || 0.5);
    try {
      state.group = await updateGroupSettings(state.profile.group_id, {
        split_mode,
        default_split_ratio,
      });
      showToast('Configuración guardada', 'success');
      modal?.classList.add('hidden');
      renderSettlement();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'No se pudo guardar';
        errEl.classList.remove('hidden');
      }
    }
  });
}

function fillGoalCategorySelect() {
  const sel = $('#goal-category');
  if (!sel) return;
  const savingsCats = state.categories.filter((c) => c.budget_bucket === 'ahorro');
  sel.innerHTML =
    '<option value="">Manual — actualiza tú el progreso</option>' +
    savingsCats
      .map((c) => `<option value="${c.id}">${c.icon} ${escapeHtml(c.name)}</option>`)
      .join('');
}

function setupGoalsUi() {
  $('#open-goal-modal-btn')?.addEventListener('click', () => {
    $('#goal-form')?.reset();
    $('#goal-icon').value = '🎯';
    $('#goal-form-error')?.classList.add('hidden');
    fillGoalCategorySelect();
    $('#goal-modal')?.classList.remove('hidden');
  });

  $('#close-goal-modal')?.addEventListener('click', () => $('#goal-modal')?.classList.add('hidden'));
  $('#goal-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#goal-modal')) $('#goal-modal').classList.add('hidden');
  });

  $('#goal-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#goal-form-error');
    errEl?.classList.add('hidden');
    const name = $('#goal-name').value.trim();
    const target_amount = Number($('#goal-target').value);
    const category_id = $('#goal-category').value || null;
    const current_amount = Number($('#goal-current').value) || 0;
    const deadline = $('#goal-deadline').value || null;
    const icon = $('#goal-icon').value.trim() || '🎯';

    if (!name || !(target_amount > 0)) {
      if (errEl) {
        errEl.textContent = 'Nombre y objetivo son requeridos.';
        errEl.classList.remove('hidden');
      }
      return;
    }

    try {
      await createGoal({
        group_id: state.profile.group_id,
        user_id: state.session.user.id,
        name,
        target_amount,
        category_id,
        current_amount: category_id ? 0 : current_amount,
        deadline,
        icon,
      });
      showToast('Meta creada', 'success');
      $('#goal-modal')?.classList.add('hidden');
      await refreshData();
      refreshCurrentView();
    } catch (err) {
      if (errEl) {
        errEl.textContent = err.message || 'No se pudo crear la meta';
        errEl.classList.remove('hidden');
      }
    }
  });

  $('#metas-list')?.addEventListener('click', async (e) => {
    const completeBtn = e.target.closest('.goal-complete-btn');
    const deleteBtn = e.target.closest('.goal-delete-btn');
    if (completeBtn) {
      const id = completeBtn.getAttribute('data-goal-id');
      try {
        await completeGoal(id);
        showToast('Meta archivada', 'success');
        await refreshData();
        renderMetas();
        renderDashboard();
      } catch (err) {
        showToast(err.message || 'No se pudo archivar', 'error');
      }
      return;
    }
    if (deleteBtn) {
      const id = deleteBtn.getAttribute('data-goal-id');
      if (!confirm('¿Eliminar esta meta?')) return;
      try {
        await deleteGoal(id);
        showToast('Meta eliminada', 'success');
        await refreshData();
        renderMetas();
        renderDashboard();
      } catch (err) {
        showToast(err.message || 'No se pudo eliminar', 'error');
      }
    }
  });
}

function setupSettlementUi() {
  $('#mark-settlement-paid')?.addEventListener('click', async () => {
    try {
      await markSettlementPaid();
    } catch (err) {
      showToast(err.message || 'No se pudo registrar', 'error');
    }
  });
}

function setupMonthNav() {
  const prev = $('#month-prev');
  const next = $('#month-next');
  const picker = $('#month-picker');
  if (!prev || !next || !picker) {
    console.warn('[FinanzasPR] Month nav no encontrado en el DOM — recarga forzada (Ctrl+Shift+R).');
    return;
  }

  prev.addEventListener('click', () => {
    changeSelectedMonth(shiftMonth(state.selectedMonth, -1));
  });

  next.addEventListener('click', () => {
    if (isSameMonth(state.selectedMonth, new Date())) return;
    changeSelectedMonth(shiftMonth(state.selectedMonth, 1));
  });

  picker.addEventListener('change', (e) => {
    if (state.monthPickerSync) return;
    changeSelectedMonth(parseMonthInput(e.target.value));
  });
}

/* ---------- Boot ---------- */
let bootstrapped = false;

async function bootstrapSession(session) {
  if (bootstrapped) return;
  bootstrapped = true;
  await handleSession(session);
}

async function handleSession(session) {
  state.session = session;
  if (!session) {
    state.profile = null;
    state.group = null;
    state.members = [];
    state.categories = [];
    state.transactions = [];
    state.prevMonthTransactions = [];
    state.budgets = [];
    state.goals = [];
    state.goalTransactions = [];
    state.trendRows = [];
    state.settlements = [];
    state.settlementsHistory = [];
    setLoading(false);
    location.hash = '#login';
    navigate('#login');
    return;
  }

  try {
    await refreshData();
    if (!state.profile?.group_id) {
      location.hash = '#onboarding';
      navigate('#onboarding');
    } else {
      const h = location.hash || '#dashboard';
      if (h === '#login' || !h || h === '#') location.hash = '#dashboard';
      navigate(location.hash);
    }
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Error al cargar datos. ¿Ejecutaste el SQL en Supabase?', 'error');
    navigate(location.hash || '#login');
  } finally {
    setLoading(false);
  }
}

async function boot() {
  window.__finanzasBootStarted = true;
  navigate(location.hash || '#login');
  setLoading(true);
  $('#boot-fallback')?.classList.add('hidden');

  window.addEventListener('error', (event) => {
    // No mostrar el banner rojo por errores ajenos (fuentes, extensiones, etc.).
    console.error('[FinanzasPR] Error no capturado:', event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('[FinanzasPR] Promise rechazada:', event.reason);
  });

  const loadTimeout = setTimeout(() => {
    setLoading(false);
    // La UI de login ya puede usarse; solo avisamos sin el banner de "app rota".
    showToast('La verificación de sesión tarda. Puedes intentar entrar o recargar.', 'error');
  }, 20000);

  try {
    initTheme();
    setupAuthUi();
    setupOnboarding();
    setupPerfilUi();
    setupTxModal();
    setupPresupuestosUi();
    setupHouseholdModal();
    setupGoalsUi();
    setupSettlementUi();
    setupMonthNav();

    window.addEventListener('hashchange', () => navigate(location.hash));

    // UI lista: oculta el fallback aunque Supabase tarde.
    $('#boot-fallback')?.classList.add('hidden');
    setLoading(false);

    onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        await bootstrapSession(session);
        return;
      }
      if (!bootstrapped) return;
      await handleSession(session);
    });

    let session = null;
    try {
      session = await Promise.race([
        getSession(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('No se pudo verificar la sesión')), 12000)
        ),
      ]);
    } catch (sessionErr) {
      // Login sigue usable; no tratar esto como "app no cargó".
      console.warn('[FinanzasPR] Sesión no verificada a tiempo:', sessionErr);
      showToast(
        sessionErr.message || 'No se pudo verificar la sesión. Revisa tu conexión con Supabase.',
        'error'
      );
      navigate('#login');
      state.sessionInitDone = true;
      return;
    }

    await bootstrapSession(session);
    state.sessionInitDone = true;
  } catch (err) {
    console.error(err);
    showToast(
      err.message || 'No se pudo conectar con Supabase. Configura .env y ejecuta: node scripts/generate-config.js',
      'error'
    );
    navigate('#login');
    // Solo banner rojo si falló el setup de UI (DOM/handlers), no por red/sesión.
    $('#boot-fallback')?.classList.remove('hidden');
  } finally {
    clearTimeout(loadTimeout);
    setLoading(false);
  }
}

boot();
