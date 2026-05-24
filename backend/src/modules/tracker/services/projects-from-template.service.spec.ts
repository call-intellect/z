import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { BusinessMetricsService } from '../../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateFromTemplateDto } from '../dto/projects/create-from-template.dto';

import { ProjectsFromTemplateService } from './projects-from-template.service';

/**
 * Покрываем:
 *   1. 404, если шаблон не найден.
 *   2. 409, если slug проекта уже занят.
 *   3. Happy path: создаются Project + states + 1 member; usageCount++;
 *      метрика team_template_used.
 *   4. withExampleTasks=true → создаются Issue (до 3).
 */

const SYSTEM_TEMPLATE = {
  id: 'tmpl-sales-1',
  slug: 'sales',
  description: 'Команда продаж',
  definition: {
    roles: [
      {
        key: 'sales_manager',
        name: 'Менеджер по продажам',
        responsibilities: ['Ведёт сделки', 'Заполняет CRM'],
      },
    ],
    states: [
      { key: 'backlog', name: 'Новый лид', category: 'backlog', color: '#94A3B8', sequence: 1 },
      { key: 'in_progress', name: 'В работе', category: 'started', color: '#3B82F6', sequence: 2 },
      { key: 'done', name: 'Сделка', category: 'completed', color: '#10B981', sequence: 3 },
    ],
    typicalTasks: [
      { title: 'Задача-1', stateKey: 'backlog', estimatePoints: 1, priority: 'high' },
      { title: 'Задача-2', stateKey: 'in_progress', estimatePoints: 2, priority: 'medium' },
      { title: 'Задача-3', stateKey: 'in_progress', estimatePoints: 3, priority: 'low' },
      { title: 'Задача-4 (за лимитом)', stateKey: 'done' },
    ],
    regulationStubs: ['Скрипт первого звонка', 'Регламент CRM'],
    kpiTemplates: [{ name: 'Выручка', frequency: 'monthly' }],
  },
};

interface MockOpts {
  /** Что вернуть из teamTemplate.findFirst (как кортеж сценариев). */
  templateLookups?: Array<typeof SYSTEM_TEMPLATE | null>;
  /** Существует ли уже project с таким slug. */
  slugTaken?: boolean;
  /** Существует ли уже project с identifier. */
  identifierTaken?: boolean;
}

function makeMockPrisma(opts: MockOpts = {}): {
  prisma: PrismaService;
  txCalls: {
    projectCreate: ReturnType<typeof vi.fn>;
    stateCreate: ReturnType<typeof vi.fn>;
    memberCreate: ReturnType<typeof vi.fn>;
    issueCreate: ReturnType<typeof vi.fn>;
    teamTemplateUpdate: ReturnType<typeof vi.fn>;
    regulationCreate: ReturnType<typeof vi.fn>;
  };
} {
  const lookups = [...(opts.templateLookups ?? [SYSTEM_TEMPLATE])];
  const teamTemplateFindFirst = vi.fn(async () => lookups.shift() ?? null);
  const projectFindUnique = vi.fn(async (args: { where: Record<string, unknown> }) => {
    if ('tenantId_slug' in args.where) return opts.slugTaken ? { id: 'p-existing' } : null;
    return null;
  });
  const projectFindFirst = vi.fn(async (_args: { where: Record<string, unknown> }) => {
    return opts.identifierTaken ? { id: 'p-existing' } : null;
  });

  let projectIdCounter = 0;
  const projectCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: `proj-${++projectIdCounter}`,
    ...args.data,
  }));
  const projectUpdate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'proj-1',
    ...args.data,
  }));
  let stateIdCounter = 0;
  const stateCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: `state-${++stateIdCounter}`,
    ...args.data,
  }));
  const memberCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'pm-1',
    ...args.data,
  }));
  const issueCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: `iss-${args.data.sequenceId as number}`,
    ...args.data,
  }));
  const teamTemplateUpdate = vi.fn(async () => ({ id: 'tmpl-sales-1', usageCount: 1 }));
  const regulationFindUnique = vi.fn(async () => null);
  const regulationCreate = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: 'reg-1',
    ...args.data,
  }));

  const txClient = {
    project: { create: projectCreate, update: projectUpdate },
    issueState: { create: stateCreate },
    projectMember: { create: memberCreate },
    issue: { create: issueCreate },
    teamTemplate: { update: teamTemplateUpdate },
    regulation: { findUnique: regulationFindUnique, create: regulationCreate },
  };

  const $transaction = vi.fn(async (cb: any) => cb(txClient));

  const prisma = {
    $transaction,
    teamTemplate: { findFirst: teamTemplateFindFirst },
    project: { findUnique: projectFindUnique, findFirst: projectFindFirst },
  } as unknown as PrismaService;

  return {
    prisma,
    txCalls: {
      projectCreate,
      stateCreate,
      memberCreate,
      issueCreate,
      teamTemplateUpdate,
      regulationCreate,
    },
  };
}

function makeService(opts: MockOpts = {}): {
  svc: ProjectsFromTemplateService;
  metrics: { incTeamTemplateUsed: ReturnType<typeof vi.fn> };
  txCalls: ReturnType<typeof makeMockPrisma>['txCalls'];
} {
  const { prisma, txCalls } = makeMockPrisma(opts);
  const metrics = {
    incTeamTemplateUsed: vi.fn(),
  };
  const svc = new ProjectsFromTemplateService(
    prisma,
    metrics as unknown as BusinessMetricsService,
  );
  return { svc, metrics, txCalls };
}

const BASE_DTO: CreateFromTemplateDto = {
  templateSlug: 'sales',
  projectName: 'Продажи Москва',
  identifier: 'SALES',
  withExampleTasks: false,
};

describe('ProjectsFromTemplateService.createFromTemplate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('кидает 404 если шаблон не найден ни в tenant, ни в system', async () => {
    const { svc } = makeService({ templateLookups: [null, null] });
    await expect(
      svc.createFromTemplate({
        tenantId: 'tenant-A',
        userId: 'user-1',
        dto: BASE_DTO,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('кидает 409 если slug проекта уже занят', async () => {
    const { svc } = makeService({
      templateLookups: [SYSTEM_TEMPLATE],
      slugTaken: true,
    });
    await expect(
      svc.createFromTemplate({
        tenantId: 'tenant-A',
        userId: 'user-1',
        dto: BASE_DTO,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('кидает 409 если identifier уже занят', async () => {
    const { svc } = makeService({
      templateLookups: [SYSTEM_TEMPLATE],
      identifierTaken: true,
    });
    await expect(
      svc.createFromTemplate({
        tenantId: 'tenant-A',
        userId: 'user-1',
        dto: BASE_DTO,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('happy path: создаёт Project, 3 state, 1 member, инкрементирует usageCount + метрика', async () => {
    const { svc, metrics, txCalls } = makeService();
    const result = await svc.createFromTemplate({
      tenantId: 'tenant-A',
      userId: 'user-1',
      dto: BASE_DTO,
    });
    expect(result.statesCount).toBe(3);
    expect(result.exampleTasksCount).toBe(0);
    expect(result.regulationStubsCount).toBe(2);
    expect(result.templateSlug).toBe('sales');
    expect(txCalls.projectCreate).toHaveBeenCalledTimes(1);
    expect(txCalls.stateCreate).toHaveBeenCalledTimes(3);
    expect(txCalls.memberCreate).toHaveBeenCalledTimes(1);
    expect(txCalls.teamTemplateUpdate).toHaveBeenCalledWith({
      where: { id: 'tmpl-sales-1' },
      data: { usageCount: { increment: 1 } },
    });
    expect(txCalls.regulationCreate).toHaveBeenCalledTimes(2);
    expect(metrics.incTeamTemplateUsed).toHaveBeenCalledWith({
      tenantTop: expect.any(String),
      slug: 'sales',
    });
  });

  it('withExampleTasks=true → создаёт до 3 примеров (4-я игнорируется)', async () => {
    const { svc, txCalls } = makeService();
    const result = await svc.createFromTemplate({
      tenantId: 'tenant-A',
      userId: 'user-1',
      dto: { ...BASE_DTO, withExampleTasks: true },
    });
    expect(result.exampleTasksCount).toBe(3);
    expect(txCalls.issueCreate).toHaveBeenCalledTimes(3);
  });

  it('per-tenant template побеждает system fallback (первый findFirst возвращает override)', async () => {
    const tenantOverride = {
      ...SYSTEM_TEMPLATE,
      id: 'tmpl-tenant-A-sales',
      description: 'Org-овский шаблон',
    };
    const { svc } = makeService({
      templateLookups: [tenantOverride], // первый вызов = per-tenant → найден, второй не происходит
    });
    const result = await svc.createFromTemplate({
      tenantId: 'tenant-A',
      userId: 'user-1',
      dto: BASE_DTO,
    });
    expect(result.templateSlug).toBe('sales');
  });

  it('timezone передан в DTO → попадает в Project.timezone', async () => {
    const { svc, txCalls } = makeService();
    await svc.createFromTemplate({
      tenantId: 'tenant-A',
      userId: 'user-1',
      dto: { ...BASE_DTO, timezone: 'Asia/Yekaterinburg' },
    });
    expect(txCalls.projectCreate).toHaveBeenCalledTimes(1);
    const projectCreateArgs = txCalls.projectCreate.mock.calls[0]?.[0] as {
      data: { timezone?: string };
    };
    expect(projectCreateArgs.data.timezone).toBe('Asia/Yekaterinburg');
  });

  it('timezone не передан → Project создаётся без явного timezone (schema default Europe/Moscow)', async () => {
    const { svc, txCalls } = makeService();
    await svc.createFromTemplate({
      tenantId: 'tenant-A',
      userId: 'user-1',
      dto: BASE_DTO,
    });
    expect(txCalls.projectCreate).toHaveBeenCalledTimes(1);
    const projectCreateArgs = txCalls.projectCreate.mock.calls[0]?.[0] as {
      data: { timezone?: string };
    };
    // Поле timezone не задано — Prisma применит schema default 'Europe/Moscow'.
    expect(projectCreateArgs.data.timezone).toBeUndefined();
  });
});
