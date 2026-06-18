import { describe, expect, it, vi } from 'vitest';

import { buildSingleMeetingContext } from './context-builder/single-meeting-context';

describe('buildSingleMeetingContext', () => {
  it('собирает контекст с meta, summary, chapters, tasks, transcript', () => {
    const meeting = {
      id: 'm1',
      title: 'Встреча X',
      type: 'team',
      startedAt: new Date('2026-05-01'),
    } as never;
    const aiResult = { summary: 'Главное' } as never;
    const chapters = [
      { id: 'c1', startMs: 0, title: 'Intro' },
      { id: 'c2', startMs: 60_000, title: 'Discussion' },
    ] as never;
    const tasks = [{ id: 't1', title: 'Доделать прототип' }] as never;
    const chunks = [
      { startMs: 0, endMs: 5000, text: 'привет всем' },
      { startMs: 5000, endMs: 10_000, text: 'давайте обсудим' },
    ] as never;
    const history = [
      { role: 'user', content: 'предыдущий вопрос' },
      { role: 'assistant', content: 'предыдущий ответ' },
    ] as never;
    const ctx = buildSingleMeetingContext({
      meeting,
      aiResult,
      chapters,
      tasks,
      chunks,
      history,
      question: 'О чём была встреча?',
    });
    expect(ctx.systemPrompt).toContain('ассистент');
    expect(ctx.userMessage).toContain('Встреча X');
    expect(ctx.userMessage).toContain('Главное');
    expect(ctx.userMessage).toContain('Intro');
    expect(ctx.userMessage).toContain('Доделать прототип');
    expect(ctx.userMessage).toContain('предыдущий вопрос');
    expect(ctx.userMessage).toContain('О чём была встреча?');
    expect(ctx.contextChunks.length).toBe(2);
    expect(ctx.contextChunks[0]?.meetingId).toBe('m1');
  });

  it('обрезает большие транскрипты по char-limit', () => {
    const longChunks = Array.from({ length: 1000 }, (_, i) => ({
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      text: 'x'.repeat(200),
    })) as never;
    const ctx = buildSingleMeetingContext({
      meeting: { id: 'm', title: 'T', type: 'team', startedAt: new Date() } as never,
      aiResult: null,
      chapters: [],
      tasks: [],
      chunks: longChunks,
      history: [],
      question: 'q',
    });
    expect(ctx.contextChunks.length).toBeLessThan(1000);
    vi.restoreAllMocks();
  });
});
