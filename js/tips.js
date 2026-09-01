/**
 * Tips financieros contextuales (tono calmado, estilo asesor).
 * Regla 50/30/20: Necesidades ≤50%, Deseos ≤30%, Ahorro ≥20%.
 */

/**
 * @param {object} stats — salida de computeBalances + campos opcionales
 * @param {Array} [budgetUsage] — salida de computeBudgetUsage
 * @returns {{ text: string, icon: string }}
 */
export function getFinancialTip(stats, budgetUsage = []) {
  const {
    ingresos = 0,
    gastosNecesidades = 0,
    gastosDeseos = 0,
    ahorro = 0,
    gastosTotales = 0,
    balancePersonal = 0,
    settlementAmount = 0,
    healthScore = 0,
  } = stats || {};

  const overrun = budgetUsage.find((u) => u.status === 'danger');
  if (overrun) {
    return {
      icon: '🎯',
      text: `${overrun.name} superó tu presupuesto este mes. Un ajuste pequeño el resto del mes puede equilibrar.`,
    };
  }

  if (ingresos <= 0) {
    return {
      icon: '🌱',
      text: 'Registra tus ingresos para activar el análisis 50/30/20 y ver tu salud financiera con contexto.',
    };
  }

  const necPct = gastosNecesidades / ingresos;
  const desPct = gastosDeseos / ingresos;
  const ahrPct = ahorro / ingresos;

  if (settlementAmount >= 50) {
    return {
      icon: '🤝',
      text: 'Tienen un desbalance notable en gastos compartidos. Liquidar pronto evita fricción y mantiene la confianza.',
    };
  }

  if (necPct > 0.5) {
    return {
      icon: '🏠',
      text: 'Tus necesidades superan el 50% de tus ingresos. Revisa servicios recurrentes y busca un ajuste pequeño y sostenible.',
    };
  }

  if (desPct > 0.3) {
    return {
      icon: '⏳',
      text: 'Los gastos discrecionales están altos (>30%). Prueba la regla de 24 horas antes de compras no esenciales.',
    };
  }

  if (ahrPct >= 0.2 || healthScore >= 80) {
    return {
      icon: '✨',
      text: 'Vas por buen camino con la regla 50/30/20. Considera automatizar tu ahorro el día que cobras.',
    };
  }

  if (balancePersonal < 0) {
    return {
      icon: '🧭',
      text: 'Este mes los egresos superan a los ingresos. Prioriza necesidades y pausa deseos hasta equilibrar.',
    };
  }

  if (gastosTotales / ingresos > 0.9) {
    return {
      icon: '🎯',
      text: 'Estás cerca del límite de tus ingresos. Un colchón del 20% en ahorro te da margen ante imprevistos.',
    };
  }

  if (ahrPct < 0.1 && ahrPct >= 0) {
    return {
      icon: '🏦',
      text: 'Aún no llegas al 20% de ahorro. Empieza con un porcentaje pequeño fijo — la constancia supera al monto.',
    };
  }

  return {
    icon: '💚',
    text: 'Sigue registrando con calma. La claridad de datos es el primer paso hacia decisiones financieras serenas.',
  };
}
