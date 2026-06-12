-- ТЗ 2026-06-11-asr-segment-timings-persist-and-merge, Фаза 1.
-- Посегментные тайминги речи дорожки из Vox `extendedResult.segments`.
-- Slim-форма Array<{ startSec: number; endSec: number; text: string }>
-- (секунды, float) — спикер известен по `TranscriptTrack.speakerName`,
-- поэтому speaker/speaker_id не храним (Б2).
-- NULL для дорожек, расшифрованных до появления колонки — backfill не делаем (Б6).
-- `IF NOT EXISTS` делает повторный прогон no-op (idempotent guard, R8).
ALTER TABLE "TranscriptTrack" ADD COLUMN IF NOT EXISTS "segments" JSONB;
