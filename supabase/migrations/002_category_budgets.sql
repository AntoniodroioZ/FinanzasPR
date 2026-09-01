-- v1.2: presupuestos mensuales por categoría de gasto
-- ---------------------------------------------------------------------------

CREATE TABLE public.category_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, category_id, month)
);

CREATE INDEX idx_category_budgets_group_month
  ON public.category_budgets(group_id, month);

ALTER TABLE public.category_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "category_budgets_select_member" ON public.category_budgets;
CREATE POLICY "category_budgets_select_member" ON public.category_budgets
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "category_budgets_insert_member" ON public.category_budgets;
CREATE POLICY "category_budgets_insert_member" ON public.category_budgets
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_group_member(group_id)
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "category_budgets_update_member" ON public.category_budgets;
CREATE POLICY "category_budgets_update_member" ON public.category_budgets
  FOR UPDATE TO authenticated
  USING (public.is_group_member(group_id))
  WITH CHECK (public.is_group_member(group_id));

DROP POLICY IF EXISTS "category_budgets_delete_member" ON public.category_budgets;
CREATE POLICY "category_budgets_delete_member" ON public.category_budgets
  FOR DELETE TO authenticated
  USING (public.is_group_member(group_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.category_budgets TO authenticated;
