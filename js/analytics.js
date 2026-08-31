/**
 * Análisis derivado de transacciones y stats de computeBalances.
 * MVP+: 50/30/20 y breakdown por categoría.
 */

function categoryType(tx) {
  return tx.categories?.type || null;
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
    if (categoryType(tx) !== 'gasto') continue;

    const amount = Number(tx.amount) || 0;
    const ratio = Number(tx.split_ratio) ?? 0.5;
    const isShared = Boolean(tx.is_shared);

    let userAmount = 0;
    if (isShared) {
      userAmount = amount * ratio;
    } else if (tx.user_id === userId) {
      userAmount = amount;
    }

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
