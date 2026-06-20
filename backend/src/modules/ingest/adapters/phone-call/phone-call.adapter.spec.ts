import { describe, expect, it, vi } from 'vitest';

import type { VoxService } from '../../../ai/services/vox.service';
import type { IngestService } from '../../ingest.service';

import type { MangoAdapterService } from './mango.service';
import { PhoneCallIngestAdapter, type PhoneCallEvent } from './phone-call.adapter';

function makeEvent(over: Partial<PhoneCallEvent> = {}): PhoneCallEvent {
  return {
    callId: 'cid-1',
    occurredAt: new Date('2026-06-20T10:00:00.000Z'),
    from: { extension: '101', number: '+71234567890', name: 'Менеджер' },
    to: { extension: '202', number: '+79991234567', name: 'Клиент' },
    direction: 'in',
    durationSec: 60,
    recordingUrlExternal: 'https://mango.cdn/rec.mp3',
    raw: { entry: 'call', call_id: 'cid-1' },
    ...over,
  };
}

function build(
  opts: {
    downloadKey?: string | null;
    downloadThrows?: boolean;
    transcript?: string;
    voxThrows?: boolean;
    ingestIdempotent?: boolean;
  } = {},
) {
  const mango = {
    downloadRecording: vi.fn(async () => {
      if (opts.downloadThrows) throw new Error('download fail');
      return opts.downloadKey ?? 'phone-calls/t-1/cid-1.mp3';
    }),
    readRecording: vi.fn(async () => Buffer.from('audio-bytes')),
  } as unknown as MangoAdapterService;

  const ingest = {
    ingest: vi.fn(async () => ({
      rawEvent: { id: 're-1' },
      idempotent: opts.ingestIdempotent ?? false,
    })),
  } as unknown as IngestService;

  const vox = {
    submit: vi.fn(async () => {
      if (opts.voxThrows) throw new Error('vox down');
      return { taskId: 'task-1' };
    }),
    poll: vi.fn(async () => ({
      status: 'COMPLETED' as const,
      transcriptText: opts.transcript ?? 'Здравствуйте, по вашему заказу всё готово.',
      durationSeconds: 60,
    })),
  } as unknown as VoxService;

  const adapter = new PhoneCallIngestAdapter(mango, ingest, vox);
  const source = { id: 'src-1', tenantId: 't-1', dataClass: 'internal' as const };
  return { adapter, mango, ingest, vox, source };
}

describe('PhoneCallIngestAdapter', () => {
  it('happy: ingest вызван с Source phone_call, sourceExternalId=mango:<callId>, payload.fullText из ASR', async () => {
    const { adapter, ingest, source } = build({ transcript: 'Текст разговора' });
    const res = await adapter.ingestCall({ source, event: makeEvent() });

    expect(res.idempotent).toBe(false);
    expect(ingest.ingest).toHaveBeenCalledOnce();
    const arg = (ingest.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.sourceId).toBe('src-1');
    expect(arg.tenantId).toBe('t-1');
    expect(arg.sourceExternalId).toBe('mango:cid-1');
    expect(arg.dataClass).toBe('internal');
    expect(arg.payload.kind).toBe('phone_call');
    expect(arg.payload.callId).toBe('cid-1');
    expect(arg.payload.fullText).toBe('Текст разговора');
    expect(arg.payload.asrProvider).toBe('vox');
    expect(arg.payload.recordingS3Key).toBe('phone-calls/t-1/cid-1.mp3');
    expect(arg.payload.participants).toEqual([
      { role: 'from', extension: '101', number: '+71234567890', name: 'Менеджер' },
      { role: 'to', extension: '202', number: '+79991234567', name: 'Клиент' },
    ]);
    expect(arg.payload.startedAt).toBe('2026-06-20T10:00:00.000Z');
    expect(arg.payload.endedAt).toBe('2026-06-20T10:01:00.000Z');
  });

  it('нет recording_url → graceful: fullText пуст, recordingS3Key null, ASR не вызывается', async () => {
    const { adapter, ingest, vox } = build();
    const source = { id: 'src-1', tenantId: 't-1', dataClass: 'internal' as const };
    await adapter.ingestCall({
      source,
      event: makeEvent({ recordingUrlExternal: null }),
    });
    const arg = (ingest.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.payload.recordingS3Key).toBeNull();
    expect(arg.payload.fullText).toBe('');
    expect(arg.payload.asrProvider).toBeNull();
    expect(vox.submit).not.toHaveBeenCalled();
  });

  it('downloadRecording упал → graceful: recordingS3Key null, ingest всё равно вызван', async () => {
    const { adapter, ingest } = build({ downloadThrows: true });
    const source = { id: 'src-1', tenantId: 't-1', dataClass: 'internal' as const };
    const res = await adapter.ingestCall({ source, event: makeEvent() });
    expect(res.idempotent).toBe(false);
    const arg = (ingest.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.payload.recordingS3Key).toBeNull();
    expect(arg.payload.fullText).toBe('');
  });

  it('ASR упал → graceful: fullText пуст, asrProvider null, запись-источник сохранена', async () => {
    const { adapter, ingest } = build({ voxThrows: true });
    const source = { id: 'src-1', tenantId: 't-1', dataClass: 'internal' as const };
    await adapter.ingestCall({ source, event: makeEvent() });
    const arg = (ingest.ingest as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.payload.recordingS3Key).toBe('phone-calls/t-1/cid-1.mp3');
    expect(arg.payload.fullText).toBe('');
    expect(arg.payload.asrProvider).toBeNull();
  });

  it('идемпотентность: повтор того же callId возвращает idempotent=true (dedup на уровне ingest)', async () => {
    const { adapter } = build({ ingestIdempotent: true });
    const source = { id: 'src-1', tenantId: 't-1', dataClass: 'internal' as const };
    const res = await adapter.ingestCall({ source, event: makeEvent() });
    expect(res.idempotent).toBe(true);
  });
});
