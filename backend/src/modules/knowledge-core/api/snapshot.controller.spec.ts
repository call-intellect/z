/**
 * KC-Temporal W1.3 (2026-05-25) — unit-spec для `KnowledgeSnapshotController`.
 *
 * Контроллер делегирует логику в `SnapshotService` — здесь проверяем только
 * RBAC + tenant-fence + парсинг Zod query (включая CSV signalTypes).
 */
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { SnapshotQueryRawSchema } from './dto/snapshot.dto';
import { KnowledgeSnapshotController } from './snapshot.controller';

import type { CurrentUserPayload } from '../../auth/decorators/current-user.decorator';
import type { RbacService } from '../../rbac/rbac.service';
import type { SnapshotService } from './snapshot.service';

const userA: CurrentUserPayload = { id: 'u-A', email: 'a@x', role: 'user' };
const AT = '2026-05-25T12:00:00.000Z';

function build(opts: { canRead?: boolean } = {}) {
  const svc = {
    getSnapshot: vi.fn(async () => ({
      asOf: AT,
      blocks: [],
      entityLinks: [],
      truncated: false,
      tookMs: 1,
    })),
  } as unknown as SnapshotService;
  const rbac = {
    canRead: vi.fn(async () => opts.canRead ?? true),
  } as unknown as RbacService;
  const ctrl = new KnowledgeSnapshotController(svc, rbac);
  return { ctrl, svc, rbac };
}

describe('KnowledgeSnapshotController', () => {
  it('happy: делегирует SnapshotService.getSnapshot с распарсенным at + tenantId', async () => {
    const { ctrl, svc } = build();
    const query = SnapshotQueryRawSchema.parse({ at: AT, limit: '50' });
    const res = await ctrl.snapshot(query, userA, 't-A');
    expect(svc.getSnapshot).toHaveBeenCalledWith({
      tenantId: 't-A',
      at: new Date(AT),
      entityId: undefined,
      signalTypes: undefined,
      limit: 50,
    });
    expect(res.asOf).toBe(AT);
  });

  it('signalTypes из CSV распарсиваются в массив', () => {
    const r = SnapshotQueryRawSchema.parse({
      at: AT,
      signalTypes: 'idea,decision',
    });
    expect(r.signalTypes).toEqual(['idea', 'decision']);
  });

  it('signalTypes массивом тоже работают', () => {
    const r = SnapshotQueryRawSchema.parse({
      at: AT,
      signalTypes: ['idea', 'decision'],
    });
    expect(r.signalTypes).toEqual(['idea', 'decision']);
  });

  it('403 forbidden если canRead=false', async () => {
    const { ctrl } = build({ canRead: false });
    const query = SnapshotQueryRawSchema.parse({ at: AT });
    await expect(ctrl.snapshot(query, userA, 't-A')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 tenant_required без X-Org-Id', async () => {
    const { ctrl } = build();
    const query = SnapshotQueryRawSchema.parse({ at: AT });
    await expect(ctrl.snapshot(query, userA, undefined)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('Zod-400 на отсутствующий at', () => {
    const r = SnapshotQueryRawSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('Zod-400 на невалидный at', () => {
    const r = SnapshotQueryRawSchema.safeParse({ at: 'not-a-date' });
    expect(r.success).toBe(false);
  });

  it('Zod-400 на limit > 500', () => {
    const r = SnapshotQueryRawSchema.safeParse({ at: AT, limit: 9999 });
    expect(r.success).toBe(false);
  });

  it('Zod-400 на limit < 1', () => {
    const r = SnapshotQueryRawSchema.safeParse({ at: AT, limit: 0 });
    expect(r.success).toBe(false);
  });

  it('Zod-400 на неизвестный signalType', () => {
    const r = SnapshotQueryRawSchema.safeParse({
      at: AT,
      signalTypes: 'unknown_type',
    });
    expect(r.success).toBe(false);
  });

  it('limit по умолчанию = 100', () => {
    const r = SnapshotQueryRawSchema.parse({ at: AT });
    expect(r.limit).toBe(100);
  });
});
