/**
 * Регрессия на баг «LLM-анализ: enqueueQualityScore/MeetingRoi упал — Custom Id
 * cannot contain :» (2026-06-03).
 *
 * BullMQ 5.x (job.js): кастомный jobId, содержащий ':', допустим ТОЛЬКО если
 * `jobId.split(':').length === 3` (легаси-совместимость с repeatable-джобами).
 * Любой jobId с числом ':' ≠ 2 (1 двоеточие, 3+ двоеточий) → бросает
 * «Custom Id cannot contain :». Поэтому `quality:<meetingId>` (1 ':') падал,
 * а `<meetingId>:analyze:<attempt>` (2 ':') — работал.
 *
 * Канон: не использовать ':' как разделитель в jobId — заменён на '_'.
 */
import { describe, expect, it } from 'vitest';

/** Точная копия проверки BullMQ Job.addJob (node_modules/bullmq job.js). */
function bullmqRejectsJobId(jobId: string): boolean {
  return jobId.includes(':') && jobId.split(':').length !== 3;
}

describe('BullMQ jobId — правило ровно-3-частей при наличии ":"', () => {
  it('одиночное ":" (2 части) — отвергается', () => {
    expect(bullmqRejectsJobId('quality:01KT65ZK')).toBe(true);
    expect(bullmqRejectsJobId('meeting-roi:01KT65ZK')).toBe(true);
  });

  it('ровно 3 части — допустимо (легаси repeatable)', () => {
    expect(bullmqRejectsJobId('01KT65ZK:analyze:1')).toBe(false);
    expect(bullmqRejectsJobId('rollup:card:cmp123')).toBe(false);
  });

  it('4+ части — отвергается', () => {
    expect(bullmqRejectsJobId('delivery:d1:retry:123')).toBe(true);
    expect(bullmqRejectsJobId('tbackfill:t1:e1:5')).toBe(true);
  });

  it('исправленные форматы (через "_") — валидны', () => {
    for (const id of [
      'quality_01KT65ZK',
      'transcript-clean_01KT65ZK',
      'meeting-roi_01KT65ZK',
      'decision-hygiene_dec1',
      'intake-auto-triage_iss1',
      'demo-cleanup_org1',
      'import-tracker_log1',
      'export_exp1',
      'invoice_inv1',
      'delivery_d1',
      'delivery_d1_retry_123',
      'tbackfill_t1_e1_5',
    ]) {
      expect(bullmqRejectsJobId(id), id).toBe(false);
    }
  });
});
