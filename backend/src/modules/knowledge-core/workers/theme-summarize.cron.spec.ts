import { describe, expect, it, vi } from 'vitest';

import { ThemeSummarizeCron } from './theme-summarize.cron';

function makeCron(args: {
  enabled: boolean;
  themeRows: Array<{ id: string }>;
  members: Array<{ block: { name: string; trustedAnswer: string } }>;
}) {
  const themeUpdateSpy = vi.fn(
    async (_arg: {
      where: { id: string };
      data: { summary: string; summaryUpdatedAt: Date };
    }) => ({ id: 'theme_1' }),
  );
  const llmCallSpy = vi.fn(async (_arg: { taskType: string }) => ({
    text: 'Связная суть темы простыми словами.',
    modelUsed: 'deepseek:flash',
    inputTokens: 1,
    outputTokens: 1,
    cachedTokens: 0,
    durationMs: 1,
  }));

  const queryRawUnsafeSpy = vi.fn(async () => args.themeRows);

  const fakePrisma = {
    org: { findMany: async () => [{ id: 'org_1' }] },
    theme: { update: themeUpdateSpy },
    themeIdeaBlock: { findMany: async () => args.members },
    $queryRawUnsafe: queryRawUnsafeSpy,
  } as unknown as ConstructorParameters<typeof ThemeSummarizeCron>[0];

  const getDynamicSpy = vi.fn(async (key: string, _env: unknown, def: unknown) => {
    if (key === 'knowledge.theme_summary_enabled') return args.enabled;
    return def;
  });
  const fakeCfg = {
    getDynamic: getDynamicSpy,
  } as unknown as ConstructorParameters<typeof ThemeSummarizeCron>[1];

  const fakeLlm = {
    call: llmCallSpy,
  } as unknown as ConstructorParameters<typeof ThemeSummarizeCron>[2];

  const fakeGate = {
    checkOrThrow: vi.fn(async () => undefined),
  } as unknown as ConstructorParameters<typeof ThemeSummarizeCron>[3];

  return {
    cron: new ThemeSummarizeCron(fakePrisma, fakeCfg, fakeLlm, fakeGate),
    themeUpdateSpy,
    llmCallSpy,
    queryRawUnsafeSpy,
  };
}

const TWO_MEMBERS = [
  { block: { name: 'Факт 1', trustedAnswer: 'ответ 1' } },
  { block: { name: 'Факт 2', trustedAnswer: 'ответ 2' } },
];

describe('ThemeSummarizeCron — инкрементальное резюме темы', () => {
  it('kill-switch OFF → ничего не делает (theme.update не вызван)', async () => {
    const { cron, themeUpdateSpy, queryRawUnsafeSpy } = makeCron({
      enabled: false,
      themeRows: [{ id: 'theme_1' }],
      members: TWO_MEMBERS,
    });

    await cron.sweep();

    expect(queryRawUnsafeSpy).not.toHaveBeenCalled();
    expect(themeUpdateSpy).not.toHaveBeenCalled();
  });

  it('enabled → тема, нуждающаяся в резюме, получает summary + summaryUpdatedAt', async () => {
    const { cron, themeUpdateSpy, llmCallSpy } = makeCron({
      enabled: true,
      themeRows: [{ id: 'theme_1' }],
      members: TWO_MEMBERS,
    });

    await cron.sweep();

    expect(llmCallSpy).toHaveBeenCalledTimes(1);
    expect(llmCallSpy.mock.calls[0]![0].taskType).toBe('theme-summarize');
    expect(themeUpdateSpy).toHaveBeenCalledTimes(1);
    const arg = themeUpdateSpy.mock.calls[0]![0];
    expect(arg.where.id).toBe('theme_1');
    expect(arg.data.summary.length).toBeGreaterThan(0);
    expect(arg.data.summaryUpdatedAt).toBeInstanceOf(Date);
  });

  it('тема не в выборке (свежий summaryUpdatedAt) → НЕ пересчитывается', async () => {
    const { cron, themeUpdateSpy, llmCallSpy } = makeCron({
      enabled: true,
      themeRows: [],
      members: TWO_MEMBERS,
    });

    await cron.sweep();

    expect(llmCallSpy).not.toHaveBeenCalled();
    expect(themeUpdateSpy).not.toHaveBeenCalled();
  });

  it('членов меньше порога (1) → тема пропускается, update не вызван', async () => {
    const { cron, themeUpdateSpy, llmCallSpy } = makeCron({
      enabled: true,
      themeRows: [{ id: 'theme_1' }],
      members: [{ block: { name: 'Один', trustedAnswer: 'факт' } }],
    });

    await cron.sweep();

    expect(llmCallSpy).not.toHaveBeenCalled();
    expect(themeUpdateSpy).not.toHaveBeenCalled();
  });
});
