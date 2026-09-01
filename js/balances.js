/**
 * Cálculos de balance individual, hogar y liquidación de pareja.
 *
 * Liquidación 50/50:
 *   Quien paga un gasto compartido de $X adelanta X * split_ratio al otro.
 *   netCredit[user] = Σ pagado − Σ (amount * split_ratio) en txs compartidas.
 *   Si A tiene más crédito neto que B, B le transfiere la diferencia / 2... 
 *   En realidad con 2 personas: settlement = creditA (si positivo, B debe a A).
 */

function categoryType(tx) {
  return tx.categories?.type || null;
}

function bucket(tx) {
  return tx.categories?.budget_bucket || null;
}

/** Ingresos personales del miembro en el conjunto de transacciones dado. */
export function sumMemberIncome(transactions, memberId) {
  let total = 0;
  for (const tx of transactions) {
    if (categoryType(tx) === 'ingreso' && tx.user_id === memberId) {
      total += Number(tx.amount) || 0;
    }
  }
  return total;
}

/** Ratio de split según ingresos del mes (parte del usuario actual). */
export function computeIncomeSplitRatio(myIncome, partnerIncome) {
  const total = myIncome + partnerIncome;
  if (total <= 0) return 0.5;
  return Math.round((myIncome / total) * 1000) / 1000;
}

/**
 * Parte de un gasto compartido que corresponde a un miembro.
 * split_ratio = porción del user_id que registró la transacción.
 */
export function memberShare(tx, memberId, members = []) {
  const ratio = Number(tx.split_ratio) ?? 0.5;
  if (memberId === tx.user_id) return ratio;
  const others = members.filter((m) => m.id !== tx.user_id);
  if (others.length === 0) return 0;
  return (1 - ratio) / others.length;
}

/**
 * Ratio a usar al crear una TX compartida nueva.
 */
export function resolveSplitRatio(group, transactions, userId, members) {
  if (group?.split_mode === 'income_proportional') {
    const myInc = sumMemberIncome(transactions, userId);
    const partner = members.find((m) => m.id !== userId);
    const partnerInc = partner ? sumMemberIncome(transactions, partner.id) : 0;
    return computeIncomeSplitRatio(myInc, partnerInc);
  }
  return Number(group?.default_split_ratio) ?? 0.5;
}

/**
 * Cuánto adelantó cada persona en gastos compartidos del mes.
 * @returns {Array<{ memberId, name, paid, pct }>}
 */
export function computeSharedContributions(transactions, members, displayNameFn = displayName) {
  const paid = {};
  for (const m of members) paid[m.id] = 0;

  let totalShared = 0;
  for (const tx of transactions) {
    if (!tx.is_shared || categoryType(tx) !== 'gasto') continue;
    const amount = Number(tx.amount) || 0;
    const payer = tx.paid_by_user_id;
    totalShared += amount;
    if (paid[payer] !== undefined) paid[payer] += amount;
  }

  return members.map((m) => ({
    memberId: m.id,
    name: displayNameFn(m),
    paid: paid[m.id] || 0,
    pct: totalShared > 0 ? (paid[m.id] || 0) / totalShared : 0,
  }));
}

/**
 * @param {Array} transactions
 * @param {string} userId
 * @param {Array<{id:string}>} members
 */
export function computeBalances(transactions, userId, members = []) {
  const partner = members.find((m) => m.id !== userId) || null;

  let ingresos = 0;
  let gastosPersonales = 0;
  let gastosCompartidosMiParte = 0;
  let gastosCompartidosBruto = 0;
  let gastosNecesidades = 0;
  let gastosDeseos = 0;
  let ahorro = 0;

  const credits = {};
  for (const m of members) credits[m.id] = 0;
  if (!credits[userId]) credits[userId] = 0;

  for (const tx of transactions) {
    const type = categoryType(tx);
    const amount = Number(tx.amount) || 0;
    const isShared = Boolean(tx.is_shared);
    const paidBy = tx.paid_by_user_id;
    const b = bucket(tx);

    if (type === 'ingreso') {
      if (tx.user_id === userId) ingresos += amount;
      continue;
    }

    if (type !== 'gasto') continue;

    if (isShared) {
      gastosCompartidosBruto += amount;
      const share = memberShare(tx, userId, members);
      gastosCompartidosMiParte += amount * share;

      if (credits[paidBy] !== undefined) credits[paidBy] += amount;
      for (const mid of Object.keys(credits)) {
        credits[mid] -= amount * memberShare(tx, mid, members);
      }

      if (b === 'necesidad') gastosNecesidades += amount * share;
      else if (b === 'deseo') gastosDeseos += amount * share;
      else if (b === 'ahorro') ahorro += amount * share;
    } else if (tx.user_id === userId) {
      gastosPersonales += amount;
      if (b === 'necesidad') gastosNecesidades += amount;
      else if (b === 'deseo') gastosDeseos += amount;
      else if (b === 'ahorro') ahorro += amount;
    }
  }

  const gastosTotales = gastosPersonales + gastosCompartidosMiParte;
  const balancePersonal = ingresos - gastosTotales;

  // Liquidación: crédito neto del usuario vs pareja
  let settlementAmount = 0;
  let fromUser = null;
  let toUser = null;
  let settlementMessage = 'Aún no hay pareja vinculada. Los gastos compartidos se liquidarán cuando sean dos.';

  if (partner) {
    const myCredit = credits[userId] || 0;
    // myCredit > 0 → la pareja te debe; < 0 → tú debes
    settlementAmount = Math.round(Math.abs(myCredit) * 100) / 100;

    if (settlementAmount < 0.01) {
      settlementMessage = 'Están a mano. ¡Cuentas claras, pareja en calma!';
      settlementAmount = 0;
    } else if (myCredit > 0) {
      fromUser = partner;
      toUser = members.find((m) => m.id === userId);
      const nameFrom = displayName(partner);
      const nameTo = displayName(toUser);
      settlementMessage = `Para estar a mano, ${nameFrom} transfiere ${formatMoney(settlementAmount)} a ${nameTo}.`;
    } else {
      fromUser = members.find((m) => m.id === userId);
      toUser = partner;
      const nameFrom = displayName(fromUser);
      const nameTo = displayName(partner);
      settlementMessage = `Para estar a mano, ${nameFrom} transfiere ${formatMoney(settlementAmount)} a ${nameTo}.`;
    }
  } else if (gastosCompartidosBruto === 0) {
    settlementMessage = 'Sin gastos compartidos este mes. Todo en orden.';
  }

  // Salud: (ahorro / ingresos) / 0.20 → 100% si cumples la meta del 20%
  let healthScore = 0;
  if (ingresos > 0) {
    const savingsRate = ahorro / ingresos;
    healthScore = Math.min(100, Math.round((savingsRate / 0.2) * 100));
    // Si hay sobrante positivo no categorizado como ahorro, sumamos un poco
    const residual = Math.max(0, balancePersonal);
    if (ahorro === 0 && residual > 0) {
      healthScore = Math.min(100, Math.round(((residual / ingresos) / 0.2) * 100));
    }
  }

  let healthLabel = 'Sin datos';
  if (ingresos <= 0) healthLabel = 'Registra ingresos';
  else if (healthScore >= 80) healthLabel = 'Excelente';
  else if (healthScore >= 40) healthLabel = 'En camino';
  else healthLabel = 'Ajustar gastos';

  return {
    ingresos,
    gastosPersonales,
    gastosCompartidosMiParte,
    gastosCompartidosBruto,
    gastosTotales,
    balancePersonal,
    gastosNecesidades,
    gastosDeseos,
    ahorro,
    healthScore,
    healthLabel,
    settlementAmount,
    settlementMessage,
    fromUser,
    toUser,
    credits,
    partner,
  };
}

export function displayName(profile) {
  if (!profile) return 'Usuario';
  return profile.full_name || profile.email?.split('@')[0] || 'Usuario';
}

export function formatMoney(amount, currency = 'USD') {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('es-PR', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

export function monthLabel(date = new Date()) {
  return new Intl.DateTimeFormat('es-PR', { month: 'long', year: 'numeric' }).format(date);
}
