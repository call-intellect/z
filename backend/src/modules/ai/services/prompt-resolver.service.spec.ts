import { describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';

import { PromptResolverService } from './prompt-resolver.service';

/**
 * Тесты PromptResolverService — Фаза A.1.
 *
 * Проверяемые кейсы:
 *  1. db_org override — найден активный шаблон scope=org → возвращаем его.
 *  2. db_system fallback — нет org-шаблона, есть system → возвращаем системный.
 *  3. code_fallback на db_empty — нет ни org, ни system → code-fallback.
 *  4. code_fallback на db_error — Prisma бросает → code-fallback + warn.
 *  5. meetingType fallback — для tasks/chapters/follow-up ищется шаблон
 *     с meetingType=null (универсальный), когда точного meetingType нет.
 */

interface DbTemplate {
  id: string;
  scope: 'system' | 'org';
  orgId: string | null;
  key: string;
  status: 'active' | 'draft' | 'archived';
  meetingType: string | null;
  taskType: string;
  activeVersion: {
    id: string;
    systemPrompt: string;
    outputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
    toolName: string | null;
    sections: Array<{
      key: string;
      title: string;
      instruction: string;
      outputType: string;
      required: boolean;
      maxTokens: number | null;
      order: number;
      versionId: string;
      id: string;
    }>;
  } | null;
}

function mkTemplate(overrides: Partial<DbTemplate>): DbTemplate {
  return {
    id: 'tpl-1',
    scope: 'system',
    orgId: null,
    key: 'type-sales',
    status: 'active',
    meetingType: 'sales',
    taskType: 'summary',
    activeVersion: {
      id: 'ver-1',
      systemPrompt: 'Системный промпт из БД',
      outputSchema: {
        type: 'object',
        properties: { pain: { type: 'string' } },
        required: ['pain'],
      },
      toolName: 'extract_sales',
      sections: [
        {
          id: 's-1',
          versionId: 'ver-1',
          key: 'pain',
          title: 'Pain',
          instruction: 'Опиши боль клиента.',
          outputType: 'text',
          required: true,
          maxTokens: null,
          order: 1,
        },
      ],
    },
    ...overrides,
  };
}

function buildPrismaMock(templatesFound: DbTemplate[] | Error): PrismaService {
  const findFirst = vi.fn(async (args: { where: { orgId: string | null; meetingType?: string | null } }) => {
    if (templatesFound instanceof Error) throw templatesFound;
    return (
      templatesFound.find(
        (t) =>
          t.orgId === args.where.orgId &&
          (args.where.meetingType === undefined ||
            t.meetingType === args.where.meetingType ||
            (args.where.meetingType === null && t.meetingType === null)),
      ) ?? null
    );
  });
  return {
    promptTemplate: { findFirst },
  } as unknown as PrismaService;
}

function buildMetricsMock(): BusinessMetricsService & {
  incPromptResolver: ReturnType<typeof vi.fn>;
  incPromptResolverFallback: ReturnType<typeof vi.fn>;
} {
  return {
    incPromptResolver: vi.fn(),
    incPromptResolverFallback: vi.fn(),
  } as unknown as BusinessMetricsService & {
    incPromptResolver: ReturnType<typeof vi.fn>;
    incPromptResolverFallback: ReturnType<typeof vi.fn>;
  };
}

describe('PromptResolverService', () => {
  it('возвращает db_org, если найден активный org-override', async () => {
    const orgTpl = mkTemplate({
      id: 'tpl-org',
      scope: 'org',
      orgId: 'org-1',
      key: 'sales-custom',
      activeVersion: {
        id: 'ver-org',
        systemPrompt: 'Org-промпт',
        outputSchema: { type: 'object', properties: { pain: { type: 'string' } } },
        toolName: 'extract_sales',
        sections: [],
      },
    });
    const prisma = buildPrismaMock([orgTpl]);
    const metrics = buildMetricsMock();
    const service = new PromptResolverService(prisma, metrics);

    const result = await service.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingType: 'sales',
      taskType: 'summary',
    });

    expect(result.source).toBe('db_org');
    expect(result.versionId).toBe('ver-org');
    expect(result.systemPrompt).toBe('Org-промпт');
    expect(metrics.incPromptResolver).toHaveBeenCalledWith({ source: 'db_org' });
  });

  it('фоллбек на db_system, если нет org-override', async () => {
    const sysTpl = mkTemplate({});
    const prisma = buildPrismaMock([sysTpl]);
    const metrics = buildMetricsMock();
    const service = new PromptResolverService(prisma, metrics);

    const result = await service.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingType: 'sales',
      taskType: 'summary',
    });

    expect(result.source).toBe('db_system');
    expect(result.versionId).toBe('ver-1');
    expect(metrics.incPromptResolver).toHaveBeenCalledWith({ source: 'db_system' });
  });

  it('code_fallback, если в БД нет ни org, ни system шаблона', async () => {
    const prisma = buildPrismaMock([]);
    const metrics = buildMetricsMock();
    const service = new PromptResolverService(prisma, metrics);

    const result = await service.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingType: 'sales',
      taskType: 'summary',
    });

    expect(result.source).toBe('code_fallback');
    expect(result.versionId).toBeNull();
    // Проверяем, что system-промпт из встроенного code-модуля type-sales.ts
    // действительно про продажи (Z-AI-agent-rules: code-fallback ОБЯЗАТЕЛЕН).
    // ТЗ consolidation Ф3.2 (A2): роль «аналитик продаж в Коре».
    expect(result.systemPrompt).toContain('аналитик продаж');
    expect(result.toolName).toBe('extract_sales');
    expect(metrics.incPromptResolverFallback).toHaveBeenCalledWith({ reason: 'db_empty' });
    expect(metrics.incPromptResolver).toHaveBeenCalledWith({ source: 'code_fallback' });
  });

  it('code_fallback при ошибке БД (db_error)', async () => {
    const prisma = buildPrismaMock(new Error('connection lost'));
    const metrics = buildMetricsMock();
    const service = new PromptResolverService(prisma, metrics);

    const result = await service.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingType: 'team',
      taskType: 'summary',
    });

    expect(result.source).toBe('code_fallback');
    expect(result.versionId).toBeNull();
    expect(result.toolName).toBe('extract_team');
    expect(metrics.incPromptResolverFallback).toHaveBeenCalledWith({ reason: 'db_error' });
  });

  it('возвращает универсальный шаблон (meetingType=null) для tasks', async () => {
    const universalTasks = mkTemplate({
      id: 'tpl-tasks',
      key: 'tasks-default',
      meetingType: null,
      taskType: 'tasks',
      activeVersion: {
        id: 'ver-tasks',
        systemPrompt: 'Tasks default',
        outputSchema: { type: 'object', properties: { tasks: { type: 'array' } } },
        toolName: 'extract_tasks',
        sections: [],
      },
    });
    const prisma = buildPrismaMock([universalTasks]);
    const metrics = buildMetricsMock();
    const service = new PromptResolverService(prisma, metrics);

    const result = await service.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingType: 'team',
      taskType: 'tasks',
    });

    expect(result.source).toBe('db_system');
    expect(result.versionId).toBe('ver-tasks');
    expect(result.systemPrompt).toBe('Tasks default');
  });

  it('никогда не бросает: работает без метрик-сервиса', async () => {
    const prisma = buildPrismaMock(new Error('boom'));
    const service = new PromptResolverService(prisma, undefined);
    const result = await service.resolveForMeeting({
      tenantId: 'org-1',
      meetingId: 'm-1',
      meetingType: 'sales',
      taskType: 'summary',
    });
    expect(result.source).toBe('code_fallback');
  });
});
