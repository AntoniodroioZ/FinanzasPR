/**
 * Historial de liquidaciones (v1.3).
 */
import { supabase } from './supabaseClient.js';
import { startOfMonth } from './transactions.js';

export async function fetchSettlementsForMonth(groupId, month) {
  const monthStr = startOfMonth(month);
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('group_id', groupId)
    .eq('month', monthStr)
    .order('paid_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchSettlementsHistory(groupId, limit = 24) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('group_id', groupId)
    .order('paid_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/**
 * @param {{ groupId: string, month: Date|string, fromUserId: string, toUserId: string, amount: number, userId: string, note?: string }}
 */
export async function recordSettlement({ groupId, month, fromUserId, toUserId, amount, userId, note = '' }) {
  const monthStr = startOfMonth(month);
  const { data, error } = await supabase
    .from('settlements')
    .insert({
      group_id: groupId,
      month: monthStr,
      from_user_id: fromUserId,
      to_user_id: toUserId,
      amount,
      note,
      recorded_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * ¿El mes ya tiene liquidación registrada que cubre la deuda?
 * @param {Array} settlements
 * @param {number} settlementAmount
 * @param {string} fromUserId
 * @param {string} toUserId
 */
export function isSettlementCovered(settlements, settlementAmount, fromUserId, toUserId) {
  if (settlementAmount < 0.01) return true;
  if (!settlements?.length) return false;

  const total = settlements
    .filter((s) => s.from_user_id === fromUserId && s.to_user_id === toUserId)
    .reduce((sum, s) => sum + (Number(s.amount) || 0), 0);

  return total >= settlementAmount - 0.01;
}
