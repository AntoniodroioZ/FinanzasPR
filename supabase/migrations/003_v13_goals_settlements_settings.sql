-- v1.3: metas de ahorro, liquidaciones, split flexible
-- ---------------------------------------------------------------------------

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS default_split_ratio NUMERIC(4, 3) NOT NULL DEFAULT 0.5
    CHECK (default_split_ratio > 0 AND default_split_ratio <= 1),
  ADD COLUMN IF NOT EXISTS split_mode TEXT NOT NULL DEFAULT 'fixed'
    CHECK (split_mode IN ('fixed', 'income_proportional'));

-- ---------------------------------------------------------------------------
-- savings_goals: metas personales por usuario
-- ---------------------------------------------------------------------------
CREATE TABLE public.savings_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  target_amount NUMERIC(12, 2) NOT NULL CHECK (target_amount > 0),
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  current_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
  deadline DATE,
  icon TEXT NOT NULL DEFAULT '🎯',
  is_completed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_savings_goals_user ON public.savings_goals(user_id);
CREATE INDEX idx_savings_goals_group ON public.savings_goals(group_id);

-- ---------------------------------------------------------------------------
-- settlements: historial de liquidaciones entre pareja
-- ---------------------------------------------------------------------------
CREATE TABLE public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  from_user_id UUID NOT NULL REFERENCES auth.users(id),
  to_user_id UUID NOT NULL REFERENCES auth.users(id),
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  paid_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  note TEXT NOT NULL DEFAULT '',
  recorded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_settlements_group_month ON public.settlements(group_id, month);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.savings_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "savings_goals_select_own" ON public.savings_goals;
CREATE POLICY "savings_goals_select_own" ON public.savings_goals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "savings_goals_insert_own" ON public.savings_goals;
CREATE POLICY "savings_goals_insert_own" ON public.savings_goals
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_group_member(group_id)
  );

DROP POLICY IF EXISTS "savings_goals_update_own" ON public.savings_goals;
CREATE POLICY "savings_goals_update_own" ON public.savings_goals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "savings_goals_delete_own" ON public.savings_goals;
CREATE POLICY "savings_goals_delete_own" ON public.savings_goals
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "settlements_select_member" ON public.settlements;
CREATE POLICY "settlements_select_member" ON public.settlements
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "settlements_insert_member" ON public.settlements;
CREATE POLICY "settlements_insert_member" ON public.settlements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_member(group_id)
    AND recorded_by = auth.uid()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.savings_goals TO authenticated;
GRANT SELECT, INSERT ON public.settlements TO authenticated;
GRANT UPDATE ON public.groups TO authenticated;

-- Miembros del grupo pueden actualizar configuración de split
DROP POLICY IF EXISTS "groups_update_member" ON public.groups;
CREATE POLICY "groups_update_member" ON public.groups
  FOR UPDATE TO authenticated
  USING (public.is_group_member(id))
  WITH CHECK (public.is_group_member(id));
