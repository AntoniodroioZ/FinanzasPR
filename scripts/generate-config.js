#!/usr/bin/env node
/**
 * Genera js/config.js desde variables de entorno o archivo .env local.
 *
 * Uso:
 *   node scripts/generate-config.js
 *
 * Prioridad: process.env → .env en la raíz del proyecto
 * CI/Vercel: define SUPABASE_URL y SUPABASE_ANON_KEY como secrets.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadDotEnv(envPath);

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    'Faltan SUPABASE_URL y SUPABASE_ANON_KEY.\n' +
      '  Local:  cp .env.example .env  &&  edita .env  &&  node scripts/generate-config.js\n' +
      '  CI:      define esos secrets en el entorno de build'
  );
  process.exit(1);
}

if (url.includes('YOUR_PROJECT') || key.includes('YOUR_SUPABASE')) {
  console.error('Reemplaza los placeholders en .env con valores reales de Supabase.');
  process.exit(1);
}

const out = path.join(root, 'js', 'config.js');
const contents = `/**
 * AUTO-GENERADO — no edites a mano ni subas este archivo.
 * Fuente: .env o variables de entorno (CI/Vercel).
 * Regenerar: node scripts/generate-config.js
 */
export const SUPABASE_URL = ${JSON.stringify(url)};
export const SUPABASE_ANON_KEY = ${JSON.stringify(key)};
`;

fs.writeFileSync(out, contents, 'utf8');
console.log('Wrote', out);
