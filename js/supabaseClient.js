/**
 * Cliente Supabase (CDN ESM — sin bundler).
 * Compatible con GitHub Pages / Vercel estático.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT')) {
  console.warn(
    '[FinanzasPR] Falta config. Copia .env.example → .env, rellena las claves y ejecuta: node scripts/generate-config.js'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
