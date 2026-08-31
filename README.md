# FinanzasPR

Aplicación web de **finanzas personales y en pareja**: minimalista, calmada y compatible con despliegue estático (Vercel / GitHub Pages).

Stack: HTML5 · CSS3 (variables, light/dark) · JavaScript Vanilla (ES Modules) · Supabase (Auth + PostgreSQL + RLS).

---

## Fase 0 — Configurar Supabase (obligatorio)

### 1. Crear proyecto

1. Entra en [supabase.com](https://supabase.com) → **New Project**.
2. Guarda **Project URL** y **anon public key** (Settings → API).

### 2. Autenticación

- **Email / Password**: Authentication → Providers → Email (activo).
- **Google OAuth**:
  1. [Google Cloud Console](https://console.cloud.google.com) → Credentials → OAuth 2.0 Web Client.
  2. Authorized redirect URI de Supabase (lo muestra el panel al activar Google).
  3. Authentication → Providers → Google → Client ID y Secret.
- **URL Configuration** (Authentication → URL Configuration):
  - Site URL: tu URL de producción (Vercel o GitHub Pages).
  - Redirect URLs:
    - `http://localhost:5500/`
    - `http://127.0.0.1:5500/`
    - `https://<tu-usuario>.github.io/FinanzasPR/`
    - `https://<tu-proyecto>.vercel.app/`

### 3. Schema SQL

En **SQL Editor**, pega y ejecuta:

[`supabase/migrations/001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql)

### 4. Usuario de prueba

Regístrate desde la app o crea en Authentication → Users:

- Email: `antonybey13+1@gmail.com`

El trigger `handle_new_user` crea la fila en `profiles`.

### 5. Config local (credenciales)

Las claves viven en `.env` (gitignored). `js/config.js` se **genera** y tampoco se sube.

```bash
cp .env.example .env
# Edita .env con Project URL y anon key (Settings → API)
node scripts/generate-config.js
```

**No subas** `.env` ni `js/config.js`. La **anon key** es pública en el navegador por diseño de Supabase; protege los datos con **RLS**. Nunca uses la `service_role` key en el frontend.

---

## Desarrollo local

Sirve la carpeta raíz con cualquier servidor estático (ES Modules requieren HTTP):

```bash
# Python
python3 -m http.server 5500

# o VS Code / Cursor Live Server en el puerto 5500
```

Abre `http://localhost:5500/`.

---

## Funcionalidades

| Área | Qué hace |
|------|----------|
| Auth | Email/contraseña + Google |
| Espacio pareja | Crear grupo + código invitación (máx. 2) |
| Transacciones | Monto, descripción, fecha, categoría, personal/compartido, pagador |
| Categorías | Seed 50/30/20 (necesidades / deseos / ahorro + ingresos) |
| Dashboard | Ingresos, gastos, compartidos, balance pareja, salud financiera |
| Liquidación | Mensaje amigable: quién le transfiere a quién |
| Tips | Consejos según estado del presupuesto |
| Tema | Claro / oscuro (preferencia en `localStorage`) |

---

## Despliegue

### Vercel

1. Importa el repo en [vercel.com](https://vercel.com).
2. Environment Variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. Framework: Other. `vercel.json` ya define build (`node scripts/generate-config.js`) y rewrite SPA.
4. Registra la URL de Vercel en Supabase Redirect URLs.

### GitHub Pages

1. Settings → Pages → Source: **GitHub Actions**.
2. Secrets del repo (`Settings → Secrets and variables → Actions`):
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
3. El workflow [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml) genera `js/config.js` y publica.
4. Añade `https://<usuario>.github.io/FinanzasPR/` en Supabase Redirect URLs.

---

## Estructura

```
FinanzasPR/
├── .env.example           # plantilla de secrets
├── .env                   # local (gitignored)
├── index.html
├── css/styles.css
├── js/
│   ├── config.example.js
│   ├── config.js          # generado (gitignored)
│   ├── supabaseClient.js
│   └── …
├── scripts/generate-config.js
├── supabase/migrations/001_initial_schema.sql
├── vercel.json
└── .nojekyll
```

---

## Consejo financiero (producto)

La regla **50/30/20** guía las categorías y los tips:

- **≤50%** necesidades  
- **≤30%** deseos  
- **≥20%** ahorro e inversión  

El módulo de liquidación busca **cuentas claras sin culpa**: mensajes neutrales (“para estar a mano…”) en lugar de “deuda”.
