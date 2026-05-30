/**
 * Unit-тесты `TeamHealthService` (Pulse Wave 1 §1.6).
 *
 * Покрывают:
 *   - 0 отделов → пустой teams + totalDepartments=0;
 *   - отдел <3 чел. → belowCohort=true, все attrs neutral;
 *   - sentiment с положительным/отрицательным/нулевым индексом и tone;
 *   - promises: tone + trend по дельте;
 *   - conflicts: 0 / 1-2 / >2 → success / warning / danger;
 *   - кэш-hit (Prisma не дёргается);
 *   - graceful fallback при ошибке Redis.get.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { OperationsTeamTemperatureDto } from '../../operations/dto/operations-dashboard.dto';
import type { OperationsDashboardService } from '../../operations/services/operations-dashboard.service';

import type { CommitmentReliabilityService } from './commitment-reliability.service';
import {
  TeamHealthService,
  type TeamHealthDto,
} from './team-health.service';

interface DepartmentRow {
  id: string;
  name: string;
  persons: Array<{ id: string; entityId: string | null }>;
}

interface ConflictRow {
  fromEntityId: string;
  toEntityId: string;
}

function buildService(opts: {
  departments?: DepartmentRow[];
  conflicts?: ConflictRow[];
  temperature?: OperationsTeamTemperatureDto;
  reliabilityByDept?: Record<
    string,
    { reliabilityPercent: number; delta14d: number | null }
  >;
  cacheValue?: string | null;
  cacheGetError?: Error;
  cacheSetError?: Error;
} = {}): {
  service: TeamHealthService;
  deptFindMany: ReturnType<typeof vi.fn>;
  entityLinkFindMany: ReturnType<typeof vi.fn>;
  redisGet: ReturnType<typeof vi.fn>;
  redisSet: ReturnType<typeof vi.fn>;
  commitsGet: ReturnType<typeof vi.fn>;
  opsGet: ReturnType<typeof vi.fn>;
} {
  const deptFindMany = vi.fn(async () => opts.departments ?? []);
  const entityLinkFindMany = vi.fn(async () => opts.conflicts ?? []);
  const prisma = {
    department: { findMany: deptFindMany },
    entityLink: { findMany: entityLinkFindMany },
  } as unknown as PrismaService;

  const redisGet = vi.fn(async () => {
    if (opts.cacheGetError) throw opts.cacheGetError;
    return opts.cacheValue ?? null;
  });
  const redisSet = vi.fn(async () => {
    if (opts.cacheSetError) throw opts.cacheSetError;
    return 'OK';
  });
  const redis = {
    client: { get: redisGet, set: redisSet },
  } as unknown as RedisService;

  const opsGet = vi.fn(async () =>
    opts.temperature ?? {
      days: 7,
      totalCheckIns: 0,
      greenShare: 0,
      yellowShare: 0,
      redShare: 0,
      redShareDelta: null,
      byPerson: [],
    },
  );
  const ops = {
    getTeamTemperature: opsGet,
  } as unknown as OperationsDashboardService;

  const commitsGet = vi.fn(async (args: { tenantId: string; scopeId?: string }) => {
    const dflt = { reliabilityPercent: 0, delta14d: null as number | null };
    const r = opts.reliabilityByDept?.[args.scopeId ?? ''] ?? dflt;
    return {
      scope: 'team' as const,
      scopeId: args.scopeId ?? null,
      windowDays: 14,
      kept: 0,
      broken: 0,
      overdue: 0,
      pendingActive: 0,
      reliabilityPercent: r.reliabilityPercent,
      delta14d: r.delta14d,
      sparkline12w: [],
    };
  });
  const commits = {
    getReliability: commitsGet,
  } as unknown as CommitmentReliabilityService;

  const service = new TeamHealthService(prisma, redis, commits, ops);

  return {
    service,
    deptFindMany,
    entityLinkFindMany,
    redisGet,
    redisSet,
    commitsGet,
    opsGet,
  };
}

function emptyTemperature(): OperationsTeamTemperatureDto {
  return {
    days: 7,
    totalCheckIns: 0,
    greenShare: 0,
    yellowShare: 0,
    redShare: 0,
    redShareDelta: null,
    byPerson: [],
  };
}

describe('TeamHealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('0 отделов → teams=[], totalDepartments=0', async () => {
    const { service } = buildService({ departments: [] });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res).toEqual<TeamHealthDto>({ teams: [], totalDepartments: 0 });
  });

  it('отдел с 2 чел. → belowCohort=true, все attrs neutral', async () => {
    const { service, commitsGet } = buildService({
      departments: [
        {
          id: 'd-1',
          name: 'Маленький отдел',
          persons: [
            { id: 'p-1', entityId: null },
            { id: 'p-2', entityId: null },
          ],
        },
      ],
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res.teams).toHaveLength(1);
    const row = res.teams[0]!;
    expect(row.belowCohort).toBe(true);
    expect(row.size).toBe(2);
    expect(row.sentiment).toEqual({ value: 0, tone: 'neutral' });
    expect(row.promises).toEqual({ value: 0, tone: 'neutral' });
    expect(row.conflicts).toEqual({ value: 0, tone: 'neutral' });
    expect(row.decisions).toEqual({ value: 0, tone: 'neutral' });
    // CommitmentReliabilityService не вызывался для below-cohort отделов.
    expect(commitsGet).not.toHaveBeenCalled();
  });

  it('отдел 3+ чел. с 2 green + 1 red → sentiment value=33, tone=success', async () => {
    const persons = [
      { id: 'p-1', entityId: null },
      { id: 'p-2', entityId: null },
      { id: 'p-3', entityId: null },
    ];
    const temperature: OperationsTeamTemperatureDto = {
      ...emptyTemperature(),
      byPerson: [
        { personId: 'p-1', personName: 'A', green: 1, yellow: 0, red: 0, total: 1 },
        { personId: 'p-2', personName: 'B', green: 1, yellow: 0, red: 0, total: 1 },
        { personId: 'p-3', personName: 'C', green: 0, yellow: 0, red: 1, total: 1 },
      ],
    };
    const { service } = buildService({
      departments: [{ id: 'd-1', name: 'Отдел', persons }],
      temperature,
      reliabilityByDept: { 'd-1': { reliabilityPercent: 85, delta14d: null } },
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    const row = res.teams[0]!;
    expect(row.belowCohort).toBe(false);
    // (green - red) / total = (2-1)/3 = 0.333 → 33
    expect(row.sentiment.value).toBe(33);
    expect(row.sentiment.tone).toBe('success');
  });

  it('sentiment value=-50 → tone=danger', async () => {
    const persons = [
      { id: 'p-1', entityId: null },
      { id: 'p-2', entityId: null },
      { id: 'p-3', entityId: null },
      { id: 'p-4', entityId: null },
    ];
    const temperature: OperationsTeamTemperatureDto = {
      ...emptyTemperature(),
      byPerson: [
        { personId: 'p-1', personName: 'A', green: 0, yellow: 0, red: 2, total: 2 },
        { personId: 'p-2', personName: 'B', green: 1, yellow: 0, red: 1, total: 2 },
        // (1 - 3) / 4 = -0.5 → -50
      ],
    };
    const { service } = buildService({
      departments: [{ id: 'd-1', name: 'Отдел', persons }],
      temperature,
      reliabilityByDept: { 'd-1': { reliabilityPercent: 90, delta14d: null } },
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res.teams[0]!.sentiment.value).toBe(-50);
    expect(res.teams[0]!.sentiment.tone).toBe('danger');
  });

  it('sentiment value 1..29 → tone=warning', async () => {
    const persons = [
      { id: 'p-1', entityId: null },
      { id: 'p-2', entityId: null },
      { id: 'p-3', entityId: null },
    ];
    // 3 green + 2 red → (3-2)/5 = 20% → tone=warning
    const temperature: OperationsTeamTemperatureDto = {
      ...emptyTemperature(),
      byPerson: [
        { personId: 'p-1', personName: 'A', green: 1, yellow: 0, red: 1, total: 2 },
        { personId: 'p-2', personName: 'B', green: 1, yellow: 0, red: 1, total: 2 },
        { personId: 'p-3', personName: 'C', green: 1, yellow: 0, red: 0, total: 1 },
      ],
    };
    const { service } = buildService({
      departments: [{ id: 'd-1', name: 'Отдел', persons }],
      temperature,
      reliabilityByDept: { 'd-1': { reliabilityPercent: 90, delta14d: null } },
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res.teams[0]!.sentiment.value).toBe(20);
    expect(res.teams[0]!.sentiment.tone).toBe('warning');
  });

  it('promises=85, delta=null → tone=success, нет trend', async () => {
    const persons = [
      { id: 'p-1', entityId: null },
      { id: 'p-2', entityId: null },
      { id: 'p-3', entityId: null },
    ];
    const { service } = buildService({
      departments: [{ id: 'd-1', name: 'Отдел', persons }],
      reliabilityByDept: { 'd-1': { reliabilityPercent: 85, delta14d: null } },
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res.teams[0]!.promises.value).toBe(85);
    expect(res.teams[0]!.promises.tone).toBe('success');
    expect(res.teams[0]!.promises.trend).toBeUndefined();
    expect(res.teams[0]!.promises.delta).toBeNull();
  });

  it('promises=50, delta=10 → tone=danger, trend=up', async () => {
    const persons = [
      { id: 'p-1', entityId: null },
      { id: 'p-2', entityId: null },
      { id: 'p-3', entityId: null },
    ];
    const { service } = buildService({
      departments: [{ id: 'd-1', name: 'Отдел', persons }],
      reliabilityByDept: { 'd-1': { reliabilityPercent: 50, delta14d: 10 } },
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res.teams[0]!.promises.tone).toBe('danger');
    expect(res.teams[0]!.promises.trend).toBe('up');
    expect(res.teams[0]!.promises.delta).toBe(10);
  });

  it('conflicts: 0 → success, 1 → warning, 5 → danger', async () => {
    const makeRow = (
      id: string,
      entityIds: string[],
    ): DepartmentRow => ({
      id,
      name: id,
      persons: [
        { id: `${id}-p1`, entityId: entityIds[0] ?? `${id}-e1` },
        { id: `${id}-p2`, entityId: entityIds[1] ?? `${id}-e2` },
        { id: `${id}-p3`, entityId: entityIds[2] ?? `${id}-e3` },
      ],
    });
    const conflicts: ConflictRow[] = [
      { fromEntityId: 'd-warn-e1', toEntityId: 'other-1' },
      { fromEntityId: 'd-dang-e1', toEntityId: 'other-2' },
      { fromEntityId: 'd-dang-e2', toEntityId: 'other-3' },
      { fromEntityId: 'd-dang-e3', toEntityId: 'other-4' },
      { fromEntityId: 'd-dang-e1', toEntityId: 'other-5' },
      { fromEntityId: 'd-dang-e1', toEntityId: 'other-6' },
    ];
    const { service } = buildService({
      departments: [
        makeRow('d-ok', []),
        makeRow('d-warn', []),
        makeRow('d-dang', []),
      ],
      conflicts,
      reliabilityByDept: {
        'd-ok': { reliabilityPercent: 90, delta14d: null },
        'd-warn': { reliabilityPercent: 90, delta14d: null },
        'd-dang': { reliabilityPercent: 90, delta14d: null },
      },
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    const byId = new Map(res.teams.map((t) => [t.departmentId, t]));
    expect(byId.get('d-ok')!.conflicts.value).toBe(0);
    expect(byId.get('d-ok')!.conflicts.tone).toBe('success');
    expect(byId.get('d-warn')!.conflicts.value).toBe(1);
    expect(byId.get('d-warn')!.conflicts.tone).toBe('warning');
    expect(byId.get('d-dang')!.conflicts.value).toBe(5);
    expect(byId.get('d-dang')!.conflicts.tone).toBe('danger');
  });

  it('cache hit → Prisma не дёргается', async () => {
    const cached: TeamHealthDto = {
      teams: [],
      totalDepartments: 0,
    };
    const { service, deptFindMany, entityLinkFindMany, opsGet, commitsGet } =
      buildService({
        cacheValue: JSON.stringify(cached),
      });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res).toEqual(cached);
    expect(deptFindMany).not.toHaveBeenCalled();
    expect(entityLinkFindMany).not.toHaveBeenCalled();
    expect(opsGet).not.toHaveBeenCalled();
    expect(commitsGet).not.toHaveBeenCalled();
  });

  it('Redis.get падает → fallback на Prisma (не падает)', async () => {
    const { service, deptFindMany } = buildService({
      cacheGetError: new Error('redis down'),
      departments: [],
    });
    const res = await service.getHealth({ tenantId: 't-1' });
    expect(res.totalDepartments).toBe(0);
    expect(deptFindMany).toHaveBeenCalledOnce();
  });
});
