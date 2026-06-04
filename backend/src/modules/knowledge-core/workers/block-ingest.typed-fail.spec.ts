import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import {
  BlockIngestWorker,
  classifyTypedFailReason,
} from './block-ingest.worker';

/**
 * МТЗ «разблокировка конвейера» Ф5 — детерминированные юнит-тесты:
 *
 *   1. Классификатор `classifyTypedFailReason(err)`:
 *        - ошибка cypher / 42883 → 'age_unavailable' (системный отказ графа);
 *        - Prisma P2002 → 'idempotent_skip' (гонка concurrency, норма);
 *        - ValidationError / required → 'validation_error';
 *        - прочее → 'other'.
 *   2. `warnTypedFail` инкрементит метрику `kc_typed_entity_failed_total` с
 *      правильным reason и ВОЗВРАЩАЕТ reason (вызывающий аккумулирует
 *      systemFailure только на 'age_unavailable' → НЕ помечает RawEvent
 *      'ingested', а уводит job в failed для ретрая).
 */

describe('classifyTypedFailReason — Ф5', () => {
  it('cypher does not exist → age_unavailable', () => {
    expect(
      classifyTypedFailReason(
        new Error('function cypher(unknown, unknown) does not exist'),
      ),
    ).toBe('age_unavailable');
  });

  it('код 42883 в сообщении → age_unavailable', () => {
    expect(classifyTypedFailReason(new Error('SQL error 42883'))).toBe(
      'age_unavailable',
    );
  });

  it('упоминание z_graph → age_unavailable', () => {
    expect(
      classifyTypedFailReason(new Error("graph 'z_graph' is not loaded")),
    ).toBe('age_unavailable');
  });

  it('ag_catalog в сообщении → age_unavailable', () => {
    expect(
      classifyTypedFailReason(new Error('schema ag_catalog not in search_path')),
    ).toBe('age_unavailable');
  });

  it('Prisma P2002 (instanceof) → idempotent_skip', () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: 'test' },
    );
    expect(classifyTypedFailReason(err)).toBe('idempotent_skip');
  });

  it('unique constraint в тексте → idempotent_skip', () => {
    expect(
      classifyTypedFailReason(new Error('duplicate key — unique constraint')),
    ).toBe('idempotent_skip');
  });

  it('ValidationError (по имени класса) → validation_error', () => {
    class ValidationError extends Error {}
    expect(classifyTypedFailReason(new ValidationError('bad shape'))).toBe(
      'validation_error',
    );
  });

  it('сообщение про required → validation_error', () => {
    expect(
      classifyTypedFailReason(new Error('data.name is required')),
    ).toBe('validation_error');
  });

  it('прочая ошибка → other', () => {
    expect(classifyTypedFailReason(new Error('connection reset by peer'))).toBe(
      'other',
    );
  });
});

/**
 * Минимальный конструктор BlockIngestWorker с замоканными зависимостями.
 * 13 аргументов (RouterService убран в Ф3). Нам нужен только `metrics`.
 */
function buildWorkerWithMetrics() {
  const metrics = {
    incTypedEntityFailed: vi.fn(),
  };
  const worker = new BlockIngestWorker(
    {} as any, // redis
    {} as any, // prisma
    {} as any, // s3
    {} as any, // segments
    {} as any, // extractor
    {} as any, // embeddings
    {} as any, // entities
    {} as any, // coreQueue
    {} as any, // gate
    {} as any, // graph
    metrics as any, // metrics
    {} as any, // axisClassifier
    {} as any, // cfg
  );
  return { worker, metrics };
}

describe('BlockIngestWorker.warnTypedFail — Ф5 классификация + метрика', () => {
  it('cypher-ошибка → reason age_unavailable, метрика инкрементится, reason возвращён', () => {
    const { worker, metrics } = buildWorkerWithMetrics();
    const reason = (worker as any).warnTypedFail(
      'process',
      'Онбординг',
      new Error('function cypher does not exist'),
    );
    expect(reason).toBe('age_unavailable');
    expect(metrics.incTypedEntityFailed).toHaveBeenCalledWith({
      type: 'process',
      reason: 'age_unavailable',
    });
  });

  it('P2002 → reason idempotent_skip (НЕ системный отказ → ingested останется)', () => {
    const { worker, metrics } = buildWorkerWithMetrics();
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const reason = (worker as any).warnTypedFail('regulation', 'Регламент', err);
    expect(reason).toBe('idempotent_skip');
    expect(metrics.incTypedEntityFailed).toHaveBeenCalledWith({
      type: 'regulation',
      reason: 'idempotent_skip',
    });
  });

  it('нормализует type-метку «decision (fallback)» → «decision» в метрике', () => {
    const { worker, metrics } = buildWorkerWithMetrics();
    (worker as any).warnTypedFail(
      'decision (fallback)',
      'текст',
      new Error('boom'),
    );
    expect(metrics.incTypedEntityFailed).toHaveBeenCalledWith({
      type: 'decision',
      reason: 'other',
    });
  });
});
