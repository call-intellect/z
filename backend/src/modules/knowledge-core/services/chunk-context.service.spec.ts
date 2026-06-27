import { describe, expect, it, vi } from 'vitest';

import { buildMetaLine, ChunkContextService } from './chunk-context.service';
import { makeContextHeaderInput } from './context-header-input';

function build(opts: { enabled?: boolean; llmText?: string } = {}): {
  service: ChunkContextService;
  llmCall: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
} {
  const llmCall = vi.fn(async () => ({
    text: opts.llmText ?? 'Это была встреча про планы спринта.',
  }));
  const llm = { call: llmCall };
  const getDynamic = vi.fn(async () => opts.enabled ?? true);
  const cfg = { getDynamic };
  const service = new ChunkContextService(llm as never, cfg as never);
  return { service, llmCall, getDynamic };
}

const ARGS = {
  tenantId: 't-1',
  sourceTitle: 'Синк по релизу',
  meetingType: 'team_sync',
  meetingDateIso: '2026-06-24T10:00:00.000Z',
  participants: ['Боб', 'Аня'],
  companies: ['ООО Ромашка'],
};

describe('ChunkContextService.buildContextHeader', () => {
  it('contextual_header_enabled=false → НЕ зовёт LLM, возвращает метастроку', async () => {
    const { service, llmCall } = build({ enabled: false });
    const out = await service.buildContextHeader(ARGS);
    expect(llmCall).not.toHaveBeenCalled();
    expect(out).toContain('источник «Синк по релизу»');
    expect(out).toContain('компании: ООО Ромашка');
    expect(out).toContain('участники: Аня, Боб');
    expect(out).toContain('тип team_sync');
    expect(out).toContain('дата 24.06.2026');
  });

  it('пустые args → возвращает пустую строку, LLM не зовётся', async () => {
    const { service, llmCall } = build({ enabled: true });
    const out = await service.buildContextHeader({ tenantId: 't-1' });
    expect(out).toBe('');
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('enabled=true + непустая метастрока → зовёт LLM, добавляет предложение', async () => {
    const { service, llmCall } = build({ enabled: true });
    const out = await service.buildContextHeader(ARGS);
    expect(llmCall).toHaveBeenCalledOnce();
    expect(out).toContain('источник «Синк по релизу»');
    expect(out).toContain('Это была встреча про планы спринта.');
  });

  it('ошибка LLM → fail-open: только метастрока', async () => {
    const llm = {
      call: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const cfg = { getDynamic: vi.fn(async () => true) };
    const failService = new ChunkContextService(llm as never, cfg as never);
    const out = await failService.buildContextHeader(ARGS);
    expect(out).toContain('источник «Синк по релизу»');
    expect(out).not.toContain('предложение');
  });
});

describe('buildMetaLine — обогащение R7', () => {
  it('вывод содержит компанию и ≥2 участников для фикстуры', () => {
    const out = buildMetaLine({
      sourceTitle: 'Звонок с клиентом',
      companies: ['Acme Corp'],
      participants: ['Иван', 'Пётр', 'Сергей'],
    });
    expect(out).toContain('компании: Acme Corp');
    const participantsPart = out.split('участники: ')[1] ?? '';
    const names = participantsPart.split(', ').filter((s) => s.length > 0);
    expect(names.length).toBeGreaterThanOrEqual(2);
    expect(out).toContain('Иван');
    expect(out).toContain('Пётр');
  });

  it('дедуп и детерминированная сортировка участников/компаний', () => {
    const a = buildMetaLine({
      companies: ['Бета', 'Альфа', 'бета'],
      participants: ['Яна', 'Аня', 'аня'],
    });
    const b = buildMetaLine({
      companies: ['альфа', 'Бета'],
      participants: ['аня', 'Яна'],
    });
    expect(a).toContain('компании: Альфа, Бета');
    expect(a).toContain('участники: Аня, Яна');
    expect(b).toContain('компании: альфа, Бета');
  });
});

describe('buildMetaLine — консистентность ingest vs БД (КЛЮЧЕВОЙ)', () => {
  it('одинаковый вывод для одних и тех же данных «как из ingest» и «как из БД»', () => {
    const fromIngest = makeContextHeaderInput({
      sourceTitle: 'Планёрка маркетинга',
      companies: ['Ромашка', 'Лютик'],
      participants: ['Боб', 'Аня', 'Аня'],
      meetingType: 'team_sync',
      meetingDateIso: '2026-06-14T09:00:00.000Z',
    });
    const fromDb = makeContextHeaderInput({
      sourceTitle: 'Планёрка маркетинга',
      companies: ['Лютик', 'Ромашка'],
      participants: ['Аня', 'Боб'],
      meetingType: 'team_sync',
      meetingDateIso: '2026-06-14T09:00:00.000Z',
    });
    expect(buildMetaLine(fromIngest)).toBe(buildMetaLine(fromDb));
  });
});

describe('buildMetaLine — prompt-cache: стабильный префикс', () => {
  it('стабильный префикс (источник/компании/участники) не меняется между блоками одного источника', () => {
    const sourceBackground = {
      sourceTitle: 'Стратегическая сессия',
      companies: ['Гамма'],
      participants: ['Лена', 'Макс'],
    };
    const blockA = buildMetaLine({ ...sourceBackground, meetingType: 'strategy' });
    const blockB = buildMetaLine({ ...sourceBackground, meetingType: 'strategy' });
    const prefix = (s: string): string => s.split(', тип ')[0] ?? s;
    expect(prefix(blockA)).toBe(prefix(blockB));
    expect(prefix(blockA)).toContain('источник «Стратегическая сессия»');
    expect(prefix(blockA)).toContain('компании: Гамма');
    expect(prefix(blockA)).toContain('участники: Лена, Макс');
  });

  it('стабильная часть идёт ПРЕФИКСОМ, переменная (тип/дата) — в конце', () => {
    const out = buildMetaLine({
      sourceTitle: 'X',
      companies: ['C'],
      participants: ['P'],
      meetingType: 't',
      meetingDateIso: '2026-01-02T00:00:00.000Z',
    });
    const idxTitle = out.indexOf('источник');
    const idxType = out.indexOf('тип ');
    const idxDate = out.indexOf('дата ');
    expect(idxTitle).toBeGreaterThanOrEqual(0);
    expect(idxType).toBeGreaterThan(idxTitle);
    expect(idxDate).toBeGreaterThan(idxType);
  });
});
