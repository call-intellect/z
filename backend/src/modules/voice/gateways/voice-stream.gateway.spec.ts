/**
 * Unit-тесты для VoiceStreamGateway (T4 / δ-3).
 *
 * Покрытие 5 сценариев из ТЗ:
 *   1. auth refuse без token / при невалидном JWT → disconnect.
 *   2. happy path: voice:start → voice:chunk x3 → voice:end → voice:transcribed.
 *   3. TTL guard: сессия без voice:end за 60с → voice:error{ttl_expired}.
 *   4. buffer overflow: суммарно > 5MB → voice:error{buffer_overflow}.
 *   5. cancel flow: voice:cancel чистит сессию + метрика 'cancelled'.
 *
 * Поскольку это unit-тест, мы НЕ поднимаем socket.io-сервер. Гейт вызываем
 * напрямую как класс с поддельным `client: Socket` (минимальный shape).
 */

import type { Server, Socket } from 'socket.io';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { JwtService } from '../../auth/services/jwt.service';
import {
  VoiceAdapterError,
  type VoiceChannelAdapter,
} from '../services/voice-channel-adapter.service';

import { VoiceStreamGateway } from './voice-stream.gateway';

interface FakeSocket {
  id: string;
  handshake: {
    auth: { token?: string; tenantId?: string };
    headers: { origin?: string; cookie?: string; authorization?: string };
    query: Record<string, string | undefined>;
  };
  emit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeSocket(overrides: Partial<FakeSocket> = {}): FakeSocket {
  return {
    id: overrides.id ?? 'sock-1',
    handshake: {
      auth: overrides.handshake?.auth ?? { token: 'valid-jwt', tenantId: 'tenant-1' },
      headers: overrides.handshake?.headers ?? { origin: 'http://localhost:3001' },
      query: overrides.handshake?.query ?? {},
    },
    emit: overrides.emit ?? vi.fn(),
    disconnect: overrides.disconnect ?? vi.fn(),
  };
}

function makeDeps(opts: {
  jwtThrows?: boolean;
  membershipFound?: boolean;
  sessionRevoked?: boolean;
  asrThrows?: Error | null;
  asrResult?: { text: string; durationSeconds: number; provider: 'vox' };
}) {
  const jwt = {
    verifySession: vi.fn(() => {
      if (opts.jwtThrows) throw new Error('jwt invalid');
      return { sub: 'user-1', email: 'u@z.io', jti: 'jti-1' };
    }),
  } as unknown as JwtService;

  const prisma = {
    userSession: {
      findUnique: vi.fn(async () => {
        if (opts.sessionRevoked) {
          return { jti: 'jti-1', revokedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) };
        }
        return { jti: 'jti-1', revokedAt: null, expiresAt: new Date(Date.now() + 1e6) };
      }),
    },
    membership: {
      findFirst: vi.fn(async () =>
        opts.membershipFound === false ? null : { id: 'm-1' },
      ),
      findMany: vi.fn(async () => []),
    },
  } as unknown as PrismaService;

  const cfg = {
    cors: { allowed: ['http://localhost:3001'] },
  } as unknown as TypedConfigService;

  const adapter = {
    transcribe: vi.fn(async () => {
      if (opts.asrThrows) throw opts.asrThrows;
      return (
        opts.asrResult ?? {
          text: 'привет',
          durationSeconds: 1.2,
          provider: 'vox' as const,
        }
      );
    }),
    synthesize: vi.fn(),
  } as unknown as VoiceChannelAdapter;

  const metricsSpies = {
    incVoiceWsSession: vi.fn(),
    incVoiceWsChunk: vi.fn(),
    observeVoiceWsAsrLatency: vi.fn(),
  };
  const metrics = metricsSpies as unknown as BusinessMetricsService;

  return { jwt, prisma, cfg, adapter, metrics, metricsSpies };
}

function makeGateway(d: ReturnType<typeof makeDeps>): VoiceStreamGateway {
  const gw = new VoiceStreamGateway(d.jwt, d.prisma, d.cfg, d.adapter, d.metrics);
  // Серверный мок — пустой, гейт сам делает null-check.
  (gw as unknown as { server: Server }).server = {
    sockets: { sockets: { get: () => undefined } },
  } as unknown as Server;
  return gw;
}

describe('VoiceStreamGateway — auth', () => {
  it('disconnect при отсутствии token', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket({
      handshake: {
        auth: {},
        headers: { origin: 'http://localhost:3001' },
        query: {},
      },
    });

    await gw.handleConnection(sock as unknown as Socket);
    expect(sock.disconnect).toHaveBeenCalledWith(true);
    expect(sock.emit).not.toHaveBeenCalledWith('connected', expect.anything());
  });

  it('disconnect при невалидном JWT', async () => {
    const deps = makeDeps({ jwtThrows: true });
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    expect(sock.disconnect).toHaveBeenCalledWith(true);
  });

  it('disconnect при отсутствии membership', async () => {
    const deps = makeDeps({ membershipFound: false });
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    expect(sock.disconnect).toHaveBeenCalledWith(true);
  });

  it('accept при валидном JWT + membership → emit connected', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    expect(sock.disconnect).not.toHaveBeenCalled();
    expect(sock.emit).toHaveBeenCalledWith('connected', { ok: true });
  });
});

describe('VoiceStreamGateway — happy path', () => {
  it('voice:start → 3× voice:chunk → voice:end → voice:transcribed', async () => {
    const deps = makeDeps({
      asrResult: { text: 'тестовая фраза', durationSeconds: 2.5, provider: 'vox' },
    });
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    const startAck = gw.handleStart(sock as unknown as Socket, {
      sampleRate: 48000,
      mimeType: 'audio/webm;codecs=opus',
    });
    expect(startAck.ok).toBe(true);
    expect(startAck.sessionId).toBe(sock.id);
    expect(startAck.ttlSec).toBe(60);

    for (let i = 0; i < 3; i++) {
      const ack = gw.handleChunk(sock as unknown as Socket, {
        data: Buffer.from(`chunk-${i}-payload-bytes`),
      });
      expect(ack.ok).toBe(true);
    }
    expect(deps.metricsSpies.incVoiceWsChunk).toHaveBeenCalledTimes(3);

    await gw.handleEnd(sock as unknown as Socket);

    // VoiceChannelAdapter был вызван с собранным буфером.
    const adapter = deps.adapter as unknown as {
      transcribe: ReturnType<typeof vi.fn>;
    };
    expect(adapter.transcribe).toHaveBeenCalledTimes(1);
    const callArg = adapter.transcribe.mock.calls[0]?.[0] as {
      audio: Buffer;
      tenantId: string;
      mimeType: string;
    };
    expect(Buffer.isBuffer(callArg.audio)).toBe(true);
    expect(callArg.audio.byteLength).toBeGreaterThan(0);
    expect(callArg.tenantId).toBe('tenant-1');
    expect(callArg.mimeType).toBe('audio/webm;codecs=opus');

    // emit voice:transcribed с полями text/durationMs/latencyMs.
    const transcribedCall = sock.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'voice:transcribed',
    );
    expect(transcribedCall).toBeDefined();
    const payload = transcribedCall?.[1] as {
      text: string;
      durationMs: number;
      latencyMs: number;
    };
    expect(payload.text).toBe('тестовая фраза');
    expect(payload.durationMs).toBe(2500);
    expect(typeof payload.latencyMs).toBe('number');

    expect(deps.metricsSpies.observeVoiceWsAsrLatency).toHaveBeenCalledTimes(1);
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('completed');
  });
});

describe('VoiceStreamGateway — TTL timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('сессия без voice:end за 60 сек → voice:error{ttl_expired} + outcome=timeout', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    gw.handleStart(sock as unknown as Socket, {});

    // Прыгаем на 61 секунду вперёд — TTL guard должен сработать.
    vi.advanceTimersByTime(61_000);

    const errorCall = sock.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'voice:error',
    );
    expect(errorCall).toBeDefined();
    expect((errorCall?.[1] as { code: string }).code).toBe('ttl_expired');
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('timeout');
  });
});

describe('VoiceStreamGateway — buffer overflow', () => {
  it('суммарно > 5 MB → voice:error{buffer_overflow} + outcome=error', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    gw.handleStart(sock as unknown as Socket, {});

    // Большой chunk (>64KB) сразу режется как 'chunk_too_large'. Чтобы
    // спровоцировать buffer_overflow, шлём много допустимых chunks.
    const okChunk = Buffer.alloc(60 * 1024, 0x42); // 60 KB
    // 5MB / 60KB ≈ 85.3 чанков → шлём 90, чтобы суммарно > 5MB.
    let overflowAt = -1;
    for (let i = 0; i < 90; i++) {
      const ack = gw.handleChunk(sock as unknown as Socket, { data: okChunk });
      if (!ack.ok) {
        overflowAt = i;
        break;
      }
    }
    expect(overflowAt).toBeGreaterThan(0);
    const errorCall = sock.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'voice:error',
    );
    expect((errorCall?.[1] as { code: string }).code).toBe('buffer_overflow');
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('error');
  });

  it('один chunk > 64 KB → voice:error{chunk_too_large} + outcome=error', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    gw.handleStart(sock as unknown as Socket, {});

    const tooBig = Buffer.alloc(65 * 1024, 0x01); // > 64 KB
    const ack = gw.handleChunk(sock as unknown as Socket, { data: tooBig });
    expect(ack.ok).toBe(false);
    expect(ack.error?.code).toBe('chunk_too_large');
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('error');
  });
});

describe('VoiceStreamGateway — cancel flow', () => {
  it('voice:cancel чистит сессию + outcome=cancelled', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    gw.handleStart(sock as unknown as Socket, {});
    gw.handleChunk(sock as unknown as Socket, {
      data: Buffer.from('some-audio'),
    });

    const ack = gw.handleCancel(sock as unknown as Socket);
    expect(ack.ok).toBe(true);
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('cancelled');

    // После cancel: voice:end должен пожаловаться на 'no_session'.
    sock.emit.mockClear();
    await gw.handleEnd(sock as unknown as Socket);
    const errorCall = sock.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'voice:error',
    );
    expect((errorCall?.[1] as { code: string }).code).toBe('no_session');
  });

  it('handleDisconnect с открытой сессией → outcome=cancelled', async () => {
    const deps = makeDeps({});
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    gw.handleStart(sock as unknown as Socket, {});

    gw.handleDisconnect(sock as unknown as Socket);
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('cancelled');
  });
});

describe('VoiceStreamGateway — ASR upstream error', () => {
  it('VoiceAdapterError(asr_failed) → voice:error + outcome=error', async () => {
    const deps = makeDeps({
      asrThrows: new VoiceAdapterError('vox down', 'asr_failed'),
    });
    const gw = makeGateway(deps);
    const sock = makeSocket();

    await gw.handleConnection(sock as unknown as Socket);
    gw.handleStart(sock as unknown as Socket, {});
    gw.handleChunk(sock as unknown as Socket, {
      data: Buffer.from('audio-bytes'),
    });
    await gw.handleEnd(sock as unknown as Socket);

    const errorCall = sock.emit.mock.calls.find(
      (c: unknown[]) => c[0] === 'voice:error',
    );
    expect(errorCall).toBeDefined();
    expect((errorCall?.[1] as { code: string }).code).toBe('asr_failed');
    expect(deps.metricsSpies.incVoiceWsSession).toHaveBeenCalledWith('error');
    expect(deps.metricsSpies.observeVoiceWsAsrLatency).toHaveBeenCalledTimes(1);
  });
});
