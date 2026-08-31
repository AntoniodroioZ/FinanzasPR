# FinanzasPR — Catálogo de features

Memoria de producto para desarrollo. Prioridades relativas al estado actual del dashboard (`#dashboard`).

**Leyenda de estado**

| Estado | Significado |
|--------|-------------|
| `exists` | Visible o usable en UI hoy |
| `computed` | Se calcula en `js/balances.js` / tips, pero no se muestra (o solo de forma parcial) |
| `planned-mvp+` | Alcance inmediato (ver `MVP-PLUS-PLAN.md`) |
| `backlog` | Idea validada, fuera del MVP+ |
| `future` | Visión a medio/largo plazo |

---

## 1. Dashboard — resumen del mes

| Feature | Estado | Notas |
|---------|--------|-------|
| Ingresos del mes | `exists` | Solo monto; sin fuentes |
| Gastos totales (personal + tu parte hogar) | `exists` | Sin desglose |
| Gastos compartidos (bruto hogar) | `exists` | |
| Balance de pareja / liquidación pendiente | `exists` | Monto o “Al día” |
| Salud financiera (barra % + label) | `exists` | Proxy de tasa de ahorro 20% |
| Tip del asesor (1 insight) | `exists` | `js/tips.js`, regla 50/30/20 |
| Últimos 5 movimientos | `exists` | Link a `#transacciones` |
| Label del mes actual | `exists` | Sin selector de mes |
| **Balance neto del mes** (ingresos − gastos) | `exists` | KPI `#sum-net` |
| **Tasa de ahorro como KPI** | `exists` | `#sum-savings-rate` |
| **Gasto personal vs tu parte compartida** | `exists` | Subtexto `#sum-expenses-ctx` |
| Burn rate / proyección fin de mes | `backlog` | Requiere calendario del mes |
| Comparación vs mes anterior (Δ%) | `backlog` | Requiere cargar mes N-1 |
| Selector de mes / histórico | `backlog` | Hoy filtra solo mes corriente en data layer |

---

## 2. Análisis 50/30/20

| Feature | Estado | Notas |
|---------|--------|-------|
| Buckets en categorías (`necesidad` / `deseo` / `ahorro` / `ingreso`) | `exists` | Seed en migración SQL |
| Tips contextuales por umbral | `exists` | |
| Score de salud ligado a ahorro ≥20% | `exists` | |
| Totales necesidades / deseos / ahorro | `exists` | Bloque `#budget-503020` |
| **Gráfica o barras 50/30/20** (real vs meta) | `exists` | Barras CSS + marcador meta |
| Semáforo por bucket | `exists` | Chips ok / warn / danger |
| Gasto restante por bucket (“te quedan $X en deseos”) | `backlog` | Depende de presupuestos o de la meta % |

---

## 3. Gasto / ingreso por categoría

| Feature | Estado | Notas |
|---------|--------|-------|
| Categorías seed (vivienda, food, etc.) | `exists` | Ver sección 8 |
| Asignar categoría al crear movimiento | `exists` | Modal TX |
| **Breakdown por categoría en dashboard** | `exists` | `#category-breakdown`, top 8 |
| Pie / donut por categoría | `backlog` | Evolución del breakdown MVP+ |
| Top N gastos del mes (tabla) | `backlog` | |
| Ingresos por fuente (Salario / Freelance / Otros) | `backlog` | |
| Detectar recurrentes vs one-off | `future` | Heurística por descripción/monto |

---

## 4. Gráficas y tendencias

| Feature | Estado | Notas |
|---------|--------|-------|
| Cashflow diario (línea ingresos vs gastos) | `backlog` | |
| Tendencia 3–6 meses | `backlog` | Necesita query multi-mes |
| Heatmap semanal de gasto | `future` | |
| Widget “mes en 1 mirada” | `backlog` | Composición de KPIs MVP+ |

---

## 5. Movimientos (lista y UX)

| Feature | Estado | Notas |
|---------|--------|-------|
| CRUD transacciones | `exists` | |
| Personal vs compartido | `exists` | |
| Quién pagó (shared) | `exists` | |
| Filtros (tipo, categoría, shared, fechas, monto) | `backlog` | |
| Búsqueda por descripción | `backlog` | |
| Paginación / infinite scroll | `future` | |

---

## 6. Pareja / liquidación

| Feature | Estado | Notas |
|---------|--------|-------|
| Vista `#liquidacion` | `exists` | |
| Split 50/50 (`split_ratio` default 0.5) | `exists` | |
| Mensaje de quién transfiere a quién | `exists` | |
| Resumen crédito neto por persona | `exists` | |
| Aportación % de cada quien a compartidos | `backlog` | |
| Historial de liquidaciones (marcar pagado) | `backlog` | Nueva tabla o flag |
| Split editable (60/40, proporcional a ingresos) | `backlog` | |
| Presupuesto del hogar vs personal | `future` | |

---

## 7. Presupuestos, metas e insights

| Feature | Estado | Notas |
|---------|--------|-------|
| Presupuesto mensual por categoría + barra | `backlog` | Schema nuevo |
| Alertas al 80/100% del presupuesto | `backlog` | |
| Metas de ahorro (emergencia, viaje, etc.) | `backlog` | |
| Score de salud compuesto (más que ahorro) | `backlog` | |
| 3 insights del asesor (no solo 1 tip) | `backlog` | Extender `tips.js` |
| Simulador “¿qué pasaría si…?” | `future` | |
| Export CSV / PDF | `future` | |

---

## 8. Categorías (seed actual + propuestas)

### Seed actual (`seed_default_categories`)

**Necesidades:** Vivienda, Alimentación, Transporte, Servicios, Salud  
**Deseos:** Entretenimiento, Restaurantes, Compras, Suscripciones  
**Ahorro:** Ahorro, Inversión, Fondo de emergencia  
**Ingresos:** Salario, Freelance, Otros ingresos  

### Propuestas backlog (PR / pareja)

| Tipo | Bucket | Categorías sugeridas |
|------|--------|----------------------|
| gasto | necesidad | Educación, Seguros, Deudas/préstamos, Cuidado (niños/mascotas), Impuestos/IVU |
| gasto | deseo | Viajes, Regalos, Cuidado personal, Hobbies, Donaciones |
| ingreso | ingreso | Bonos, Transferencias familiares, Intereses/dividendos, Reembolsos, Alquiler |
| — | — | Categorías custom por grupo + alerta “sin categoría” |

---

## 9. Roadmap por fases

| Fase | Contenido | Doc |
|------|-----------|-----|
| **MVP+** | Balance neto, desglose visual 50/30/20, gasto por categoría, KPIs derivados ya calculados | `MVP-PLUS-PLAN.md` |
| **v1.1** | Selector de mes, vs mes anterior, top gastos | backlog arriba |
| **v1.2** | Presupuestos por categoría + alertas | backlog |
| **v1.3** | Tendencias 6 meses, metas de ahorro, splits flexibles, historial liquidación | backlog / future |

---

## 10. Principios de producto (no negociables en UI)

- Tono calmado: claridad sin presión (copy existente).
- Una sección = un propósito (evitar dashboard sobrecargado).
- Preferir CSS nativo / HTML semántico antes de librerías de charts en MVP+.
- Reutilizar `computeBalances` — no duplicar lógica de liquidación o buckets.
- Light/dark via tokens existentes en `css/styles.css`.

---

*Última actualización: planificación MVP+ — agosto 2026*
