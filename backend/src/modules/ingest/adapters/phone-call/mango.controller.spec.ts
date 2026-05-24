/**
 * Spec для MangoCallWebhookController (Phase F.5).
 *
 * Mango Office присылает form-encoded body с полями:
 *   - json: raw JSON-строка payload'а;
 *   - sign: sha256(apiKey + json + apiSalt).
 *
 * Контроллер:
 *   - 403 invalid_mango_payload — нет json или sign.
 *   - 403 invalid_mango_signature — подпись не сошлась.
 *   - 403 invalid_mango_json — JSON.parse упал.
 *   - 200 ok (skip) для non-call events.
 *   - 200 ok+idempotent при повторном входе.
 */
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { MangoCallWebhookController } from './mango.controller';

import type { IngestService } from '../../ingest.service';
import type { MangoAdapterService } from './mango.service';

const validEvent = {
  entry: 'call',
  call_id: 'cid-1',
  timestamp: 1700000000,
  direction: 'in',
  duration: 42,
  from: { extension: '101', number: '+71234567890' },
  to: { extension: '202', number: '+79991234567' },
};
const validBody = {
  json: JSON.stringify(validEvent),
  sign: 'fake-sign-but-treated-as-valid-by-mock',
};

function build(opts: {
  verifyOk?: boolean;
  extensionFilter?: string[];
  downloadThrows?: boolean;
  recordingUrl?: string | null;
  ingestIdempotent?: boolean;
} = {}) {
  const mango = {
    loadActiveSource: vi.fn(async () => ({
      source: { id: 'src-1', tenantId: 't-1', dataClass: 'internal' as const },
      apiKey: 'api-key',
      apiSalt: 'salt',
      config: { extensions: opts.extensionFilter ?? [] },
    })),
    verifySignature: vi.fn(() => opts.verifyOk !== false),
    downloadRecording: vi.fn(async () => {
      if (opts.downloadThrows) throw new Error('s3 down');
      return 'tenants/t-1/calls/cid-1.mp3';
    }),
  } as unknown as MangoAdapterService;

  const ingest = {
    ingest: vi.fn(async () => ({ idempotent: opts.ingestIdempotent ?? false })),
  } as unknown as IngestService;

  const ctrl = new MangoCallWebhookController(mango, ingest);
  return { ctrl, mango, ingest };
}

describe('MangoCallWebhookController', () => {
  it('happy: 200 + ingest вызывается с правильным payload', async () => {
    const { ctrl, ingest } = build({ verifyOk: true });
    const res = await ctrl.receive('src-1', validBody as never);
    expect(res.ok).toBe(true);
    expect(ingest.ingest).toHaveBeenCalledOnce();
    const arg = (ingest.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.tenantId).toBe('t-1');
    expect(arg.sourceExternalId).toBe('mango:cid-1');
  });

  it('403 invalid_mango_payload если json отсутствует', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receive('src-1', { sign: 'x' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 invalid_mango_payload если sign отсутствует', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.receive('src-1', { json: '{}' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 invalid_mango_signature если verifySignature вернул false', async () => {
    const { ctrl } = build({ verifyOk: false });
    await expect(
      ctrl.receive('src-1', validBody as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 invalid_mango_json если JSON.parse упал', async () => {
    const { ctrl } = build({ verifyOk: true });
    await expect(
      ctrl.receive('src-1', { json: 'not-json{', sign: 'x' } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('200 ok (skip) для non-call entry', async () => {
    const { ctrl, ingest } = build({ verifyOk: true });
    const body = {
      json: JSON.stringify({ entry: 'sms', call_id: 'x' }),
      sign: 'ok',
    };
    const res = await ctrl.receive('src-1', body as never);
    expect(res).toEqual({ ok: true });
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('200 ok (skip) если расширение не в whitelist', async () => {
    const { ctrl, ingest } = build({
      verifyOk: true,
      extensionFilter: ['999'],
    });
    const res = await ctrl.receive('src-1', validBody as never);
    expect(res).toEqual({ ok: true });
    expect(ingest.ingest).not.toHaveBeenCalled();
  });

  it('200 ok + idempotent=true при повторном вызове', async () => {
    const { ctrl } = build({ verifyOk: true, ingestIdempotent: true });
    const res = await ctrl.receive('src-1', validBody as never);
    expect(res).toEqual({ ok: true, idempotent: true });
  });

  it('403 если call_id и entry_id оба отсутствуют', async () => {
    const { ctrl } = build({ verifyOk: true });
    const body = {
      json: JSON.stringify({ entry: 'call' }),
      sign: 'ok',
    };
    await expect(
      ctrl.receive('src-1', body as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('downloadRecording fail НЕ ломает webhook (recordS3Key=null)', async () => {
    const { ctrl, ingest } = build({
      verifyOk: true,
      downloadThrows: true,
    });
    const body = {
      json: JSON.stringify({
        ...validEvent,
        recording_url: 'https://mango.cdn/rec.mp3',
      }),
      sign: 'ok',
    };
    const res = await ctrl.receive('src-1', body as never);
    expect(res.ok).toBe(true);
    const arg = (ingest.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.payload.recordS3Key).toBeNull();
  });
});
