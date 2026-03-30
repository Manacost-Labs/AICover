-- Run once in Supabase → SQL Editor (New query → Run).
-- Fixes: "new row violates row-level security policy" for this app (browser uses anon key, no login).
-- For a personal/single-user app only. For multi-tenant apps, replace with proper per-user policies.

-- ─── Table: reference_library (composition references, storage under references/) ──

CREATE TABLE IF NOT EXISTS public.reference_library (
  id text PRIMARY KEY,
  name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text NOT NULL,
  added_at bigint NOT NULL,
  vision_analysis text
);

ALTER TABLE public.reference_library ENABLE ROW LEVEL SECURITY;

-- Existing projects: add column if table was created without vision_analysis
ALTER TABLE public.reference_library
  ADD COLUMN IF NOT EXISTS vision_analysis text;

-- Favorites: AI explanation why this variant was chosen vs batch siblings
ALTER TABLE public.favorites
  ADD COLUMN IF NOT EXISTS choice_analysis text;

DROP POLICY IF EXISTS "anon_all_reference_library" ON public.reference_library;
CREATE POLICY "anon_all_reference_library"
  ON public.reference_library
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- ─── Tables: card_library, history, favorites ───────────────────────────────

ALTER TABLE public.card_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all_card_library" ON public.card_library;
CREATE POLICY "anon_all_card_library"
  ON public.card_library
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_history" ON public.history;
CREATE POLICY "anon_all_history"
  ON public.history
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "anon_all_favorites" ON public.favorites;
CREATE POLICY "anon_all_favorites"
  ON public.favorites
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

-- ─── Storage bucket `images` (uploads / public URLs) ─────────────────────────
-- If uploads fail with RLS or permission errors, run this block too.

DROP POLICY IF EXISTS "anon_select_images" ON storage.objects;
DROP POLICY IF EXISTS "anon_insert_images" ON storage.objects;
DROP POLICY IF EXISTS "anon_update_images" ON storage.objects;
DROP POLICY IF EXISTS "anon_delete_images" ON storage.objects;

CREATE POLICY "anon_select_images"
  ON storage.objects FOR SELECT TO anon
  USING (bucket_id = 'images');

CREATE POLICY "anon_insert_images"
  ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'images');

CREATE POLICY "anon_update_images"
  ON storage.objects FOR UPDATE TO anon
  USING (bucket_id = 'images')
  WITH CHECK (bucket_id = 'images');

CREATE POLICY "anon_delete_images"
  ON storage.objects FOR DELETE TO anon
  USING (bucket_id = 'images');
