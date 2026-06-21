import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DaySignalDetectorService } from './day-signal-detector.service';

describe('DaySignalDetectorService', () => {
  let llm: { call: ReturnType<typeof vi.fn> };
  let metrics: { incPromptInvalidResponse: ReturnType<typeof vi.fn> };
  let service: DaySignalDetectorService;

  beforeEach(() => {
    llm = { call: vi.fn() };
    metrics = { incPromptInvalidResponse: vi.fn() };
    service = new DaySignalDetectorService(llm as never, metrics as never);
  });

  it('распознаёт план дня', async () => {
    llm.call.mockResolvedValue({
      text: JSON.stringify({
        hasPlan: true,
        plan: { items: [{ text: 'дожать договор' }, { text: 'созвон с подрядчиком' }] },
        hasReport: false,
        report: { dones: [], blockers: [] },
        isPersonalNonWork: false,
        confidence: 0.9,
      }),
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const result = await service.detect({
      tenantId: 't1',
      personId: 'p1',
      dayText: 'Сегодня план: дожать договор, созвон с подрядчиком',
    });

    expect(result.hasPlan).toBe(true);
    expect(result.plan.items.length).toBeGreaterThanOrEqual(1);
    expect(llm.call).toHaveBeenCalled();
  });

  it('помечает личное/нерабочее', async () => {
    llm.call.mockResolvedValue({
      text: JSON.stringify({
        hasPlan: false,
        plan: { items: [] },
        hasReport: false,
        report: { dones: [], blockers: [] },
        isPersonalNonWork: true,
        confidence: 0.2,
      }),
      modelUsed: 'deepseek:deepseek-v4-flash',
    });

    const result = await service.detect({
      tenantId: 't1',
      personId: 'p1',
      dayText: 'завтра поеду к врачу',
    });

    expect(result.isPersonalNonWork).toBe(true);
    expect(llm.call).toHaveBeenCalled();
  });

  it('предфильтр отсекает болтовню без вызова LLM', async () => {
    const result = await service.detect({
      tenantId: 't1',
      personId: 'p1',
      dayText: 'ок 👍',
    });

    expect(result.hasPlan).toBe(false);
    expect(result.hasReport).toBe(false);
    expect(llm.call).not.toHaveBeenCalled();
  });

  it('невалидный JSON → пустой результат + метрика', async () => {
    llm.call.mockResolvedValue({ text: 'не json', modelUsed: 'm' });

    const result = await service.detect({
      tenantId: 't1',
      personId: 'p1',
      dayText: 'сегодня сделал задачу',
    });

    expect(result.hasPlan).toBe(false);
    expect(result.hasReport).toBe(false);
    expect(metrics.incPromptInvalidResponse).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'day-signal-detect' }),
    );
  });
});
