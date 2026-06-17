import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminSettingsService } from '../../admin/settings/admin-settings.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';
import type { ConfidenceCalibrationService } from '../../knowledge-core/services/confidence-calibration.service';
import type { SimilarIssueDto } from '../dto/issues/similar-issue.dto';

import type { SimilarIssuesService } from './similar-issues.service';
import { TaskDedupService } from './task-dedup.service';

/**
 * Юнит-тест TaskDedupService (TZ task-dedup, 2026-06-16, Ф1).
 * Проверяет: позитив (дубль → same+matchedIssueId), негатив (разные → different),
 * embed-таймаут → nil (R4, не блокирует), порог-гейт, NIL вне диапазона.
 */
describe('TaskDedupService.evaluate', () => {
  let similar: SimilarIssuesService;
  let embeddings: EmbeddingFallbackService;
  let llm: LlmRouterService;
  let settings: AdminSettingsService;
  let calibration: ConfidenceCalibrationService;
  let svc: TaskDedupService;

  let findSimilarByVectorMock: ReturnType<typeof vi.fn>;
  let embedMock: ReturnType<typeof vi.fn>;
  let llmCallMock: ReturnType<typeof vi.fn>;
  let settingsGetMock: ReturnType<typeof vi.fn>;

  const SIMILAR: SimilarIssueDto[] = [
    {
      id: 'iss-near',
      identifier: 'K-10',
      title: 'Починить вход по email',
      stateId: 'st1',
      projectId: 'p1',
      completedAt: null,
      similarity: 0.93,
    },
  ];

  beforeEach(() => {
    findSimilarByVectorMock = vi.fn().mockResolvedValue(SIMILAR);
    similar = {
      findSimilarByVector: findSimilarByVectorMock,
    } as unknown as SimilarIssuesService;

    embedMock = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    embeddings = { embed: embedMock } as unknown as EmbeddingFallbackService;

    llmCallMock = vi.fn();
    llm = { call: llmCallMock } as unknown as LlmRouterService;

    // settings.get → undefined → дефолты (enabled=true, threshold=0.88).
    settingsGetMock = vi.fn().mockResolvedValue(undefined);
    settings = { get: settingsGetMock } as unknown as AdminSettingsService;

    calibration = {
      calibrate: vi.fn(async (raw: number) => raw),
    } as unknown as ConfidenceCalibrationService;

    svc = new TaskDedupService(
      similar,
      embeddings,
      llm,
      settings,
      calibration,
    );
  });

  it('позитив: арбитр верный дубль → verdict=same + matchedIssueId', async () => {
    llmCallMock.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'same',
        sameWithRef: 1,
        confidence: 0.91,
        rationale: 'То же действие — починка входа.',
      }),
    });

    const res = await svc.evaluate({
      tenantId: 't1',
      title: 'Исправить логин по почте',
    });

    expect(res.verdict).toBe('same');
    expect(res.matchedIssueId).toBe('iss-near');
    expect(res.confidence).toBeCloseTo(0.91, 5);
  });

  it('негатив: арбитр different → verdict=different, без matchedIssueId', async () => {
    llmCallMock.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'different',
        sameWithRef: 0,
        confidence: 0.8,
        rationale: 'Разные объекты входа.',
      }),
    });

    const res = await svc.evaluate({
      tenantId: 't1',
      title: 'Починить логин через SMS',
    });

    expect(res.verdict).toBe('different');
    expect(res.matchedIssueId).toBeNull();
  });

  it('R4: embed-таймаут → verdict=nil, создание не блокируется', async () => {
    // embed зависает дольше таймаута; настроим короткий таймаут через settings.
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'taskDedup.embedTimeoutMs') return 5;
      return undefined;
    });
    embedMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([[1, 2, 3]]), 100)),
    );

    const res = await svc.evaluate({ tenantId: 't1', title: 'Любая' });

    expect(res.verdict).toBe('nil');
    expect(res.matchedIssueId).toBeNull();
    // KNN/арбитр не вызывались — гейт пропущен.
    expect(findSimilarByVectorMock).not.toHaveBeenCalled();
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('гейт по порогу: лучший матч ниже suggestThreshold → nil без арбитра', async () => {
    findSimilarByVectorMock.mockResolvedValue([
      { ...SIMILAR[0]!, similarity: 0.5 },
    ]);

    const res = await svc.evaluate({ tenantId: 't1', title: 'Что-то' });

    expect(res.verdict).toBe('nil');
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('пустой KNN → nil без арбитра', async () => {
    findSimilarByVectorMock.mockResolvedValue([]);
    const res = await svc.evaluate({ tenantId: 't1', title: 'Без соседей' });
    expect(res.verdict).toBe('nil');
    expect(llmCallMock).not.toHaveBeenCalled();
  });

  it('same с номером вне диапазона → консервативно nil', async () => {
    llmCallMock.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'same',
        sameWithRef: 99,
        confidence: 0.95,
        rationale: 'дубль',
      }),
    });

    const res = await svc.evaluate({ tenantId: 't1', title: 'X' });
    expect(res.verdict).toBe('nil');
    expect(res.matchedIssueId).toBeNull();
  });

  it('kill-switch OFF (taskDedup.enabled=false) → nil без embed', async () => {
    settingsGetMock.mockImplementation(async (key: string) =>
      key === 'taskDedup.enabled' ? false : undefined,
    );

    const res = await svc.evaluate({ tenantId: 't1', title: 'X' });
    expect(res.verdict).toBe('nil');
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('findSimilarByVector вызывается с openOnly=true (дедуп среди открытых)', async () => {
    llmCallMock.mockResolvedValue({
      text: JSON.stringify({
        verdict: 'nil',
        sameWithRef: 0,
        confidence: 0.8,
        rationale: 'нет',
      }),
    });
    await svc.evaluate({ tenantId: 't1', title: 'X' });
    expect(findSimilarByVectorMock).toHaveBeenCalledWith(
      expect.objectContaining({ openOnly: true, tenantId: 't1' }),
    );
  });
});
