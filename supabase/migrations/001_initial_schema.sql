-- FinanzasPR — Schema inicial + RLS
-- Ejecutar en Supabase SQL Editor (Dashboard → SQL → New query)
-- Consejo financiero: un esquema claro es como un presupuesto — reduce fricción y errores.

-- ---------------------------------------------------------------------------
-- Extensiones
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- groups: espacio compartido de pareja
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- profiles: 1:1 con auth.users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  group_id UUID REFERENCES public.groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_group_id ON public.profiles(group_id);

-- ---------------------------------------------------------------------------
-- categories: tipadas ingreso/gasto; bucket 50/30/20 en metadata
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT '📌',
  type TEXT NOT NULL CHECK (type IN ('ingreso', 'gasto')),
  -- necesity | desire | savings | income — para análisis 50/30/20
  budget_bucket TEXT CHECK (
    budget_bucket IS NULL
    OR budget_bucket IN ('necesidad', 'deseo', 'ahorro', 'ingreso')
  ),
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_group_id ON public.categories(group_id);

-- ---------------------------------------------------------------------------
-- transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL DEFAULT '',
  category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  is_shared BOOLEAN NOT NULL DEFAULT false,
  paid_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Parte que corresponde a cada persona (0.5 = 50/50). El pagador adelanta el resto.
  split_ratio NUMERIC(4, 3) NOT NULL DEFAULT 0.5
    CHECK (split_ratio > 0 AND split_ratio <= 1),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_transactions_group_id ON public.transactions(group_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON public.transactions(date);

-- ---------------------------------------------------------------------------
-- Helpers RLS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_group_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT group_id FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_group_member(p_group_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND group_id = p_group_id
  );
$$;

-- ---------------------------------------------------------------------------
-- Seed categorías 50/30/20 al crear un grupo
-- Consejo: Necesidades ≤50%, Deseos ≤30%, Ahorro/Inversión ≥20% de ingresos.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_default_categories(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.categories (name, icon, type, budget_bucket, group_id) VALUES
    -- Necesidades (50%)
    ('Vivienda', '🏠', 'gasto', 'necesidad', p_group_id),
    ('Alimentación', '🛒', 'gasto', 'necesidad', p_group_id),
    ('Transporte', '🚗', 'gasto', 'necesidad', p_group_id),
    ('Servicios', '💡', 'gasto', 'necesidad', p_group_id),
    ('Salud', '💊', 'gasto', 'necesidad', p_group_id),
    -- Deseos (30%)
    ('Entretenimiento', '🎬', 'gasto', 'deseo', p_group_id),
    ('Restaurantes', '🍽️', 'gasto', 'deseo', p_group_id),
    ('Compras', '🛍️', 'gasto', 'deseo', p_group_id),
    ('Suscripciones', '📱', 'gasto', 'deseo', p_group_id),
    -- Ahorro / Inversión (20%)
    ('Ahorro', '🏦', 'gasto', 'ahorro', p_group_id),
    ('Inversión', '📈', 'gasto', 'ahorro', p_group_id),
    ('Fondo de emergencia', '🛟', 'gasto', 'ahorro', p_group_id),
    -- Ingresos
    ('Salario', '💼', 'ingreso', 'ingreso', p_group_id),
    ('Freelance', '💻', 'ingreso', 'ingreso', p_group_id),
    ('Otros ingresos', '✨', 'ingreso', 'ingreso', p_group_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: crear profile al registrarse
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC: crear grupo + asignar profile + seed categorías
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_shared_space(p_name TEXT)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group public.groups;
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Ya perteneces a un espacio compartido';
  END IF;

  INSERT INTO public.groups (name, created_by)
  VALUES (COALESCE(NULLIF(trim(p_name), ''), 'Nuestro hogar'), v_uid)
  RETURNING * INTO v_group;

  UPDATE public.profiles
  SET group_id = v_group.id
  WHERE id = v_uid;

  PERFORM public.seed_default_categories(v_group.id);

  RETURN v_group;
END;
$$;

-- ---------------------------------------------------------------------------
-- RPC: unirse con invite_code (máx. 2 miembros)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_shared_space(p_invite_code UUID)
RETURNS public.groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group public.groups;
  v_uid UUID := auth.uid();
  v_count INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid AND group_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Ya perteneces a un espacio compartido';
  END IF;

  SELECT * INTO v_group
  FROM public.groups
  WHERE invite_code = p_invite_code;

  IF v_group.id IS NULL THEN
    RAISE EXCEPTION 'Código de invitación inválido';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.profiles
  WHERE group_id = v_group.id;

  IF v_count >= 2 THEN
    RAISE EXCEPTION 'Este espacio ya tiene dos miembros (máximo para pareja)';
  END IF;

  UPDATE public.profiles
  SET group_id = v_group.id
  WHERE id = v_uid;

  RETURN v_group;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_shared_space(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_shared_space(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_group_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_group_member(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- profiles
DROP POLICY IF EXISTS "profiles_select_own_or_partner" ON public.profiles;
CREATE POLICY "profiles_select_own_or_partner" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      group_id IS NOT NULL
      AND group_id = public.get_my_group_id()
    )
  );

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- groups: miembros leen; búsqueda por invite_code vía RPC (SECURITY DEFINER)
DROP POLICY IF EXISTS "groups_select_member" ON public.groups;
CREATE POLICY "groups_select_member" ON public.groups
  FOR SELECT TO authenticated
  USING (public.is_group_member(id) OR created_by = auth.uid());

DROP POLICY IF EXISTS "groups_insert_auth" ON public.groups;
CREATE POLICY "groups_insert_auth" ON public.groups
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "groups_update_creator" ON public.groups;
CREATE POLICY "groups_update_creator" ON public.groups
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- categories
DROP POLICY IF EXISTS "categories_select_member" ON public.categories;
CREATE POLICY "categories_select_member" ON public.categories
  FOR SELECT TO authenticated
  USING (public.is_group_member(group_id));

DROP POLICY IF EXISTS "categories_insert_member" ON public.categories;
CREATE POLICY "categories_insert_member" ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (public.is_group_member(group_id));

DROP POLICY IF EXISTS "categories_update_member" ON public.categories;
CREATE POLICY "categories_update_member" ON public.categories
  FOR UPDATE TO authenticated
  USING (public.is_group_member(group_id))
  WITH CHECK (public.is_group_member(group_id));

DROP POLICY IF EXISTS "categories_delete_member" ON public.categories;
CREATE POLICY "categories_delete_member" ON public.categories
  FOR DELETE TO authenticated
  USING (public.is_group_member(group_id));

-- transactions
-- SELECT: propias O compartidas del mismo grupo
DROP POLICY IF EXISTS "transactions_select" ON public.transactions;
CREATE POLICY "transactions_select" ON public.transactions
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      is_shared = true
      AND public.is_group_member(group_id)
    )
  );

DROP POLICY IF EXISTS "transactions_insert" ON public.transactions;
CREATE POLICY "transactions_insert" ON public.transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.is_group_member(group_id)
  );

DROP POLICY IF EXISTS "transactions_update" ON public.transactions;
CREATE POLICY "transactions_update" ON public.transactions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "transactions_delete" ON public.transactions;
CREATE POLICY "transactions_delete" ON public.transactions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
