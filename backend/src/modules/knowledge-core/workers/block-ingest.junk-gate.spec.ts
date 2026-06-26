import { describe, expect, it, vi } from 'vitest';

import { BlockIngestWorker, TRACKER_ECHO_SIGNALS } from './block-ingest.worker';

function buildWorker() {
  const ideaBlockEntityCreate = vi.fn(async () => ({ id: 'ibe-1' }));
  const prisma = {
    ideaBlockEntity: { create: ideaBlockEntityCreate },
  } as unknown;

  const findOrCreateEntity = vi.fn(async () => ({
    entity: { id: 'e1' },
    created: false,
  }));
  const entities = { findOrCreateEntity } as unknown;

  const incExtractionEntity = vi.fn();
  const metrics = { incExtractionEntity } as unknown;

  const worker = new BlockIngestWorker(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    entities as never,
    {} as never,
    {} as never,
    {} as never,
    metrics as never,
    {} as never,
    {} as never,
    {} as never,
  );

  return { worker, ideaBlockEntityCreate, findOrCreateEntity, incExtractionEntity };
}

describe('BlockIngestWorker — Ф2 гейт мусорных имён + эхо трекера', () => {
  it('TRACKER_ECHO_SIGNALS содержит трекерные сигналы и не содержит контент-сигналы', () => {
    expect(TRACKER_ECHO_SIGNALS.has('task_overdue')).toBe(true);
    expect(TRACKER_ECHO_SIGNALS.has('task_status_changed')).toBe(true);
    expect(TRACKER_ECHO_SIGNALS.has('fact')).toBe(false);
    expect(TRACKER_ECHO_SIGNALS.has('idea')).toBe(false);
  });

  it('мусорное имя (task_id) отсекается ДО создания сущности и связи', async () => {
    const { worker, ideaBlockEntityCreate, findOrCreateEntity, incExtractionEntity } =
      buildWorker();

    await (worker as any).linkEntity({
      tenantId: 't1',
      blockId: 'b1',
      mention: { type: 'topic', name: 'MANA-7' },
    });

    expect(findOrCreateEntity).not.toHaveBeenCalled();
    expect(ideaBlockEntityCreate).not.toHaveBeenCalled();
    expect(incExtractionEntity).toHaveBeenCalledWith({ type: 'rejected_junk_name' });
  });

  it('валидное имя создаёт сущность и связь', async () => {
    const { worker, ideaBlockEntityCreate, findOrCreateEntity } = buildWorker();

    await (worker as any).linkEntity({
      tenantId: 't1',
      blockId: 'b1',
      mention: { type: 'topic', name: 'Битрикс' },
    });

    expect(findOrCreateEntity).toHaveBeenCalledTimes(1);
    expect(ideaBlockEntityCreate).toHaveBeenCalledTimes(1);
  });
});
