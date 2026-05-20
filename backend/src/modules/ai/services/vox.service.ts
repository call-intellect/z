import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';

import {
  type VoxPollOptions,
  type VoxResult,
  VoxError,
  type VoxSubmitOptions,
} from './vox.types';

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

  constructor(@Inject(TypedConfigService) private readonly cfg: TypedConfigService) {}

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
        form.append('language', language);

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
        return { taskId: json.taskId };
      } catch (err) {
        lastError = err;
        // Ретраим только сетевые/5xx ошибки. На отсутствие taskId — нет смысла.
        const delay = NETWORK_RETRY_DELAYS_MS[attempt];
        if (delay === undefined) break;
        this.logger.warn(
          `Vox submit attempt ${attempt + 1} failed: ${err instanceof Error ? err.message : String(err)}; retry in ${delay} ms`,
        );
        await sleep(delay);
      }
    }
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
      if (result.status === 'COMPLETED') {
        return {
          status: 'COMPLETED',
          transcriptText: result.transcriptText,
          durationSeconds: result.durationSeconds,
          ...(result.words ? { words: result.words } : {}),
        };
      }
      if (result.status === 'FAILED') {
        throw new VoxError(
          `Vox FAILED: ${result.errorMessage ?? '(без сообщения)'}`,
        );
      }
      // Иначе — статус «в процессе» (PROCESSING/PENDING/...) — ждём дальше.
    }
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
  const transcriptText =
    typeof obj.transcriptText === 'string'
      ? obj.transcriptText
      : typeof obj.transcript_text === 'string'
        ? obj.transcript_text
        : '';
  const durationRaw = obj.durationSeconds ?? obj.duration_seconds ?? 0;
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

  const wordsRaw = (obj.words ?? obj.wordsTimestamps ?? []) as unknown[];
  const words = Array.isArray(wordsRaw)
    ? wordsRaw
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
        .filter((x): x is { word: string; startMs: number; endMs: number } => x !== null)
    : undefined;

  return {
    status,
    transcriptText,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : 0,
    ...(words && words.length > 0 ? { words } : {}),
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

function numericMs(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
