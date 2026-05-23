import { Inject, Injectable, Logger } from '@nestjs/common';

import { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import { VoxService } from '../../ai/services/vox.service';
import { tenantTopOf } from '../../dialog-layer/utils/tenant-top';

import {
  TtsService,
  TtsError,
  type TtsSynthesizeInput,
  type TtsSynthesizeResult,
} from './tts.service';

export class VoiceAdapterError extends Error {
  public readonly code: string;
  public readonly origCause?: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = 'VoiceAdapterError';
    this.code = code;
    if (cause !== undefined) {
      this.origCause = cause;
    }
  }
}

export interface VoiceTranscribeInput {
  /** Аудио-буфер (любой формат, который понимает Vox ASR: ogg / mp3 / wav / m4a / flac). */
  audio: Buffer;
  /** ID тенанта — для метрик и rate-limit учёта (обязателен). */
  tenantId: string;
  /** Опц. mimeType для логирования. */
  mimeType?: string;
}

export interface VoiceTranscribeResult {
  /** Распознанный текст. Может быть пустым (если в аудио только тишина). */
  text: string;
  /** Длительность аудио в секундах (если ASR сообщил). */
  durationSeconds: number;
  /** Имя ASR-провайдера, выполнившего распознавание (для метрик / биллинга). */
  provider: 'vox';
}

/**
 * `VoiceChannelAdapter` (SBA δ-3) — единая обёртка над ASR + TTS, переиспользуется:
 *   - REST endpoint'ами `/api/v1/voice/transcribe|synthesize`;
 *   - Telegram/MAX-адаптерами (β-1 zero-button voice inbound — пока используют
 *     VoxService напрямую, могут переключиться сюда);
 *   - будущим concierge voice WS handler'ом (γ-2, ждёт готовности модуля).
 *
 * НЕ адаптер канала в смысле `IChannel`. Это именно helper-сервис: содержит
 * только инкапсуляцию VoxService + TtsService + cardinality-safe метрики.
 *
 * Зависимости:
 *   - `VoxService` (из @Global AiModule) — ASR через Vox/GigaAM API.
 *   - `TtsService` (этот же модуль) — синтез OpenAI / Yandex.
 *   - `BusinessMetricsService` (@Global) — counter'ы и histogram.
 */
@Injectable()
export class VoiceChannelAdapter {
  private readonly logger = new Logger(VoiceChannelAdapter.name);

  constructor(
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(TtsService) private readonly tts: TtsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

  // ─────────────────────────── transcribe ────────────────────────────

  /**
   * Транскрибирует аудио через Vox (submit → poll).
   *
   * Метрики:
   *   - `voice_asr_requests_total{tenant_top, provider}` — каждый успешный
   *     или упавший вызов (provider всегда 'vox' на δ-3).
   *   - `voice_asr_duration_seconds{provider}` — observed время submit+poll.
   *
   * Ошибки:
   *   - upstream Vox ошибки → `VoiceAdapterError('asr_failed', ...)`.
   *   - пустой буфер → `VoiceAdapterError('audio_empty', ...)`.
   */
  async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult> {
    if (!input.audio || input.audio.byteLength === 0) {
      throw new VoiceAdapterError('Аудио пустое', 'audio_empty');
    }

    const tenantTop = tenantTopOf(input.tenantId);
    const provider = 'vox' as const;

    this.metrics.incVoiceAsrRequest({ tenantTop, provider });

    const startedAt = Date.now();
    try {
      const { taskId } = await this.vox.submit(input.audio);
      const result = await this.vox.poll(taskId);
      const seconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeVoiceAsrDuration({ provider, seconds });

      this.logger.debug(
        {
          tenantTop,
          mimeType: input.mimeType ?? null,
          audioBytes: input.audio.byteLength,
          textLen: result.transcriptText.length,
          asrDurationSeconds: result.durationSeconds,
        },
        'voice transcribe ok',
      );

      return {
        text: result.transcriptText.trim(),
        durationSeconds: result.durationSeconds,
        provider,
      };
    } catch (err) {
      const seconds = (Date.now() - startedAt) / 1000;
      this.metrics.observeVoiceAsrDuration({ provider, seconds });
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ tenantTop, err: message }, 'voice transcribe failed');
      throw new VoiceAdapterError(
        `ASR upstream failed: ${message}`,
        'asr_failed',
        err,
      );
    }
  }

  // ─────────────────────────── synthesize ────────────────────────────

  /**
   * Синтезирует речь из текста через TtsService.
   *
   * Метрики:
   *   - `voice_tts_requests_total{tenant_top, provider}` — каждый успешный
   *     или упавший вызов.
   *   - `voice_tts_chars_total{tenant_top}` — сумма chars (для cost-tracking).
   *
   * Ошибки:
   *   - text empty / too long → `VoiceAdapterError('text_invalid', ...)`.
   *   - upstream TTS → `VoiceAdapterError('tts_failed', ...)`.
   */
  async synthesize(args: {
    tenantId: string;
    input: TtsSynthesizeInput;
  }): Promise<TtsSynthesizeResult> {
    const tenantTop = tenantTopOf(args.tenantId);

    try {
      const result = await this.tts.synthesize(args.input);
      this.metrics.incVoiceTtsRequest({
        tenantTop,
        provider: result.provider,
      });
      this.metrics.addVoiceTtsChars({ tenantTop, chars: result.chars });
      this.logger.debug(
        {
          tenantTop,
          provider: result.provider,
          voice: result.voice,
          chars: result.chars,
          bytes: result.bytes,
        },
        'voice synthesize ok',
      );
      return result;
    } catch (err) {
      const code =
        err instanceof TtsError && err.message.startsWith('text_too_long')
          ? 'text_too_long'
          : err instanceof TtsError && err.message === 'text_empty'
            ? 'text_empty'
            : 'tts_failed';

      // Метрику incVoiceTtsRequest НЕ инкрементируем при text_invalid (это
      // validation на нашей стороне, не «вызов» провайдера). При upstream
      // ошибке тоже не инкрементируем — счётчик отражает успешный байтооборот.
      // Альтернатива (если нужны графики ошибок) — добавить label 'status'
      // в counter; на δ-3 этого не делаем (cardinality-safe принцип).
      this.logger.warn(
        {
          tenantTop,
          code,
          err: err instanceof Error ? err.message : String(err),
        },
        'voice synthesize failed',
      );
      throw new VoiceAdapterError(
        err instanceof Error ? err.message : String(err),
        code,
        err,
      );
    }
  }
}
