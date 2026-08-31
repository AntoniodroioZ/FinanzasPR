# MVP+ — Plan de implementación

**Estado:** implementado (agosto 2026).

## Objetivo

Completar el dashboard para que deje de ser solo “caja del mes” y pase a **decisión financiera**:

1. **Balance neto** visible  
2. **Desglose 50/30/20** visual (real vs meta)  
3. **Gasto por categoría** (ranking del mes)  
4. Superficie UI para totales que **ya calcula** `computeBalances`

Sin nuevas tablas Supabase, sin selector de mes, sin librería de charts (salvo que CSS no baste).

---

## Alcance (in / out)

### In

| # | Entrega | Criterio de hecho |
|---|---------|-------------------|
| A | KPI **Balance neto** | Monto + contexto “ingresos − gastos”; estilo positivo/negativo |
| B | KPI **Tasa de ahorro** (o % ahorro/ingresos) | % + monto de `ahorro` |
| C | Contexto de **gastos totales** | Subtexto o mini-split: personal vs tu parte compartida |
| D | Bloque **50/30/20** | Barras (o donut CSS) con % real, meta, semáforo |
| E | Bloque **Por categoría** | Top categorías de gasto del mes (monto + % del gasto total) |
| F | Docs de referencia | `FEATURES.md` + este plan |

### Out (explícito)

- Selector de mes / histórico multi-mes  
- Comparación vs mes anterior  
- Presupuestos, metas, alertas  
- Chart libraries (Chart.js, etc.)  
- Nuevas categorías en seed SQL  
- Cambios de schema / RLS  
- Filtros avanzados en movimientos  
- Split 60/40 o historial de liquidación  

---

## Datos: qué ya existe vs qué hay que agregar

### Ya en `computeBalances` (`js/balances.js`)

```
ingresos, gastosPersonales, gastosCompartidosMiParte,
gastosCompartidosBruto, gastosTotales, balancePersonal,
gastosNecesidades, gastosDeseos, ahorro,
healthScore, healthLabel, settlement*
```

### Falta calcular (helper nuevo o extensión)

Agregar en `balances.js` (o módulo hermano `analytics.js`) una función pura, p.ej. `computeCategoryBreakdown(transactions, userId)`:

- Filtrar gastos del usuario (personales + parte proporcional de compartidos, misma regla que balances).
- Agrupar por `categories.name` (+ icon).
- Devolver array ordenado por monto desc: `{ name, icon, amount, pctOfExpenses }`.
- Opcional: breakdown de ingresos por categoría (fase posterior; MVP+ prioriza **gastos**).

Para 50/30/20 en UI:

```
necPct = gastosNecesidades / ingresos
desPct = gastosDeseos / ingresos
ahrPct = ahorro / ingresos
```

Metas: 0.50 / 0.30 / 0.20. Semáforo:

| Bucket | OK | Warning | Danger |
|--------|-----|---------|--------|
| Necesidades | ≤50% | ≤60% | >60% |
| Deseos | ≤30% | ≤40% | >40% |
| Ahorro | ≥20% | ≥10% | <10% |

Si `ingresos === 0`: estado vacío (“Registra ingresos…”) — no dividir por cero.

---

## Diseño UI (dashboard)

Orden propuesto dentro de `#view-dashboard` (después del `summary-grid` actual o integrando KPIs nuevos):

```
[ summary-grid ampliado ]
  Ingresos | Gastos totales | Gastos compartidos | Balance pareja
  Balance neto | Tasa de ahorro   ← nuevos (o reemplazar densidad)

[ Salud financiera ]     ← se mantiene

[ 50/30/20 ]             ← NUEVO
  3 filas: label | barra meta | barra real | % | chip semáforo

[ Por categoría ]        ← NUEVO
  lista barras horizontales (top 5–8) + “Sin gastos” empty

[ Tip del asesor ]
[ Últimos movimientos ]
```

### Decisiones de layout

- **Opción recomendada:** ampliar `summary-grid` a 6 cards en desktop (2 filas) y 2 columnas en mobile — coherente con CSS actual.
- Alternativa: dejar 4 cards y meter neto + ahorro dentro de `health-card` — menos visible; no preferida.
- Evitar cards anidadas innecesarias: bloques `card` como el health-card existente.
- Sin overlays, badges flotantes ni stats strip sueltos fuera de la composición del resumen.

### Copy (tono producto)

- Balance neto: “Lo que te queda este mes” / si negativo: “Este mes gastaste más de lo que entró”.
- 50/30/20: “Tu distribución vs la regla 50/30/20”.
- Categorías: “¿En qué se va el dinero?”.

---

## Archivos a tocar

| Archivo | Cambio |
|---------|--------|
| `index.html` | Markup: 2 summary cards + sección 50/30/20 + sección categorías |
| `js/balances.js` | Export helpers % buckets + `computeCategoryBreakdown` (o archivo nuevo) |
| `js/app.js` | `renderDashboard()`: rellenar nuevos nodos |
| `css/styles.css` | Barras bucket, lista categorías, estado +/- del neto |
| `docs/reference/*` | Esta memoria (ya) |

**No tocar** (MVP+): `auth.js`, `groups.js`, migraciones SQL, `config.js`, tip logic salvo si se quiere tip que mencione la nueva UI.

### Módulo opcional

Si `balances.js` crece mucho:

```
js/analytics.js  → computeCategoryBreakdown, bucketPercents(stats)
```

Import desde `app.js` junto a `computeBalances`.

---

## Implementación por pasos (orden de PR mental)

### Paso 1 — Datos

1. Extender o añadir helpers puros + tests manuales con fixtures en consola.  
2. Asegurar que el breakdown de compartidos use `amount * split_ratio` igual que balances.  
3. Casos borde: sin ingresos, sin gastos, solo compartidos, categoría null.

### Paso 2 — Markup + CSS

1. IDs estables: `#sum-net`, `#sum-savings-rate`, `#budget-503020`, `#category-breakdown`.  
2. Barras con `width: %` y clases `.ok` / `.warn` / `.danger`.  
3. Verificar light + dark (`[data-theme="dark"]`).

### Paso 3 — `renderDashboard`

1. Wire de stats existentes a nuevos KPIs.  
2. Render 50/30/20.  
3. Render lista categorías (innerHTML con escape de texto / mismos patrones que `txRowHtml`).  
4. Empty states.

### Paso 4 — Pulido

1. Mobile: grid 2 cols, tipografía de valores.  
2. Accesibilidad: `role="progressbar"` o texto equivalente en barras.  
3. No romper liquidación ni tip actual.

### Paso 5 — Verificación manual

Checklist:

- [ ] Login → `#dashboard`  
- [ ] Con ingresos y gastos en los 3 buckets: % coherentes  
- [ ] Balance neto correcto vs suma mental  
- [ ] Categoría compartida cuenta solo la parte del usuario  
- [ ] Sin datos: empty states, no NaN/% Infinity  
- [ ] Dark mode legible  
- [ ] Tip y liquidación intactos  

---

## Estimación de esfuerzo

| Paso | Esfuerzo relativo |
|------|-------------------|
| Helpers analytics | S |
| HTML/CSS bloques | M |
| Wire `renderDashboard` | S–M |
| QA manual bordes | S |

**Total orientativo:** 1 sesión de implementación focalizada (sin chart lib ni backend).

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|--------|------------|
| Doble conteo de compartidos en categorías | Reusar exactamente la misma regla que `computeBalances` |
| Dashboard saturado en mobile | Top 5 categorías + “ver más” link a transacciones si hace falta |
| Salud financiera redundante con tasa de ahorro | Mantener health como score; tasa de ahorro como KPI numérico claro |
| Categorías sin `budget_bucket` | Excluir del 50/30/20 o bucket “otros” (decidir en impl: preferir excluir del % y listar en categorías) |

---

## Criterios de aceptación (producto)

Un usuario en el dashboard puede, **sin abrir otra vista**:

1. Ver si el mes va a positivo o negativo (neto).  
2. Ver si está dentro de 50/30/20 (visual + %).  
3. Identificar la categoría que más consume su gasto.  

Si falla cualquiera de los tres, el MVP+ no está cerrado.

---

## Siguiente acción tras aprobar este plan

Implementar Pasos 1→4 en el código, en un solo bloque de trabajo, sin ampliar al backlog v1.1.

Referencia de features futuras: [`FEATURES.md`](./FEATURES.md).
