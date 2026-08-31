/**
 * CRUD de transacciones.
 * Consejo: registrar en el momento evita “olvidos” que distorsionan tu presupuesto.
 */
import { supabase } from './supabaseClient.js';

export function startOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  return d.toISOString().slice(0, 10);
}

export function endOfMonth(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
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
