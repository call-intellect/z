import { describe, expect, it, vi } from 'vitest';

import { MeetingTitleService } from './meeting-title.service';

interface BuildOpts {
  title: string | null;
  turns?: Array<{ speaker: string; text: string; startSec: number; endSec: number }>;
  llmText?: string;
  meetingFound?: boolean;
}

function build(opts: BuildOpts): {
  service: MeetingTitleService;
  updateMany: ReturnType<typeof vi.fn>;
  llmCall: ReturnType<typeof vi.fn>;
} {
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const prisma = {
    meeting: {
      findFirst: vi.fn(async () =>
        opts.meetingFound === false
          ? null
          : {
              id: 'm-1',
              title: opts.title,
              type: 'team_sync',
              ownerId: 'u-1',
              transcript: { turns: opts.turns ?? [] },
            },
      ),
      updateMany,
    },
  };
  const llmCall = vi.fn(async () => ({ text: opts.llmText ?? 'Сроки релиза и блокеры' }));
  const llm = { call: llmCall };

  const service = new MeetingTitleService(prisma as never, llm as never);
  return { service, updateMany, llmCall };
}

const TURNS = [
  { speaker: 'Аня', text: 'Обсудим сроки релиза.', startSec: 0, endSec: 3 },
  { speaker: 'Боб', text: 'Есть блокеры по бэкенду.', startSec: 3, endSec: 6 },
];

describe('MeetingTitleService.generateMeetingTitle', () => {
  it('placeholder-title + транскрипт → зовёт LLM и сохраняет очищенный title', async () => {
    const { service, updateMany, llmCall } = build({ title: 'текст', turns: TURNS });
    const out = await service.generateMeetingTitle({ tenantId: 't-1', meetingId: 'm-1' });
    expect(llmCall).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenCalledOnce();
    expect(updateMany.mock.calls[0]![0].data.title).toBe('Сроки релиза и блокеры');
    expect(out).toBe('Сроки релиза и блокеры');
  });

  it('осмысленный title → НЕ зовёт LLM и НЕ обновляет', async () => {
    const { service, updateMany, llmCall } = build({ title: 'Синк по релизу', turns: TURNS });
    const out = await service.generateMeetingTitle({ tenantId: 't-1', meetingId: 'm-1' });
    expect(llmCall).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it('пустой транскрипт → НЕ зовёт LLM и НЕ обновляет', async () => {
    const { service, updateMany, llmCall } = build({ title: '', turns: [] });
    const out = await service.generateMeetingTitle({ tenantId: 't-1', meetingId: 'm-1' });
    expect(llmCall).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
    expect(out).toBeNull();
  });

  it('чистит кавычки, код-фенс и завершающую точку', async () => {
    const { service, updateMany } = build({
      title: '.',
      turns: TURNS,
      llmText: '```\n«Итоги спринта команды».\n```',
    });
    await service.generateMeetingTitle({ tenantId: 't-1', meetingId: 'm-1' });
    expect(updateMany.mock.calls[0]![0].data.title).toBe('Итоги спринта команды');
  });

  it('встреча не найдена → null, без LLM/update', async () => {
    const { service, updateMany, llmCall } = build({ title: '', meetingFound: false });
    const out = await service.generateMeetingTitle({ tenantId: 't-1', meetingId: 'm-x' });
    expect(out).toBeNull();
    expect(llmCall).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
