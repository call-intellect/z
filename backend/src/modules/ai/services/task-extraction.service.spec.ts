import { describe, expect, it, vi } from 'vitest';

import type { CompanyCapsuleService } from './company-capsule.service';
import type { LlmRouterService } from './llm-router.service';
import type { OrgContextService } from './org-context.service';
import { TaskExtractionService } from './task-extraction.service';

function makeRouter(): { call: ReturnType<typeof vi.fn> } {
  return {
    call: vi.fn(async () => ({
      text: JSON.stringify({ tasks: [] }),
      modelUsed: 'test-model',
    })),
  };
}

function makeCapsule(): { load: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async (tenantId: string | null) =>
      tenantId ? '## О компании\nНазвание: Ооо луа' : '',
    ),
  };
}

function makeOrgContext(): { load: ReturnType<typeof vi.fn> } {
  return {
    load: vi.fn(async () => ({
      projects: [{ identifier: 'BACKEND', name: 'Платформа' }],
      goals: [{ name: 'v2' }],
      people: [{ name: 'Игорь', role: 'CTO' }],
      meetingDateIso: '2026-07-07',
    })),
  };
}

function makeService(
  router: { call: ReturnType<typeof vi.fn> },
  capsule: { load: ReturnType<typeof vi.fn> },
  orgContext: { load: ReturnType<typeof vi.fn> },
): TaskExtractionService {
  return new TaskExtractionService(
    router as unknown as LlmRouterService,
    undefined,
    capsule as unknown as CompanyCapsuleService,
    orgContext as unknown as OrgContextService,
  );
}

const DIALOG = [{ speaker: 'A', text: 'сделай отчёт', startSec: 0, endSec: 2 }];

describe('TaskExtractionService.extractTasks — капсула + orgContext в промпте', () => {
  it('грузит капсулу и orgContext и прокидывает в userMessage', async () => {
    const router = makeRouter();
    const capsule = makeCapsule();
    const orgContext = makeOrgContext();
    const svc = makeService(router, capsule, orgContext);

    await svc.extractTasks({
      meetingId: 'm1',
      tenantId: 't1',
      meeting: { id: 'm1', type: 'team', title: 'Планёрка' },
      dialog: DIALOG,
    });

    expect(capsule.load).toHaveBeenCalledWith('t1', 'tasks');
    expect(orgContext.load).toHaveBeenCalledWith('t1', null);
    const userMessage = String(router.call.mock.calls[0]?.[0]?.userMessage);
    expect(userMessage).toContain('## О компании');
    expect(userMessage).toContain('Проекты организации');
    expect(userMessage).toContain('Активные цели');
    expect(userMessage).toContain('Сотрудники организации');
  });

  it('tenantId=null → секции «О компании» нет, orgContext.load не зван', async () => {
    const router = makeRouter();
    const capsule = makeCapsule();
    const orgContext = makeOrgContext();
    const svc = makeService(router, capsule, orgContext);

    await svc.extractTasks({
      meetingId: 'm1',
      tenantId: null,
      meeting: { id: 'm1', type: 'team', title: 'Планёрка' },
      dialog: DIALOG,
    });

    expect(orgContext.load).not.toHaveBeenCalled();
    const userMessage = String(router.call.mock.calls[0]?.[0]?.userMessage);
    expect(userMessage).not.toContain('## О компании');
  });
});
