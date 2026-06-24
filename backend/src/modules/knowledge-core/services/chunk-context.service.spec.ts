import { describe, expect, it, vi } from 'vitest';

import { ChunkContextService } from './chunk-context.service';

function build(opts: { enabled?: boolean; llmText?: string } = {}): {
  service: ChunkContextService;
  llmCall: ReturnType<typeof vi.fn>;
  getDynamic: ReturnType<typeof vi.fn>;
} {
  const llmCall = vi.fn(async () => ({ text: opts.llmText ?? 'Это была встреча про планы спринта.' }));
  const llm = { call: llmCall };
  const getDynamic = vi.fn(async () => opts.enabled ?? true);
  const cfg = { getDynamic };
  const service = new ChunkContextService(llm as never, cfg as never);
  return { service, llmCall, getDynamic };
}

const ARGS = {
  tenantId: 't-1',
  meetingTitle: 'Синк по релизу',
  meetingType: 'team_sync',
  meetingDateIso: '2026-06-24T10:00:00.000Z',
  participants: ['Аня', 'Боб'],
};

describe('ChunkContextService.buildContextHeader', () => {
  it('contextual_header_enabled=false → НЕ зовёт LLM, возвращает метастроку', async () => {
    const { service, llmCall } = build({ enabled: false });
    const out = await service.buildContextHeader(ARGS);
    expect(llmCall).not.toHaveBeenCalled();
    expect(out).toContain('Контекст: встреча «Синк по релизу»');
    expect(out).toContain('тип team_sync');
    expect(out).toContain('дата 24.06.2026');
    expect(out).toContain('участники: Аня, Боб');
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
    expect(out).toContain('Контекст: встреча «Синк по релизу»');
    expect(out).toContain('Это была встреча про планы спринта.');
  });

  it('ошибка LLM → fail-open: только метастрока', async () => {
    const { service } = build({ enabled: true });
    const llm = { call: vi.fn(async () => { throw new Error('boom'); }) };
    const cfg = { getDynamic: vi.fn(async () => true) };
    const failService = new ChunkContextService(llm as never, cfg as never);
    const out = await failService.buildContextHeader(ARGS);
    expect(out).toContain('Контекст: встреча «Синк по релизу»');
    expect(out).not.toContain('предложение');
    void service;
  });
});
