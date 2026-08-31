/**
 * Espacios compartidos (pareja): crear / unirse.
 * Máximo 2 miembros — validado en RPC SQL.
 */
import { supabase } from './supabaseClient.js';

export async function createSharedSpace(name) {
  const { data, error } = await supabase.rpc('create_shared_space', {
    p_name: name || 'Nuestro hogar',
  });
  if (error) throw error;
  return data;
}

export async function joinSharedSpace(inviteCode) {
  const code = String(inviteCode || '').trim();
  if (!code) throw new Error('Ingresa un código de invitación');

  const { data, error } = await supabase.rpc('join_shared_space', {
    p_invite_code: code,
  });
  if (error) throw error;
  return data;
}

export async function fetchMyGroup(groupId) {
  if (!groupId) return null;
  const { data, error } = await supabase
    .from('groups')
    .select('*')
    .eq('id', groupId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchGroupMembers(groupId) {
  if (!groupId) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}
