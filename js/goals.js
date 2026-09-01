/**
 * Metas de ahorro (v1.3): CRUD y progreso.
 */
import { supabase } from './supabaseClient.js';

export async function fetchGoals(userId) {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*, categories(id, name, icon)')
    .eq('user_id', userId)
    .eq('is_completed', false)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchAllGoals(userId) {
  const { data, error } = await supabase
    .from('savings_goals')
    .select('*, categories(id, name, icon)')
    .eq('user_id', userId)
    .order('is_completed', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function createGoal(payload) {
  const { data, error } = await supabase
    .from('savings_goals')
    .insert(payload)
    .select('*, categories(id, name, icon)')
    .single();
  if (error) throw error;
  return data;
}

export async function updateGoal(id, payload) {
  const { data, error } = await supabase
    .from('savings_goals')
    .update(payload)
    .eq('id', id)
    .select('*, categories(id, name, icon)')
    .single();
  if (error) throw error;
  return data;
}

export async function completeGoal(id) {
  return updateGoal(id, { is_completed: true });
}

export async function deleteGoal(id) {
  const { error } = await supabase.from('savings_goals').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Progreso: categoría vinculada → suma histórica del usuario; si no → current_amount manual.
 * @param {object} goal
 * @param {Array} allTransactions — histórico (sin filtro de mes)
 * @param {string} userId
 */
export function computeGoalProgress(goal, allTransactions, userId) {
  const target = Number(goal.target_amount) || 0;
  let current = Number(goal.current_amount) || 0;

  if (goal.category_id && allTransactions?.length) {
    current = allTransactions
      .filter(
        (tx) =>
          tx.user_id === userId
          && tx.category_id === goal.category_id
          && tx.categories?.type === 'gasto'
      )
      .reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
  }

  const pct = target > 0 ? Math.min(current / target, 1) : 0;
  const isComplete = current >= target;

  return {
    current,
    target,
    pct,
    pctLabel: `${Math.round(pct * 100)}%`,
    isComplete,
  };
}

/**
 * @param {Array} goals
 * @param {Array} allTransactions
 * @param {string} userId
 */
export function enrichGoalsWithProgress(goals, allTransactions, userId) {
  return goals.map((goal) => ({
    ...goal,
    progress: computeGoalProgress(goal, allTransactions, userId),
  }));
}
