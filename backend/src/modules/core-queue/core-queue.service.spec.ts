import { describe, expect, it, vi } from 'vitest';

import { CoreQueueService } from './core-queue.service';
import { CORE_QUEUE_NAMES } from './queues';

function buildService(): {
  service: CoreQueueService;
  add: ReturnType<typeof vi.fn>;
} {
  const add = vi.fn(async () => undefined);
  const service = new CoreQueueService({ client: {} } as any);
  const map = new Map();
  map.set(CORE_QUEUE_NAMES.SPECIALISTS_COMBINED, { add });
  (service as any).queues = map;
  return { service, add };
}

describe('CoreQueueService.enqueueSpecialistsCombined — WP-A дескриптор источника', () => {
  it('jobId идемпотентен по источнику: specialists_combined_<sourceType>_<externalId>', async () => {
    const { service, add } = buildService();

    await service.enqueueSpecialistsCombined({
      tenantId: 'tenant-1',
      sourceType: 'chatbox',
      externalId: 'sess-1',
    });

    expect(add).toHaveBeenCalledTimes(1);
    const [name, payload, opts] = add.mock.calls[0]!;
    expect(name).toBe('specialists-combined');
    expect(opts.jobId).toBe('specialists_combined_chatbox_sess-1');
    expect(payload).toEqual(
      expect.objectContaining({ tenantId: 'tenant-1', sourceType: 'chatbox', externalId: 'sess-1' }),
    );
    expect(payload).not.toHaveProperty('meetingId');
  });

  it('meeting-источник дублирует externalId в meetingId (обратная совместимость)', async () => {
    const { service, add } = buildService();

    await service.enqueueSpecialistsCombined({
      tenantId: 'tenant-1',
      sourceType: 'meeting',
      externalId: 'm-1',
    });

    const [, payload, opts] = add.mock.calls[0]!;
    expect(opts.jobId).toBe('specialists_combined_meeting_m-1');
    expect(payload.meetingId).toBe('m-1');
  });

  it('delayMs>0 прокидывается в jobOpts.delay', async () => {
    const { service, add } = buildService();

    await service.enqueueSpecialistsCombined(
      { tenantId: 'tenant-1', sourceType: 'meeting', externalId: 'm-1' },
      { delayMs: 90_000 },
    );

    const [, , opts] = add.mock.calls[0]!;
    expect(opts.delay).toBe(90_000);
  });
});
