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
} from './auth.js';
import { createSharedSpace, joinSharedSpace, fetchMyGroup, fetchGroupMembers } from './groups.js';
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
import { computeBalances, displayName, formatMoney, monthLabel } from './balances.js';
import {
  computeBucketRows,
  computeCategoryBreakdown,
  computeTopExpenses,
  formatMonthDelta,
} from './analytics.js';
import { getFinancialTip } from './tips.js';

/** @type {{ session: any, profile: any, group: any, members: any[], categories: any[], transactions: any[] }} */
const state = {
  session: null,
  profile: null,
  group: null,
  members: [],
  categories: [],
  transactions: [],
  prevMonthTransactions: [],
  selectedMonth: normalizeMonth(new Date()),
  monthPickerSync: false,
  sessionInitDone: false,
  authMode: 'login', // login | register
};

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
  const view = (hash || '#login').replace('#', '') || 'login';
  const allowedGuest = ['login'];
  const needsAuth = !allowedGuest.includes(view);

  if (!state.session && needsAuth) {
    location.hash = '#login';
    return;
  }
  if (state.session && view === 'login') {
    location.hash = state.profile?.group_id ? '#dashboard' : '#onboarding';
    return;
  }
  if (state.session && !state.profile?.group_id && view !== 'onboarding' && view !== 'login') {
    location.hash = '#onboarding';
    return;
  }

  $$('.view').forEach((el) => el.classList.remove('active'));
  const target = $(`#view-${view}`) || (state.session ? $('#view-dashboard') : $('#view-login'));
  target?.classList.add('active');

  $$('#bottom-nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === view);
  });

  const showChrome = Boolean(state.session && state.profile?.group_id);
  $('#bottom-nav').classList.toggle('hidden', !showChrome);
  $('#global-month-nav').classList.toggle('hidden', !showChrome);
  $('#user-chip').classList.toggle('hidden', !state.session);
  $('#logout-btn').classList.toggle('hidden', !state.session);

  if (showChrome) updateMonthNavUi();

  if (view === 'dashboard' && showChrome) renderDashboard();
  if (view === 'transacciones' && showChrome) renderTransactions();
  if (view === 'liquidacion' && showChrome) renderSettlement();
}

function updateUserChip() {
  if (!state.session) return;
  const name = displayName(state.profile) || state.session.user.email;
  $('#user-name').textContent = name;
  const avatar = $('#user-avatar');
  const url = state.profile?.avatar_url;
  if (url && avatar.tagName === 'SPAN') {
    // keep letter avatar for simplicity
  }
  avatar.textContent = (name || '?').charAt(0).toUpperCase();
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

  const [transactions, prevMonthTransactions] = await Promise.all([
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
  ]);
  state.transactions = transactions;
  state.prevMonthTransactions = prevMonthTransactions;
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

function renderDashboard() {
  const userId = state.session.user.id;
  const stats = computeBalances(state.transactions, userId, state.members);
  const prevStats = computeBalances(state.prevMonthTransactions, userId, state.members);

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
  netEl.textContent = formatMoney(stats.balancePersonal);
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

  renderBudget503020(stats);
  renderCategoryBreakdown(userId);
  renderTopExpenses(userId);

  const tip = getFinancialTip(stats);
  $('#tip-text').textContent = tip.text;
  const tipIcon = $('.tip-icon', $('#tip-card'));
  if (tipIcon) tipIcon.textContent = tip.icon;

  const list = $('#dashboard-tx-list');
  const recent = state.transactions.slice(0, 5);
  list.innerHTML = recent.map((tx) => txRowHtml(tx)).join('');
  $('#dashboard-empty').classList.toggle('hidden', recent.length > 0);
}

function renderBudget503020(stats) {
  const rowsEl = $('#budget-503020-rows');
  const emptyEl = $('#budget-503020-empty');
  const rows = computeBucketRows(stats);

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
          </div>
        </div>
      `;
    })
    .join('');
}

function renderCategoryBreakdown(userId) {
  const listEl = $('#category-breakdown');
  const emptyEl = $('#category-breakdown-empty');
  const items = computeCategoryBreakdown(state.transactions, userId, 8);

  if (items.length === 0) {
    listEl.innerHTML = '';
    emptyEl.classList.remove('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  listEl.innerHTML = items
    .map((item) => {
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
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.description)}${sharedNote}</td>
          <td>${escapeHtml(item.icon)} ${escapeHtml(item.categoryName)}</td>
          <td class="num">${formatMoney(item.amount)}</td>
          <td class="num">${Math.round(item.pctOfExpenses * 100)}%</td>
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
      renderTransactions();
      renderDashboard();
    } catch (err) {
      showToast(err.message || 'No se pudo eliminar', 'error');
    }
  };
}

function renderSettlement() {
  const userId = state.session.user.id;
  const stats = computeBalances(state.transactions, userId, state.members);
  const msg = $('#settlement-message');
  msg.textContent = stats.settlementMessage;
  msg.classList.toggle('settlement-ok', stats.settlementAmount === 0);

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

  const shared = state.transactions.filter((t) => t.is_shared && t.categories?.type === 'gasto');
  $('#shared-tx-list').innerHTML = shared.map((tx) => txRowHtml(tx)).join('');
  $('#shared-empty').classList.toggle('hidden', shared.length > 0);
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
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
    try {
      await navigator.clipboard.writeText(code);
      showToast('Código copiado', 'success');
    } catch {
      showToast(code, 'info');
    }
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
  // Ingresos siempre personales; pagador = usuario
  if (isIncome) {
    $('input[name="tx-shared"][value="personal"]').checked = true;
  }
  const shared = $('input[name="tx-shared"]:checked')?.value === 'shared';
  $('#tx-payer-group').classList.toggle('hidden', isIncome || !shared);
}

function setupTxModal() {
  $('#open-tx-modal-btn').addEventListener('click', () => openTxModal());
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

    try {
      if (id) {
        await updateTransaction(id, payload);
        showToast('Movimiento actualizado', 'success');
      } else {
        await createTransaction({
          ...payload,
          user_id: state.session.user.id,
          group_id: state.profile.group_id,
          split_ratio: 0.5,
        });
        showToast('Movimiento guardado', 'success');
      }
      closeTxModal();
      await refreshData();
      const view = location.hash.replace('#', '') || 'dashboard';
      if (view === 'transacciones') renderTransactions();
      else if (view === 'liquidacion') renderSettlement();
      else renderDashboard();
    } catch (err) {
      errEl.textContent = err.message || 'No se pudo guardar';
      errEl.classList.remove('hidden');
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
  setLoading(true);
  $('#boot-fallback')?.classList.add('hidden');

  const loadTimeout = setTimeout(() => {
    setLoading(false);
    $('#boot-fallback')?.classList.remove('hidden');
    showToast('La carga tardó demasiado. Revisa tu conexión o recarga con Cmd+Shift+R.', 'error');
  }, 20000);

  try {
    initTheme();
    setupAuthUi();
    setupOnboarding();
    setupTxModal();
    setupMonthNav();

    window.addEventListener('hashchange', () => navigate(location.hash));

    onAuthStateChange(async (event, session) => {
      if (event === 'INITIAL_SESSION') {
        await bootstrapSession(session);
        return;
      }
      if (!bootstrapped) return;
      await handleSession(session);
    });

    const session = await Promise.race([
      getSession(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('No se pudo verificar la sesión')), 12000)
      ),
    ]);
    await bootstrapSession(session);
    state.sessionInitDone = true;
  } catch (err) {
    console.error(err);
    showToast(
      err.message || 'No se pudo conectar con Supabase. Configura .env y ejecuta: node scripts/generate-config.js',
      'error'
    );
    navigate('#login');
  } finally {
    clearTimeout(loadTimeout);
    setLoading(false);
  }
}

boot();
