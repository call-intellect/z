import type { MeetingStatus } from '@prisma/client';

import { InvalidFsmTransitionError } from '../../../common/errors/domain-errors';

/**
 * Допустимые переходы FSM встречи.
 * Источник истины: `plans/architecture/2026-05-08-z-architecture.md` §4.3 и
 * `plans/tz/2026-05-08-mvp-fullstack-tz.md` §2.2.
 *
 * Принцип: НИКАКИХ сырых апдейтов `status` в БД. Только через
 * `assertTransition(from, to)` (бросит `InvalidFsmTransitionError` на запрет).
 *
 * Терминальные состояния — `ai_ready` и `failed`. Из `failed` есть отдельный
 * путь `retryFromFailed()` (Фаза 5+), который не пересекается с этой таблицей.
 *
 * Фаза 11 (развязка записи от AI-статуса): `ai_failed` — терминальный сбой ТОЛЬКО
 * AI-ветки (transcribe/merge/analyze) после исчерпания ретраев. Запись встречи при
 * этом остаётся смотрибельной (см. `MeetingStatus.ai_failed`). Сюда приходит сбой
 * AI-ветки из любого состояния, где она реально работает: запись уже готова
 * (`recording_ready`), идёт транскрибация/merge (`transcription_processing`),
 * транскрипт готов (`transcription_ready`) или идёт/готов AI-анализ
 * (`ai_processing`/`ai_ready`). «Нет аудио вообще» по-прежнему уводит в `failed`
 * (показывать нечего).
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<MeetingStatus, readonly MeetingStatus[]>> = {
  scheduled: ['active', 'failed'],
  active: ['completed', 'failed'],
  completed: ['recording_processing', 'transcription_processing', 'failed'],
  recording_processing: ['recording_ready', 'failed'],
  recording_ready: ['transcription_processing', 'failed', 'ai_failed'],
  transcription_processing: ['transcription_ready', 'failed', 'ai_failed'],
  transcription_ready: ['ai_processing', 'failed', 'ai_failed'],
  ai_processing: ['ai_ready', 'failed', 'ai_failed'],
  ai_ready: ['ai_failed'],
  failed: [],
  ai_failed: [],
};

export function assertTransition(from: MeetingStatus, to: MeetingStatus): void {
  const allowed = ALLOWED_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidFsmTransitionError(from, to);
  }
}

export function isTransitionAllowed(from: MeetingStatus, to: MeetingStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
