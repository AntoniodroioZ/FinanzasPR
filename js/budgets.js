/**
 * Presupuestos por categoría (v1.2): CRUD Supabase y analytics de consumo.
 */
import { supabase } from './supabaseClient.js';
import { userGastoAmount } from './analytics.js';
import { startOfMonth, shiftMonth } from './transactions.js';

/** @param {Date|string} month */
export async function fetchBudgets(groupId, month) {
  const monthStr = startOfMonth(month);
  const { data, error } = await supabase
    .from('category_budgets')
    .select('*, categories(id, name, icon, type)')
    .eq('group_id', groupId)
    .eq('month', monthStr);
  if (error) throw error;
  return data || [];
}

/**
 * @param {{ groupId: string, categoryId: string, month: Date|string, amount: number, userId: string }}
 */
export async function upsertBudget({ groupId, categoryId, month, amount, userId }) {
  const monthStr = startOfMonth(month);
  const { data, error } = await supabase
    .from('category_budgets')
    .upsert(
      {
        group_id: groupId,
        category_id: categoryId,
        month: monthStr,
        amount,
        created_by: userId,
      },
      { onConflict: 'group_id,category_id,month' }
    )
    .select('*, categories(id, name, icon, type)')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Copia presupuestos del mes anterior al mes dado (sin sobrescribir existentes).
 * @returns {number} filas copiadas
 */
export async function copyBudgetsFromPreviousMonth(groupId, month, userId) {
  const prevMonth = shiftMonth(month, -1);
  const prev = await fetchBudgets(groupId, prevMonth);
  if (prev.length === 0) return 0;

  const current = await fetchBudgets(groupId, month);
  const existing = new Set(current.map((b) => b.category_id));
  const monthStr = startOfMonth(month);

  const toInsert = prev
    .filter((b) => !existing.has(b.category_id) && b.categories?.type === 'gasto')
    .map((b) => ({
      group_id: groupId,
      category_id: b.category_id,
      month: monthStr,
      amount: b.amount,
      created_by: userId,
    }));

  if (toInsert.length === 0) return 0;

  const { error } = await supabase.from('category_budgets').insert(toInsert);
  if (error) throw error;
  return toInsert.length;
}

/**
 * Gasto del usuario por category_id.
 * @returns {Map<string, number>}
 */
export function computeSpentByCategory(transactions, userId) {
  const totals = new Map();
  for (const tx of transactions) {
    const userAmount = userGastoAmount(tx, userId);
    if (userAmount <= 0) continue;
    const catId = tx.category_id || tx.categories?.id;
    if (!catId) continue;
    totals.set(catId, (totals.get(catId) || 0) + userAmount);
  }
  return totals;
}

/** @returns {'ok'|'warn'|'danger'} */
export function budgetStatus(pct) {
  if (pct >= 1) return 'danger';
  if (pct >= 0.8) return 'warn';
  return 'ok';
}

export const BUDGET_STATUS_LABELS = {
  ok: '',
  warn: 'Cerca del límite',
  danger: 'Sobrepasado',
};

/**
 * Uso de presupuesto por categoría (solo categorías con límite definido).
 * @param {Array} transactions
 * @param {Array} budgets — filas category_budgets
 * @param {string} userId
 */
export function computeBudgetUsage(transactions, budgets, userId) {
  const spentMap = computeSpentByCategory(transactions, userId);

  return budgets
    .filter((b) => b.categories?.type === 'gasto')
    .map((b) => {
      const cat = b.categories;
      const spent = spentMap.get(b.category_id) || 0;
      const budget = Number(b.amount) || 0;
      const pct = budget > 0 ? spent / budget : 0;
      const status = budgetStatus(pct);
      return {
        categoryId: b.category_id,
        name: cat?.name || 'Sin categoría',
        icon: cat?.icon || '📌',
        spent,
        budget,
        pct,
        status,
        statusLabel: BUDGET_STATUS_LABELS[status],
      };
    })
    .sort((a, b) => b.spent - a.spent);
}

/**
 * Filas para la vista de edición: todas las categorías de gasto.
 * @param {Array} categories
 * @param {Array} budgets
 * @param {Array} transactions
 * @param {string} userId
 */
export function computeBudgetEditorRows(categories, budgets, transactions, userId) {
  const spentMap = computeSpentByCategory(transactions, userId);
  const budgetMap = new Map(budgets.map((b) => [b.category_id, Number(b.amount) || 0]));

  return categories
    .filter((c) => c.type === 'gasto')
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    .map((cat) => {
      const spent = spentMap.get(cat.id) || 0;
      const budget = budgetMap.get(cat.id) ?? null;
      const pct = budget && budget > 0 ? spent / budget : null;
      const status = pct !== null ? budgetStatus(pct) : null;
      return {
        categoryId: cat.id,
        name: cat.name,
        icon: cat.icon || '📌',
        spent,
        budget,
        pct,
        status,
        statusLabel: status ? BUDGET_STATUS_LABELS[status] : '',
        hasBudget: budget !== null && budget > 0,
      };
    });
}

/**
 * Cuánto queda en cada bucket 50/30/20 (derivado, sin schema extra).
 * @param {ReturnType<import('./balances.js').computeBalances>} stats
 */
export function computeBucketRemaining(stats) {
  const { ingresos = 0, gastosNecesidades = 0, gastosDeseos = 0, ahorro = 0 } = stats || {};
  if (ingresos <= 0) return [];

  return [
    { key: 'necesidad', label: 'necesidades', remaining: ingresos * 0.5 - gastosNecesidades },
    { key: 'deseo', label: 'deseos', remaining: ingresos * 0.3 - gastosDeseos },
    { key: 'ahorro', label: 'ahorro', remaining: ingresos * 0.2 - ahorro },
  ];
}

/**
 * Copy para subtítulo de bucket restante.
 * @param {{ key: string, label: string, remaining: number }} row
 * @param {(n: number) => string} formatMoney
 */
export function bucketRemainingLabel(row, formatMoney) {
  const { key, label, remaining } = row;
  const abs = Math.abs(remaining);
  if (abs < 0.01) {
    return key === 'ahorro' ? 'Meta de ahorro alcanzada' : 'Meta alcanzada';
  }
  if (remaining > 0) {
    if (key === 'ahorro') {
      return `Te faltan ${formatMoney(remaining)} para la meta de ahorro`;
    }
    return `Te quedan ${formatMoney(remaining)} en ${label}`;
  }
  return `Por encima de la meta en ${formatMoney(abs)}`;
}
