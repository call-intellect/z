import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { SystemLogCategory } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { LogService } from '../../logging/log.service';

import {
  type VoxPollOptions,
  type VoxResult,
  VoxError,
  type VoxSubmitOptions,
} from './vox.types';

/** Превью текста для DB-логов — обрезаем, чтобы не раздувать payload. */
function textPreview(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}…[+${text.length - max}]` : text;
}

const NETWORK_RETRY_DELAYS_MS = [3000, 8000, 15000];
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_MAX_ATTEMPTS = 60;

/**
 * Клиент Vox/GigaAM.
 *
 * Контракт:
 *   - `submit(audio, opts)` → multipart POST → `{ taskId }`.
 *   - `poll(taskId, opts)` → каждые `intervalMs` GET; до `maxAttempts`
 *      попыток. По умолчанию 60 × 2с = 2 минуты.
 *
 * Сетевые ошибки в `submit` ретраятся внутри метода: 3 попытки с задержкой
 * `[3000, 8000, 15000]` ms. На устойчивую ошибку — `VoxError`.
 */
@Injectable()
export class VoxService {
  private readonly logger = new Logger(VoxService.name);

  constructor(
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    // DB-логи (система логов в БД). Optional — чтобы unit-тесты могли строить
    // VoxService без LoggingModule (`new VoxService(cfg)`). В рантайме всегда
    // резолвится (LoggingModule @Global). Логи наследуют traceId/pipeline из
    // ALS-контекста воркера (ai.transcribe → pipeline TRANSCRIPTION).
    @Optional() @Inject(LogService) private readonly logs?: LogService,
  ) {}

  /** Best-effort запись в DB-лог под модулем `vox`. */
  private dbLog(
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
    action: string,
    message: string,
    details?: unknown,
    error?: unknown,
  ): void {
    this.logs?.write({
      level,
      category: SystemLogCategory.JOB,
      module: 'vox',
      action,
      message,
      ...(details !== undefined ? { details } : {}),
      ...(error !== undefined ? { error } : {}),
    });
  }

  // ─────────────────────────── submit ──────────────────────────────────────

  async submit(
    audio: Buffer,
    opts: VoxSubmitOptions = {},
  ): Promise<{ taskId: string }> {
    const url = `${this.cfg.ai.vox.apiUrl}/api/v1/transcription/submit`;
    const language = opts.language ?? (this.cfg.ai.vox.language as 'ru' | 'en');
    const punctuationMode = opts.punctuationMode ?? this.cfg.ai.vox.punctuationMode;
    const diarizationEnabled = opts.diarizationEnabled ?? false;
    const model = this.cfg.ai.vox.model;

    this.logger.debug(
      { audioSizeBytes: audio.byteLength, model, language, punctuationMode },
      'Vox submit: отправляем аудио',
    );
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= NETWORK_RETRY_DELAYS_MS.length; attempt++) {
      try {
        const form = new FormData();
        // FormData/Blob есть в Node 20+ глобально.
        // Файл подаём с MIME 'audio/ogg' — egress от LiveKit это `.ogg`.
        // @types/node 25: Buffer<ArrayBufferLike> не входит в BlobPart — оборачиваем в Uint8Array.
        const blob = new Blob([new Uint8Array(audio)], { type: 'audio/ogg' });
        form.append('file', blob, 'voice.ogg');
        form.append('model', model);
        form.append('punctuationMode', punctuationMode);
        form.append('diarizationEnabled', diarizationEnabled ? 'true' : 'false');
        // language не поддерживается текущей версией Vox API (400: property language should not exist)

        this.logger.debug({ attempt: attempt + 1, url }, 'Vox submit: POST запрос');
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.cfg.ai.vox.apiToken}`,
          },
          body: form,
        });

        if (!response.ok) {
          const text = await safeReadText(response);
          throw new VoxError(`Vox submit ${response.status}: ${text}`);
        }
        const json = (await response.json()) as { taskId?: string };
        if (!json.taskId) {
          throw new VoxError('Vox submit: пустой taskId в ответе');
        }
        this.logger.debug({ taskId: json.taskId }, 'Vox submit OK — задача принята');
        this.dbLog('INFO', 'vox.submit', `vox: задача принята (${json.taskId})`, {
          taskId: json.taskId,
          audioSizeBytes: audio.byteLength,
          model,
          language,
          punctuationMode,
          diarizationEnabled,
          attempt: attempt + 1,
        });
        return { taskId: json.taskId };
      } catch (err) {
        lastError = err;
        // Ретраим только сетевые/5xx ошибки. На отсутствие taskId — нет смысла.
        const delay = NETWORK_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        this.logger.warn(
          `Vox submit attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}; retry in ${delay} ms`,
        );
        this.dbLog(
          'WARN',
          'vox.submit.retry',
          `vox submit: попытка ${attempt + 1} не удалась, ретрай через ${delay}мс`,
          { attempt: attempt + 1, delayMs: delay },
          err,
        );
        await sleep(delay);
      }
    }
    this.dbLog('ERROR', 'vox.submit.failed', 'vox submit: устойчиво недоступен', undefined, lastError);
    throw new VoxError(
      `Vox submit устойчиво недоступен: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
      lastError,
    );
  }

  // ─────────────────────────── poll ────────────────────────────────────────

  async poll(taskId: string, opts: VoxPollOptions = {}): Promise<VoxResult> {
    const url = `${this.cfg.ai.vox.apiUrl}/api/v1/transcription/task/${encodeURIComponent(taskId)}`;
    const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const maxAttempts = opts.maxAttempts ?? DEFAULT_POLL_MAX_ATTEMPTS;

    for (let i = 0; i < maxAttempts; i++) {
      // Перед самым первым запросом ждём intervalMs — даём ASR время начать обработку.
      await sleep(intervalMs);

      let raw: unknown;
      try {
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${this.cfg.ai.vox.apiToken}` },
        });
        if (!response.ok) {
          // На 5xx — ретраим в рамках polling-цикла. На 4xx — сразу VoxError.
          if (response.status >= 500) {
            this.logger.warn(
              `Vox poll ${response.status}; retry в polling (i=${i})`,
            );
            continue;
          }
          const text = await safeReadText(response);
          throw new VoxError(`Vox poll ${response.status}: ${text}`);
        }
        raw = await response.json();
      } catch (err) {
        if (err instanceof VoxError) throw err;
        this.logger.warn(
          `Vox poll сеть-ошибка (i=${i}): ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }

      const result = parseVoxResult(raw);
      this.logger.debug({ taskId, attempt: i + 1, status: result.status }, 'Vox poll: ответ');
      // DEBUG-лог каждой попытки — виден в БД при minLevel=DEBUG (детальная отладка ASR).
      this.dbLog('DEBUG', 'vox.poll', `vox poll: попытка ${i + 1}, статус=${result.status}`, {
        taskId,
        attempt: i + 1,
        status: result.status,
      });
      if (result.status === 'COMPLETED') {
        const wordsCount = result.words?.length ?? 0;
        const textLength = result.transcriptText.length;
        this.logger.debug(
          { taskId, wordsCount, durationSeconds: result.durationSeconds },
          'Vox poll COMPLETED',
        );
        // Результат транскрипции в DB-логи (видно текст, слова, длительность).
        this.dbLog(
          'INFO',
          'vox.completed',
          `vox: транскрипция готова — ${wordsCount} слов, ${textLength} символов, ${result.durationSeconds}с`,
          {
            taskId,
            wordsCount,
            textLength,
            durationSeconds: result.durationSeconds,
            transcriptPreview: textPreview(result.transcriptText),
          },
        );
        // Guard: COMPLETED, но пусто. Диагностируем — тишина/битое аудио ИЛИ
        // mismatch ключей ответа Vox (логируем сырые ключи payload'а).
        if (wordsCount === 0 && textLength === 0) {
          this.dbLog(
            'WARN',
            'vox.empty',
            'vox: COMPLETED, но транскрипт ПУСТОЙ (нет слов и текста)',
            {
              taskId,
              durationSeconds: result.durationSeconds,
              rawKeys: raw && typeof raw === 'object' ? Object.keys(raw as object) : [],
              rawPreview: textPreview(JSON.stringify(raw ?? null), 1500),
            },
          );
        }
        // S5-02 (ТЗ 2026-06-06, research): текст есть, но пословных таймингов нет
        // → поведение/длительность нулевые. Логируем ТОЛЬКО форму ответа (ключи,
        // наличие segments), без текста транскрипта (PII), чтобы на следующей
        // реальной встрече установить, под каким ключом Vox отдаёт word-timing
        // (или подтвердить, что модель его не возвращает вовсе).
        if (wordsCount === 0 && textLength > 0) {
          const ro = (raw ?? {}) as Record<string, unknown>;
          const nestedRo = (ro.result ?? ro.data ?? {}) as Record<string, unknown>;
          const segs = ro.segments ?? nestedRo.segments;
          const firstSegmentKeys =
            Array.isArray(segs) && segs[0] && typeof segs[0] === 'object'
              ? Object.keys(segs[0] as object)
              : [];
          this.dbLog(
            'WARN',
            'vox.no_words',
            `vox: COMPLETED с текстом (${textLength} симв.), но БЕЗ пословных таймингов — поведение/длительность будут нулевыми`,
            {
              taskId,
              model: this.cfg.ai.vox.model,
              durationSeconds: result.durationSeconds,
              rawKeys: Object.keys(ro),
              nestedKeys: Object.keys(nestedRo),
              hasSegments: Array.isArray(segs),
              segmentsCount: Array.isArray(segs) ? segs.length : 0,
              firstSegmentKeys,
            },
          );
        }
        return {
          status: 'COMPLETED',
          transcriptText: result.transcriptText,
          durationSeconds: result.durationSeconds,
          ...(result.words ? { words: result.words } : {}),
        };
      }
      if (result.status === 'FAILED') {
        this.dbLog('ERROR', 'vox.failed', `vox: задача FAILED — ${result.errorMessage ?? '(без сообщения)'}`, {
          taskId,
          errorMessage: result.errorMessage ?? null,
        });
        throw new VoxError(
          `Vox FAILED: ${result.errorMessage ?? '(без сообщения)'}`,
        );
      }
      // Иначе — статус «в процессе» (PROCESSING/PENDING/...) — ждём дальше.
    }
    this.dbLog('ERROR', 'vox.timeout', `vox poll: таймаут (${maxAttempts}×${intervalMs}мс)`, {
      taskId,
      maxAttempts,
      intervalMs,
    });
    throw new VoxError(`Vox poll timeout: ${maxAttempts} попыток × ${intervalMs} ms`);
  }
}

// ─────────────────────────── helpers ───────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Парсит ответ Vox в `VoxResult`. Допускает разные формы поля `words`:
 *   - `words: [{ word, startMs, endMs }]`
 *   - `words: [{ text, start_ms, end_ms }]`
 *   - `segments: [{ words: [...] }]` — пословные тайминги внутри сегментов
 *     (Whisper/Google/Deepgram-стиль; top-level или в `result`/`data`).
 *   - отсутствие `words` — допустимо (тогда merge_worker оставит speech как один turn).
 */
function parseVoxResult(raw: unknown): {
  status: 'COMPLETED' | 'FAILED' | string;
  transcriptText: string;
  durationSeconds: number;
  words?: Array<{ word: string; startMs: number; endMs: number }>;
  errorMessage?: string;
} {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const status = typeof obj.status === 'string' ? obj.status.toUpperCase() : '';
  // Vox может отдавать текст под разными ключами / вложенно в `result`.
  // Покрываем известные варианты, иначе молча получаем пустой транскрипт.
  const nested = (obj.result ?? obj.data ?? {}) as Record<string, unknown>;
  const transcriptText =
    firstString(
      obj.transcriptText,
      obj.transcript_text,
      obj.text,
      obj.transcription,
      nested.transcriptText,
      nested.transcript_text,
      nested.text,
    ) ?? '';
  const durationRaw =
    obj.durationSeconds ?? obj.duration_seconds ?? nested.durationSeconds ?? nested.duration_seconds ?? 0;
  const durationSeconds =
    typeof durationRaw === 'number'
      ? durationRaw
      : typeof durationRaw === 'string'
        ? Number(durationRaw)
        : 0;
  const errorMessage =
    typeof obj.errorMessage === 'string'
      ? obj.errorMessage
      : typeof obj.error_message === 'string'
        ? obj.error_message
        : undefined;

  const mapWords = (
    arr: unknown[],
  ): Array<{ word: string; startMs: number; endMs: number }> =>
    arr
      .map((w): { word: string; startMs: number; endMs: number } | null => {
        if (!w || typeof w !== 'object') return null;
        const wo = w as Record<string, unknown>;
        const word =
          typeof wo.word === 'string'
            ? wo.word
            : typeof wo.text === 'string'
              ? wo.text
              : '';
        const startMs = numericMs(wo.startMs ?? wo.start_ms ?? wo.start);
        const endMs = numericMs(wo.endMs ?? wo.end_ms ?? wo.end);
        if (!word || startMs === null || endMs === null) return null;
        return { word, startMs, endMs };
      })
      .filter(
        (x): x is { word: string; startMs: number; endMs: number } => x !== null,
      );

  const flatWordsRaw =
    obj.words ?? obj.wordsTimestamps ?? nested.words ?? nested.wordsTimestamps;
  let words = Array.isArray(flatWordsRaw) ? mapWords(flatWordsRaw) : undefined;

  // S5-02 (ТЗ 2026-06-06): многие ASR кладут пословные тайминги в
  // segments[].words (Whisper/Google/Deepgram-стиль). Если плоских words нет —
  // собираем из сегментов (top-level или в result/data). Единицы те же (numericMs).
  if (!words || words.length === 0) {
    const segmentsRaw = (obj.segments ?? nested.segments ?? []) as unknown[];
    if (Array.isArray(segmentsRaw) && segmentsRaw.length > 0) {
      const segWords: unknown[] = [];
      for (const seg of segmentsRaw) {
        if (seg && typeof seg === 'object') {
          const sw = (seg as Record<string, unknown>).words;
          if (Array.isArray(sw)) segWords.push(...sw);
        }
      }
      const fromSegments = mapWords(segWords);
      if (fromSegments.length > 0) words = fromSegments;
    }
  }

  return {
    status,
    transcriptText,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    ...(words && words.length > 0 ? { words } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

/** Первое непустое строковое значение из переданных кандидатов. */
function firstString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function numericMs(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
