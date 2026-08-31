/**
 * CRUD de transacciones.
 * Consejo: registrar en el momento evita “olvidos” que distorsionan tu presupuesto.
 */
import { supabase } from './supabaseClient.js';

export function normalizeMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function startOfMonth(date = new Date()) {
  const d = normalizeMonth(date);
  return toLocalDateStr(d);
}

export function endOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return toLocalDateStr(d);
}

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** @param {Date} date @param {number} delta meses (+1 / -1) */
export function shiftMonth(date, delta) {
  const d = normalizeMonth(date);
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

export function isSameMonth(a, b) {
  const x = normalizeMonth(a);
  const y = normalizeMonth(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth();
}

export function isFutureMonth(date) {
  const d = normalizeMonth(date);
  const now = normalizeMonth(new Date());
  return d.getFullYear() > now.getFullYear()
    || (d.getFullYear() === now.getFullYear() && d.getMonth() > now.getMonth());
}

/** Valor para `<input type="month">` (YYYY-MM). */
export function monthToInputValue(date = new Date()) {
  const d = normalizeMonth(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Parsea YYYY-MM del picker. */
export function parseMonthInput(value) {
  const [y, m] = String(value).split('-').map(Number);
  if (!y || !m) return normalizeMonth(new Date());
  return new Date(y, m - 1, 1);
}

export async function fetchCategories(groupId) {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('group_id', groupId)
    .order('type')
    .order('name');
  if (error) throw error;
  return data || [];
}

/**
 * Lista transacciones visibles (RLS filtra personales ajenas).
 * Incluye categoría anidada.
 */
export async function fetchTransactions(groupId, { from, to } = {}) {
  let query = supabase
    .from('transactions')
    .select('*, categories(id, name, icon, type, budget_bucket)')
    .eq('group_id', groupId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });

  if (from) query = query.gte('date', from);
  if (to) query = query.lte('date', to);

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function createTransaction(payload) {
  const { data, error } = await supabase
    .from('transactions')
    .insert(payload)
    .select('*, categories(id, name, icon, type, budget_bucket)')
    .single();
  if (error) throw error;
  return data;
}

export async function updateTransaction(id, payload) {
  const { data, error } = await supabase
    .from('transactions')
    .update(payload)
    .eq('id', id)
    .select('*, categories(id, name, icon, type, budget_bucket)')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTransaction(id) {
  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) throw error;
}
