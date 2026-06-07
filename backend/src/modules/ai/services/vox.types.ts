/**
 * Типы Vox/GigaAM — наш self-hosted ASR на `vox.agent-lia.ru`.
 *
 * Контракт: submit (multipart) → возвращает `{ taskId }` →
 * GET /transcription/task/:taskId до COMPLETED|FAILED.
 *
 * Спецификация:
 *   - модель `v3_rnnt`
 *   - punctuationMode `pro` (auto-пунктуация)
 *   - diarizationEnabled — у нас всегда `false`, спикеры по participant_id
 *
 * Источник: `docs/reference/llm-models-playbook.md` §1.
 */

export type VoxLanguage = 'ru' | 'en';
export type VoxPunctuationMode = 'pro' | 'standard' | 'off';

export interface VoxSubmitOptions {
  language?: VoxLanguage;
  punctuationMode?: VoxPunctuationMode;
  diarizationEnabled?: boolean;
}

export interface VoxPollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

/**
 * Word-timestamp в результате Vox. `startMs/endMs` — миллисекунды от начала
 * звукового потока, который мы отправили в submit.
 *
 * При отсутствии `words` (Vox не вернул пословные тайминги, что бывает для
 * коротких/части встреч) downstream `merge.worker` строит один псевдо-turn на
 * дорожку длиной `durationSeconds`; поведенческие метрики такого расчёта
 * помечаются `lowConfidence` (приблизительность).
 */
export interface VoxWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface VoxResult {
  status: 'COMPLETED' | 'FAILED';
  /** Полный текст. Может быть пустой строкой, если речь не распознана. */
  transcriptText: string;
  /** Длительность аудио в секундах. */
  durationSeconds: number;
  /**
   * Word-timestamps. Vox v3_rnnt отдаёт массив. Может отсутствовать — тогда
   * merge.worker использует `durationSeconds` для псевдо-turn, а поведенческие
   * метрики помечаются `lowConfidence` (см. `VoxWord`).
   */
  words?: VoxWord[];
  errorMessage?: string;
}

/**
 * Доменная ошибка Vox. Кидаем на сетевые сбои/таймауты/FAILED-статус.
 * Воркер ловит и логирует в `AiUsageLog` с `success: false`.
 */
export class VoxError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'VoxError';
  }
}
