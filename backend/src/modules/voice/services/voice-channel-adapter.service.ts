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
  audio: Buffer;
  tenantId: string;
  mimeType?: string;
}

export interface VoiceTranscribeResult {
  text: string;
  durationSeconds: number;
  provider: 'vox';
}

@Injectable()
export class VoiceChannelAdapter {
  private readonly logger = new Logger(VoiceChannelAdapter.name);

  constructor(
    @Inject(VoxService) private readonly vox: VoxService,
    @Inject(TtsService) private readonly tts: TtsService,
    @Inject(BusinessMetricsService)
    private readonly metrics: BusinessMetricsService,
  ) {}

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
      throw new VoiceAdapterError(`ASR upstream failed: ${message}`, 'asr_failed', err);
    }
  }

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

      this.logger.warn(
        {
          tenantTop,
          code,
          err: err instanceof Error ? err.message : String(err),
        },
        'voice synthesize failed',
      );
      throw new VoiceAdapterError(err instanceof Error ? err.message : String(err), code, err);
    }
  }
}
