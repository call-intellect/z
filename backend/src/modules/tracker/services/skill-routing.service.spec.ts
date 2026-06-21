import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { EmbeddingFallbackService } from '../../embeddings/services/embedding-fallback.service';

import { SkillRoutingService } from './skill-routing.service';

const TENANT = 'tenant-1';
const OFFICE_MGR_ID = 'person-office';
const DEV_ID = 'person-dev';

interface PersonRow {
  id: string;
  userId: string | null;
  name: string;
  personRoles: Array<{
    role: {
      id: string;
      name: string;
      departmentId: string | null;
      department: { name: string } | null;
    };
  }>;
  appointments: Array<{
    role: {
      id: string;
      name: string;
      departmentId: string | null;
      department: { name: string } | null;
    };
  }>;
}

function officeMgrRow(departmentId: string | null = 'dep-admin'): PersonRow {
  return {
    id: OFFICE_MGR_ID,
    userId: 'user-office',
    name: 'Наташа',
    personRoles: [
      {
        role: {
          id: 'role-office',
          name: 'Офис-менеджер',
          departmentId,
          department: departmentId ? { name: 'Администрация' } : null,
        },
      },
    ],
    appointments: [],
  };
}

function devRow(departmentId: string | null = 'dep-eng'): PersonRow {
  return {
    id: DEV_ID,
    userId: 'user-dev',
    name: 'Пётр',
    personRoles: [
      {
        role: {
          id: 'role-dev',
          name: 'Разработчик',
          departmentId,
          department: departmentId ? { name: 'Инженерия' } : null,
        },
      },
    ],
    appointments: [],
  };
}

describe('SkillRoutingService.suggestAssignee', () => {
  let prisma: PrismaService;
  let llm: LlmRouterService;
  let embeddings: EmbeddingFallbackService;
  let metrics: BusinessMetricsService;
  let cfg: TypedConfigService;
  let svc: SkillRoutingService;

  let personFindManyMock: ReturnType<typeof vi.fn>;
  let roleProfileFindManyMock: ReturnType<typeof vi.fn>;
  let queryRawUnsafeMock: ReturnType<typeof vi.fn>;
  let issueCreateMock: ReturnType<typeof vi.fn>;
  let issueUpdateMock: ReturnType<typeof vi.fn>;
  let embedMock: ReturnType<typeof vi.fn>;
  let llmCallMock: ReturnType<typeof vi.fn>;
  let incRoutingSuggestionMock: ReturnType<typeof vi.fn>;
  let incRoutingNoCandidateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    personFindManyMock = vi
      .fn()
      .mockResolvedValue([officeMgrRow(), devRow()]);
    roleProfileFindManyMock = vi.fn().mockResolvedValue([
      {
        roleId: 'role-office',
        summaryCache: { responsibilities: ['снабжение', 'закупка канцелярии'] },
      },
    ]);
    queryRawUnsafeMock = vi.fn().mockResolvedValue([
      { personId: OFFICE_MGR_ID, statement: 'закупки', similarity: 0.8 },
    ]);
    issueCreateMock = vi.fn();
    issueUpdateMock = vi.fn();

    prisma = {
      person: { findMany: personFindManyMock },
      roleProfile: { findMany: roleProfileFindManyMock },
      issue: { create: issueCreateMock, update: issueUpdateMock },
      $queryRawUnsafe: queryRawUnsafeMock,
    } as unknown as PrismaService;

    embedMock = vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]);
    embeddings = { embed: embedMock } as unknown as EmbeddingFallbackService;

    llmCallMock = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        ranking: [
          { candidate: 0, confidence: 0.82, rationale: 'отвечает за снабжение' },
        ],
      }),
    });
    llm = { call: llmCallMock } as unknown as LlmRouterService;

    incRoutingSuggestionMock = vi.fn();
    incRoutingNoCandidateMock = vi.fn();
    metrics = {
      incRoutingSuggestion: incRoutingSuggestionMock,
      incRoutingSuggestionAccepted: vi.fn(),
      incRoutingNoCandidate: incRoutingNoCandidateMock,
    } as unknown as BusinessMetricsService;

    cfg = {
      taskRouting: { enabled: true, suggestMinConfidence: 0.6, topK: 3 },
      persons: { useAppointment: false },
      aiFeatures: { promptInjectionGuardEnabled: false },
    } as unknown as TypedConfigService;

    svc = new SkillRoutingService(prisma, llm, embeddings, metrics, cfg);
  });

  it('happy: «заказать канцелярию» → офис-менеджер топ-1, semantic, без write в БД', async () => {
    const result = await svc.suggestAssignee({
      tenantId: TENANT,
      taskText: 'заказать канцелярию',
    });

    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toEqual(
      expect.objectContaining({
        personId: OFFICE_MGR_ID,
        userId: 'user-office',
        personName: 'Наташа',
        roleName: 'Офис-менеджер',
        matchPath: 'semantic',
      }),
    );
    expect(result[0]!.confidence).toBeGreaterThanOrEqual(0.6);
    expect(result[0]!.rationale).toBe('отвечает за снабжение');
    expect(incRoutingSuggestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ matchPath: 'semantic' }),
    );
    expect(issueCreateMock).not.toHaveBeenCalled();
    expect(issueUpdateMock).not.toHaveBeenCalled();
  });

  it('hard-gate: explicitTags.departmentId оставляет только кандидатов отдела, matchPath tag_hard_gate', async () => {
    personFindManyMock.mockResolvedValue([
      officeMgrRow('dep1'),
      devRow('dep-eng'),
    ]);
    llmCallMock.mockResolvedValue({
      text: JSON.stringify({
        ranking: [
          { candidate: 0, confidence: 0.75, rationale: 'отдел снабжения' },
        ],
      }),
    });

    const result = await svc.suggestAssignee({
      tenantId: TENANT,
      taskText: 'заказать канцелярию',
      explicitTags: { departmentId: 'dep1' },
    });

    expect(result.length).toBe(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        personId: OFFICE_MGR_ID,
        matchPath: 'tag_hard_gate',
      }),
    );
    expect(incRoutingSuggestionMock).toHaveBeenCalledWith(
      expect.objectContaining({ matchPath: 'tag_hard_gate' }),
    );
  });

  it('нет уверенного: confidence ниже порога → пусто + incRoutingNoCandidate', async () => {
    llmCallMock.mockResolvedValue({
      text: JSON.stringify({
        ranking: [
          { candidate: 0, confidence: 0.3, rationale: 'возможно подходит' },
        ],
      }),
    });

    const result = await svc.suggestAssignee({
      tenantId: TENANT,
      taskText: 'заказать канцелярию',
    });

    expect(result).toEqual([]);
    expect(incRoutingNoCandidateMock).toHaveBeenCalled();
    expect(incRoutingSuggestionMock).not.toHaveBeenCalled();
  });

  it('арбитр зовётся taskType task-assignee-arbiter, присвоения нет', async () => {
    await svc.suggestAssignee({
      tenantId: TENANT,
      taskText: 'заказать канцелярию',
    });

    expect(llmCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: 'task-assignee-arbiter' }),
    );
    expect(issueCreateMock).not.toHaveBeenCalled();
    expect(issueUpdateMock).not.toHaveBeenCalled();
  });

  it('kill-switch: enabled=false → пусто, embeddings/llm не вызваны', async () => {
    cfg = {
      taskRouting: { enabled: false, suggestMinConfidence: 0.6, topK: 3 },
      persons: { useAppointment: false },
      aiFeatures: { promptInjectionGuardEnabled: false },
    } as unknown as TypedConfigService;
    svc = new SkillRoutingService(prisma, llm, embeddings, metrics, cfg);

    const result = await svc.suggestAssignee({
      tenantId: TENANT,
      taskText: 'заказать канцелярию',
    });

    expect(result).toEqual([]);
    expect(embedMock).not.toHaveBeenCalled();
    expect(llmCallMock).not.toHaveBeenCalled();
    expect(personFindManyMock).not.toHaveBeenCalled();
  });
});
