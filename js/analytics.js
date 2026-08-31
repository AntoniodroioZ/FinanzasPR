/**
 * Análisis derivado de transacciones y stats de computeBalances.
 * MVP+: 50/30/20 y breakdown por categoría.
 */

function categoryType(tx) {
  return tx.categories?.type || null;
}

/** Monto de gasto atribuible al usuario (personal o su parte compartida). */
export function userGastoAmount(tx, userId) {
  if (categoryType(tx) !== 'gasto') return 0;
  const amount = Number(tx.amount) || 0;
  const ratio = Number(tx.split_ratio) ?? 0.5;
  if (tx.is_shared) return amount * ratio;
  if (tx.user_id === userId) return amount;
  return 0;
}

/**
 * @returns {{ text: string, class: 'positive'|'negative'|'neutral' } | null}
 */
export function formatMonthDelta(current, previous, { invert = false, isPercentPoints = false } = {}) {
  if (previous === 0 && current === 0) return null;
  if (previous === 0) {
    return { text: 'Sin referencia mes anterior', class: 'neutral' };
  }

  if (isPercentPoints) {
    const diff = current - previous;
    const sign = diff > 0 ? '+' : '';
    const improved = invert ? diff < 0 : diff > 0;
    return {
      text: `${sign}${Math.round(diff)} pp vs mes anterior`,
      class: diff === 0 ? 'neutral' : improved ? 'positive' : 'negative',
    };
  }

  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const sign = pct > 0 ? '+' : '';
  const improved = invert ? pct < 0 : pct > 0;
  return {
    text: `${sign}${Math.round(pct)}% vs mes anterior`,
    class: pct === 0 ? 'neutral' : improved ? 'positive' : 'negative',
  };
}

/** @param {'necesidad'|'deseo'|'ahorro'} bucket */
export function bucketStatus(bucket, pct) {
  if (bucket === 'necesidad') {
    if (pct <= 0.5) return 'ok';
    if (pct <= 0.6) return 'warn';
    return 'danger';
  }
  if (bucket === 'deseo') {
    if (pct <= 0.3) return 'ok';
    if (pct <= 0.4) return 'warn';
    return 'danger';
  }
  // ahorro — más alto es mejor
  if (pct >= 0.2) return 'ok';
  if (pct >= 0.1) return 'warn';
  return 'danger';
}

const STATUS_LABELS = { ok: 'En meta', warn: 'Atención', danger: 'Ajustar' };

/**
 * Filas para UI 50/30/20.
 * @param {ReturnType<import('./balances.js').computeBalances>} stats
 */
export function computeBucketRows(stats) {
  const { ingresos = 0, gastosNecesidades = 0, gastosDeseos = 0, ahorro = 0 } = stats || {};
  if (ingresos <= 0) return [];

  const rows = [
    { key: 'necesidad', label: 'Necesidades', amount: gastosNecesidades, target: 0.5 },
    { key: 'deseo', label: 'Deseos', amount: gastosDeseos, target: 0.3 },
    { key: 'ahorro', label: 'Ahorro / inversión', amount: ahorro, target: 0.2 },
  ];

  return rows.map(({ key, label, amount, target }) => {
    const pct = amount / ingresos;
    const status = bucketStatus(key, pct);
    return {
      key,
      label,
      amount,
      target,
      targetLabel: `${Math.round(target * 100)}%`,
      pct,
      pctLabel: `${Math.round(pct * 100)}%`,
      status,
      statusLabel: STATUS_LABELS[status],
    };
  });
}

/**
 * Gasto del usuario por categoría (personal + parte compartida).
 * @param {Array} transactions
 * @param {string} userId
 * @param {number} [limit=8]
 */
export function computeCategoryBreakdown(transactions, userId, limit = 8) {
  const totals = new Map();

  for (const tx of transactions) {
    const userAmount = userGastoAmount(tx, userId);
    if (userAmount <= 0) continue;

    const cat = tx.categories;
    const name = cat?.name || 'Sin categoría';
    const icon = cat?.icon || '📌';
    const id = name;

    const prev = totals.get(id) || { name, icon, amount: 0 };
    prev.amount += userAmount;
    totals.set(id, prev);
  }

  const items = [...totals.values()].sort((a, b) => b.amount - a.amount);
  const totalExpenses = items.reduce((s, i) => s + i.amount, 0);

  return items.slice(0, limit).map((item) => ({
    ...item,
    pctOfExpenses: totalExpenses > 0 ? item.amount / totalExpenses : 0,
  }));
}

/**
 * Gastos individuales más grandes (tu parte), ordenados por monto.
 * @param {Array} transactions
 * @param {string} userId
 * @param {number} [limit=10]
 */
export function computeTopExpenses(transactions, userId, limit = 10) {
  const items = [];

  for (const tx of transactions) {
    const amount = userGastoAmount(tx, userId);
    if (amount <= 0) continue;

    const cat = tx.categories;
    items.push({
      id: tx.id,
      date: tx.date,
      description: tx.description || cat?.name || 'Gasto',
      categoryName: cat?.name || 'Sin categoría',
      icon: cat?.icon || '📌',
      amount,
      isShared: Boolean(tx.is_shared),
    });
  }

  items.sort((a, b) => b.amount - a.amount);
  const top = items.slice(0, limit);
  const totalExpenses = items.reduce((s, i) => s + i.amount, 0);

  return top.map((item) => ({
    ...item,
    pctOfExpenses: totalExpenses > 0 ? item.amount / totalExpenses : 0,
  }));
}
