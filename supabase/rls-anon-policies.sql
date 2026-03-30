-- Run once in Supabase → SQL Editor (New query → Run).
-- Fixes: "new row violates row-level security policy" for this app (browser uses anon key, no login).
-- For a personal/single-user app only. For multi-tenant apps, replace with proper per-user policies.

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
