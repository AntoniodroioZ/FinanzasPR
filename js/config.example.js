/**
 * Plantilla de referencia. No uses este archivo en producción.
 *
 * Flujo recomendado:
 *   1. cp .env.example .env
 *   2. Rellena SUPABASE_URL y SUPABASE_ANON_KEY
 *   3. node scripts/generate-config.js  → genera js/config.js
 *
 * La anon key es pública por diseño de Supabase; la seguridad real
 * está en las políticas RLS del proyecto. Nunca uses la service_role key aquí.
 */
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_PUBLIC_KEY';
