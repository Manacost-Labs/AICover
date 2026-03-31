-- Run in Supabase SQL Editor after main schema exists.
CREATE TABLE IF NOT EXISTS public.video_history (
  id text PRIMARY KEY,
  storage_path text NOT NULL,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS public.video_favorites (
  id text PRIMARY KEY,
  storage_path text NOT NULL,
  created_at bigint NOT NULL,
  choice_analysis text
);
ALTER TABLE public.video_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_favorites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all_video_history" ON public.video_history;
CREATE POLICY "anon_all_video_history" ON public.video_history FOR ALL TO anon USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_all_video_favorites" ON public.video_favorites;
CREATE POLICY "anon_all_video_favorites" ON public.video_favorites FOR ALL TO anon USING (true) WITH CHECK (true);
