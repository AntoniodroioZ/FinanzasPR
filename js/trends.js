/**
 * Tendencia multi-mes (v1.3): ingresos, gastos, ahorro, neto.
 */
import { fetchTransactions, startOfMonth, endOfMonth, shiftMonth, normalizeMonth } from './transactions.js';
import { computeBalances } from './balances.js';

/**
 * @param {string} groupId
 * @param {Date} anchorMonth
 * @param {string} userId
 * @param {Array} members
 * @returns {Promise<Array<{ month: Date, monthKey: string, label: string, stats: object, hasData: boolean }>>}
 */
export async function fetchMonthlyTrend(groupId, anchorMonth, userId, members) {
  const anchor = normalizeMonth(anchorMonth);
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    months.push(shiftMonth(anchor, -i));
  }

  const from = startOfMonth(months[0]);
  const to = endOfMonth(months[months.length - 1]);
  const transactions = await fetchTransactions(groupId, { from, to });

  const byMonth = new Map();
  for (const m of months) {
    const key = startOfMonth(m);
    byMonth.set(key, []);
  }

  for (const tx of transactions) {
    const txDate = new Date(tx.date + 'T12:00:00');
    const key = startOfMonth(txDate);
    if (byMonth.has(key)) byMonth.get(key).push(tx);
  }

  const formatter = new Intl.DateTimeFormat('es-PR', { month: 'short', year: 'numeric' });

  return months.map((month) => {
    const monthKey = startOfMonth(month);
    const txs = byMonth.get(monthKey) || [];
    const stats = computeBalances(txs, userId, members);
    const hasData = txs.length > 0;
    return {
      month,
      monthKey,
      label: formatter.format(month),
      stats,
      hasData,
    };
  });
}

/**
 * Meses con al menos un movimiento.
 * @param {Array} trendRows
 */
export function countMonthsWithData(trendRows) {
  return trendRows.filter((r) => r.hasData).length;
}

/**
 * Máximo de gastos para escalar mini-barras CSS.
 * @param {Array} trendRows
 */
export function maxTrendExpenses(trendRows) {
  return Math.max(...trendRows.map((r) => r.stats.gastosTotales || 0), 1);
}
