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
  /**
   * Режим диаризации (ТЗ-5 Ф3). Multipart-поле `speakerMode`. Пробрасывается
   * только когда задан — иначе Vox использует дефолт. Используется upload-путём
   * (диаризация одного смешанного аудио), per-track путь его не задаёт.
   */
  speakerMode?: string;
  /**
   * Точное число спикеров (если известно — `Meeting.uploadNumSpeakersHint`).
   * Multipart-поле `numSpeakers`. Пробрасывается только когда задан.
   */
  numSpeakers?: number;
  /** Верхняя граница числа спикеров. Multipart-поле `maxSpeakers`. */
  maxSpeakers?: number;
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

/**
 * Сегмент диаризации (ТЗ-5 Ф3). Vox с `diarizationEnabled:true` отдаёт
 * `extendedResult.segments[]` — по одному сегменту на непрерывную реплику
 * одного говорящего.
 *
 * Контракт (Ф0 smoke, проверено): `start`/`end` — СЕКУНДЫ (float),
 * используются как `DialogTurn.startSec/endSec` напрямую (без конвертации).
 * `speaker` = `"SPEAKER 1"` (пробел, 1-indexed); `speakerId` = int (1,2,…).
 */
export interface VoxDiarizedSegment {
  /** Секунды от начала аудио (float). → DialogTurn.startSec. */
  startSec: number;
  /** Секунды от начала аудио (float). → DialogTurn.endSec. */
  endSec: number;
  /** Метка говорящего как отдала Vox: `"SPEAKER 1"`. */
  speaker: string;
  /** Числовой id говорящего (1-indexed). */
  speakerId: number;
  /** Текст реплики. */
  text: string;
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
  /**
   * Сегменты диаризации (ТЗ-5 Ф3). Заполняется ТОЛЬКО когда Vox вернул
   * `extendedResult.segments[]` (режим `diarizationEnabled:true`). Per-track
   * путь (живой конвейер) их не использует — поле аддитивное.
   */
  segments?: VoxDiarizedSegment[];
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
