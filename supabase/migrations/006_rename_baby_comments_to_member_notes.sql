-- Generalize the baby-only comment thread into member notes for EVERY member.
-- Notes started during the baby trial now carry forward after promotion and remain
-- editable for the lifetime of the member (only the author person can edit/delete).
-- This is a pure rename — all existing rows are preserved.
--
-- Run manually against Supabase (migrations are not auto-applied).
ALTER TABLE IF EXISTS baby_comments RENAME TO member_notes;
ALTER INDEX IF EXISTS idx_baby_comments_person_id RENAME TO idx_member_notes_person_id;
