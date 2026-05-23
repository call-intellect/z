import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { VoxService } from '../../ai/services/vox.service';

import { TtsError, type TtsService } from './tts.service';
import {
  VoiceAdapterError,
  VoiceChannelAdapter,
} from './voice-channel-adapter.service';

function makeMetricsStub(): {
  metrics: BusinessMetricsService;
  spies: {
    incVoiceAsrRequest: ReturnType<typeof vi.fn>;
    observeVoiceAsrDuration: ReturnType<typeof vi.fn>;
    incVoiceTtsRequest: ReturnType<typeof vi.fn>;
    addVoiceTtsChars: ReturnType<typeof vi.fn>;
  };
} {
  const spies = {
    incVoiceAsrRequest: vi.fn(),
    observeVoiceAsrDuration: vi.fn(),
    incVoiceTtsRequest: vi.fn(),
    addVoiceTtsChars: vi.fn(),
  };
  return {
    metrics: spies as unknown as BusinessMetricsService,
    spies,
  };
}

describe('VoiceChannelAdapter.transcribe', () => {
  it('успешный transcribe — возвращает text + provider=vox, инкрементит метрики', async () => {
    const voxStub = {
      submit: vi.fn(async () => ({ taskId: 'task-123' })),
      poll: vi.fn(async () => ({
        status: 'COMPLETED' as const,
        transcriptText: '  привет мир  ',
        durationSeconds: 4.2,
      })),
    } as unknown as VoxService;
    const ttsStub = {} as TtsService;
    const { metrics, spies } = makeMetricsStub();

    const adapter = new VoiceChannelAdapter(voxStub, ttsStub, metrics);

    const result = await adapter.transcribe({
      audio: Buffer.from('fake-audio'),
      tenantId: 'tenant-abc',
      mimeType: 'audio/ogg',
    });

    expect(result.text).toBe('привет мир');
    expect(result.durationSeconds).toBe(4.2);
    expect(result.provider).toBe('vox');
    expect(spies.incVoiceAsrRequest).toHaveBeenCalledWith({
      tenantTop: expect.any(String) as unknown as string,
      provider: 'vox',
    });
    expect(spies.observeVoiceAsrDuration).toHaveBeenCalledTimes(1);
  });

  it('пустой audio падает в VoiceAdapterError(audio_empty)', async () => {
    const voxStub = {} as unknown as VoxService;
    const ttsStub = {} as TtsService;
    const { metrics } = makeMetricsStub();

    const adapter = new VoiceChannelAdapter(voxStub, ttsStub, metrics);

    await expect(
      adapter.transcribe({
        audio: Buffer.alloc(0),
        tenantId: 't',
      }),
    ).rejects.toBeInstanceOf(VoiceAdapterError);
  });

  it('upstream ошибка Vox оборачивается в VoiceAdapterError(asr_failed) + duration observed', async () => {
    const voxStub = {
      submit: vi.fn(async () => {
        throw new Error('vox down');
      }),
      poll: vi.fn(),
    } as unknown as VoxService;
    const ttsStub = {} as TtsService;
    const { metrics, spies } = makeMetricsStub();

    const adapter = new VoiceChannelAdapter(voxStub, ttsStub, metrics);

    await expect(
      adapter.transcribe({ audio: Buffer.from('x'), tenantId: 't' }),
    ).rejects.toMatchObject({
      name: 'VoiceAdapterError',
      code: 'asr_failed',
    });
    expect(spies.observeVoiceAsrDuration).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceChannelAdapter.synthesize', () => {
  it('успешный synthesize — пробрасывает result и инкрементит метрики', async () => {
    const voxStub = {} as unknown as VoxService;
    const audio = Buffer.from([0xff, 0xfb]);
    const ttsStub = {
      synthesize: vi.fn(async () => ({
        audio,
        provider: 'openai' as const,
        voice: 'alloy',
        bytes: audio.byteLength,
        chars: 5,
      })),
    } as unknown as TtsService;
    const { metrics, spies } = makeMetricsStub();

    const adapter = new VoiceChannelAdapter(voxStub, ttsStub, metrics);

    const result = await adapter.synthesize({
      tenantId: 'org-1',
      input: { text: 'hello' },
    });

    expect(result.provider).toBe('openai');
    expect(result.bytes).toBe(audio.byteLength);
    expect(spies.incVoiceTtsRequest).toHaveBeenCalledWith({
      tenantTop: expect.any(String) as unknown as string,
      provider: 'openai',
    });
    expect(spies.addVoiceTtsChars).toHaveBeenCalledWith({
      tenantTop: expect.any(String) as unknown as string,
      chars: 5,
    });
  });

  it('TtsError(text_too_long) маппится в VoiceAdapterError code=text_too_long', async () => {
    const voxStub = {} as unknown as VoxService;
    const ttsStub = {
      synthesize: vi.fn(async () => {
        throw new TtsError('text_too_long:1000');
      }),
    } as unknown as TtsService;
    const { metrics } = makeMetricsStub();

    const adapter = new VoiceChannelAdapter(voxStub, ttsStub, metrics);

    await expect(
      adapter.synthesize({ tenantId: 't', input: { text: 'x' } }),
    ).rejects.toMatchObject({
      name: 'VoiceAdapterError',
      code: 'text_too_long',
    });
  });

  it('upstream TTS ошибка → VoiceAdapterError code=tts_failed', async () => {
    const voxStub = {} as unknown as VoxService;
    const ttsStub = {
      synthesize: vi.fn(async () => {
        throw new TtsError('openai_http_429:rate limited');
      }),
    } as unknown as TtsService;
    const { metrics } = makeMetricsStub();

    const adapter = new VoiceChannelAdapter(voxStub, ttsStub, metrics);

    await expect(
      adapter.synthesize({ tenantId: 't', input: { text: 'x' } }),
    ).rejects.toMatchObject({
      name: 'VoiceAdapterError',
      code: 'tts_failed',
    });
  });
});
