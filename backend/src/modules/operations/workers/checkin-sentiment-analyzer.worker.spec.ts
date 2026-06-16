import { describe, expect, it, vi } from 'vitest';

import { CheckinSentimentAnalyzerWorker } from './checkin-sentiment-analyzer.worker';

describe('CheckinSentimentAnalyzerWorker', () => {
  const baseCfg = {
    betaOps: { sentimentEnabled: true },
  };

  function buildWorker(overrides: {
    llmResult?: { text: string; modelUsed: string };
    llmReject?: Error;
    cfg?: typeof baseCfg;
  }) {
    const prisma = {
      dailyCheckIn: {
        update: vi.fn().mockResolvedValue({ id: 'cin1' }),
      },
    };
    const llm = {
      call: overrides.llmReject
        ? vi.fn().mockRejectedValue(overrides.llmReject)
        : vi.fn().mockResolvedValue(
            overrides.llmResult ?? {
              text: '{"sentiment":"green","rationale":"OK"}',
              modelUsed: 'deepseek:deepseek-chat',
            },
          ),
    };
    const metrics = {
      incCooSentimentAnalyzed: vi.fn(),
      incCooSentimentFailed: vi.fn(),
    };
    const worker = new CheckinSentimentAnalyzerWorker(
      prisma as never,
      (overrides.cfg ?? baseCfg) as never,
      llm as never,
      metrics as never,
    );
    return { worker, prisma, llm, metrics };
  }

  it('green: парсит ответ и обновляет sentiment=green', async () => {
    const { worker, prisma, metrics } = buildWorker({
      llmResult: {
        text: '{"sentiment":"green","rationale":"день прошёл нормально"}',
        modelUsed: 'deepseek:deepseek-chat',
      },
    });
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin1',
      personId: 'p1',
      kind: 'evening',
      rawText: 'Сделал три задачи, всё спокойно.',
    });
    expect(prisma.dailyCheckIn.update).toHaveBeenCalledOnce();
    const arg = prisma.dailyCheckIn.update.mock.calls[0]![0] as {
      where: { id: string };
      data: { sentiment: string; sentimentRationale: string; sentimentVersion: string };
    };
    expect(arg.where).toEqual({ id: 'cin1' });
    expect(arg.data.sentiment).toBe('green');
    expect(arg.data.sentimentRationale).toBe('день прошёл нормально');
    expect(arg.data.sentimentVersion).toContain('deepseek:deepseek-chat');
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledWith(
      expect.objectContaining({ sentiment: 'green' }),
    );
  });

  it('yellow: корректно парсит', async () => {
    const { worker, prisma } = buildWorker({
      llmResult: {
        text: '{"sentiment":"yellow","rationale":"есть напряжение"}',
        modelUsed: 'openai-via-proxy:gpt-4o-mini',
      },
    });
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin2',
      personId: 'p1',
      kind: 'evening',
      rawText: 'Часть задач не успел.',
    });
    const arg = prisma.dailyCheckIn.update.mock.calls[0]![0] as {
      data: { sentiment: string };
    };
    expect(arg.data.sentiment).toBe('yellow');
  });

  it('red: корректно парсит', async () => {
    const { worker, prisma, metrics } = buildWorker({
      llmResult: {
        text: '{"sentiment":"red","rationale":"выгорание, ничего не сделано"}',
        modelUsed: 'deepseek:deepseek-chat',
      },
    });
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin3',
      personId: 'p1',
      kind: 'evening',
      rawText: 'Совсем нет сил, ничего не работает.',
    });
    const arg = prisma.dailyCheckIn.update.mock.calls[0]![0] as {
      data: { sentiment: string };
    };
    expect(arg.data.sentiment).toBe('red');
    expect(metrics.incCooSentimentAnalyzed).toHaveBeenCalledWith(
      expect.objectContaining({ sentiment: 'red' }),
    );
  });

  it('LLM упал → sentiment не обновляется, метрика failed++', async () => {
    const { worker, prisma, metrics } = buildWorker({
      llmReject: new Error('LLM provider down'),
    });
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin4',
      personId: 'p1',
      kind: 'evening',
      rawText: 'Что-то написал',
    });
    expect(prisma.dailyCheckIn.update).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentFailed).toHaveBeenCalledOnce();
  });

  it('Невалидный JSON в ответе → sentiment не обновляется, метрика failed++', async () => {
    const { worker, prisma, metrics } = buildWorker({
      llmResult: {
        text: 'это вообще не JSON, просто текст',
        modelUsed: 'ollama:qwen3.5:9b',
      },
    });
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin5',
      personId: 'p1',
      kind: 'evening',
      rawText: 'текст',
    });
    expect(prisma.dailyCheckIn.update).not.toHaveBeenCalled();
    expect(metrics.incCooSentimentFailed).toHaveBeenCalledOnce();
  });

  it('Утренний чек-ин — анализ пропускается', async () => {
    const { worker, llm, prisma } = buildWorker({});
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin6',
      personId: 'p1',
      kind: 'morning',
      rawText: 'Сегодня запланировал три задачи',
    });
    expect(llm.call).not.toHaveBeenCalled();
    expect(prisma.dailyCheckIn.update).not.toHaveBeenCalled();
  });

  it('COO_SENTIMENT_ENABLED=false → анализ пропускается', async () => {
    const { worker, llm } = buildWorker({
      cfg: { betaOps: { sentimentEnabled: false } },
    });
    await worker.handle({
      tenantId: 't1',
      checkInId: 'cin7',
      personId: 'p1',
      kind: 'evening',
      rawText: 'Что-то',
    });
    expect(llm.call).not.toHaveBeenCalled();
  });
});
