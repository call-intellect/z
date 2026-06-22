import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/index';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { RedisService } from '../../../common/redis/redis.service';
import type { LlmRouterService } from '../../ai/services/llm-router.service';
import type { ProvenanceService } from '../../knowledge-core/services/provenance.service';

import { ProgressAutoDraftCron } from './progress-auto-draft.cron';

const draftJson = JSON.stringify({
  health: 'on_track',
  body: 'Задача движется: закрыто два пункта чек-листа.',
  doneText: 'Закрыты два пункта.',
  nextText: 'Доделать оставшееся.',
  confidence: 0.8,
});

function makeCfg(overrides?: Record<string, unknown>): TypedConfigService {
  return {
    getDynamic: async <T>(key: string, _e: string | undefined, def: T): Promise<T> => {
      if (overrides && key in overrides) return overrides[key] as T;
      return def;
    },
    resolveSync: <T>(_k: string, _e: string | undefined, def: T): T => def,
  } as unknown as TypedConfigService;
}

describe('ProgressAutoDraftCron', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let llm: LlmRouterService;
  let provenance: ProvenanceService;
  let cron: ProgressAutoDraftCron;

  let orgFindMany: ReturnType<typeof vi.fn>;
  let issueFindMany: ReturnType<typeof vi.fn>;
  let issueFindFirst: ReturnType<typeof vi.fn>;
  let progressFindFirst: ReturnType<typeof vi.fn>;
  let progressCreate: ReturnType<typeof vi.fn>;
  let checklistFindMany: ReturnType<typeof vi.fn>;
  let activityFindMany: ReturnType<typeof vi.fn>;
  let candidateFindMany: ReturnType<typeof vi.fn>;
  let redisSet: ReturnType<typeof vi.fn>;
  let llmCall: ReturnType<typeof vi.fn>;
  let computeSnapshot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    orgFindMany = vi.fn().mockResolvedValue([{ id: 'org_1' }]);
    issueFindMany = vi.fn().mockResolvedValue([
      {
        id: 'issue_1',
        tenantId: 'org_1',
        title: 'Сверстать лендинг',
        descriptionStripped: null,
      },
    ]);
    issueFindFirst = vi.fn().mockResolvedValue({
      id: 'issue_1',
      tenantId: 'org_1',
      title: 'Сверстать лендинг',
      descriptionStripped: null,
    });
    progressFindFirst = vi.fn().mockImplementation(
      async (args: { where?: { draftState?: unknown } }) => {
        if (args?.where?.draftState === 'pending') return null;
        return null;
      },
    );
    progressCreate = vi.fn().mockResolvedValue({ id: 'pu_1' });
    checklistFindMany = vi.fn().mockResolvedValue([
      { text: 'Шапка', completedAt: new Date() },
      { text: 'Футер', completedAt: new Date() },
    ]);
    activityFindMany = vi.fn().mockResolvedValue([]);
    candidateFindMany = vi.fn().mockResolvedValue([
      { sourceBlockId: 'block_1', evidenceQuote: 'на встрече сказали, что лендинг почти готов' },
    ]);
    redisSet = vi.fn().mockResolvedValue('OK');
    llmCall = vi.fn().mockResolvedValue({ text: draftJson });
    computeSnapshot = vi.fn().mockResolvedValue({
      previewQuote: 'на встрече сказали, что лендинг почти готов',
      previewSourceRef: {
        evidenceId: 'ev_1',
        blockId: 'block_1',
        sourceType: 'meeting',
        refId: 'meet_1',
        startMs: 12000,
        deepLink: '/meetings/meet_1?t=12',
        attribution: 'quoted',
        label: 'Планёрка',
      },
    });

    prisma = {
      org: { findMany: orgFindMany },
      issue: { findMany: issueFindMany, findFirst: issueFindFirst },
      issueProgressUpdate: { findFirst: progressFindFirst, create: progressCreate },
      issueChecklistItem: { findMany: checklistFindMany },
      issueActivity: { findMany: activityFindMany },
      taskClosureCandidate: { findMany: candidateFindMany },
    } as unknown as PrismaService;
    redis = { client: { set: redisSet } } as unknown as RedisService;
    llm = { call: llmCall } as unknown as LlmRouterService;
    provenance = {
      computePreviewSnapshot: computeSnapshot,
    } as unknown as ProvenanceService;

    cron = new ProgressAutoDraftCron(prisma, redis, makeCfg(), llm, provenance);
  });

  it('задача с 2 закрытыми пунктами + упоминанием в графе — создаёт pending-черновик с непустыми sourceBlockIds', async () => {
    const res = await cron.run();
    expect(res.drafted).toBe(1);
    expect(progressCreate).toHaveBeenCalledTimes(1);
    const data = progressCreate.mock.calls[0]![0].data;
    expect(data.authorType).toBe('ai_agent');
    expect(data.draftState).toBe('pending');
    expect(data.health).toBe('on_track');
    expect(data.sourceBlockIds).toEqual(['block_1']);
    expect(data.previewQuote).toBe('на встрече сказали, что лендинг почти готов');
    expect(data.previewSourceRef).toMatchObject({ deepLink: '/meetings/meet_1?t=12' });
    expect(computeSnapshot).toHaveBeenCalledWith('org_1', ['block_1']);
  });

  it('повторный прогон в тот же день — no-op (Redis dedup)', async () => {
    redisSet.mockResolvedValueOnce(null);
    const res = await cron.run();
    expect(res.dedupSkipped).toBe(1);
    expect(res.drafted).toBe(0);
    expect(progressCreate).not.toHaveBeenCalled();
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('сигналов меньше порога — черновик не создаётся', async () => {
    checklistFindMany.mockResolvedValueOnce([{ text: 'Шапка', completedAt: new Date() }]);
    candidateFindMany.mockResolvedValueOnce([]);
    const res = await cron.run();
    expect(res.belowThreshold).toBe(1);
    expect(res.drafted).toBe(0);
    expect(progressCreate).not.toHaveBeenCalled();
  });

  it('уже есть pending-черновик — пропуск (не плодим второй)', async () => {
    progressFindFirst.mockImplementation(
      async (args: { where?: { draftState?: unknown } }) => {
        if (args?.where?.draftState === 'pending') return { id: 'existing' };
        return null;
      },
    );
    const res = await cron.run();
    expect(res.existingPendingSkipped).toBe(1);
    expect(res.drafted).toBe(0);
    expect(redisSet).not.toHaveBeenCalled();
    expect(progressCreate).not.toHaveBeenCalled();
  });

  it('kill-switch OFF — runScheduled не запускает проход', async () => {
    cron = new ProgressAutoDraftCron(
      prisma,
      redis,
      makeCfg({ 'tracker.progressAutoDraftEnabled': false }),
      llm,
      provenance,
    );
    await cron.runScheduled();
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(progressCreate).not.toHaveBeenCalled();
  });

  it('без графа (нет блоков) — снимок провенанса пустой, sourceBlockIds пуст', async () => {
    candidateFindMany.mockResolvedValueOnce([]);
    checklistFindMany.mockResolvedValueOnce([
      { text: 'Шапка', completedAt: new Date() },
      { text: 'Футер', completedAt: new Date() },
    ]);
    const res = await cron.run();
    expect(res.drafted).toBe(1);
    const data = progressCreate.mock.calls[0]![0].data;
    expect(data.sourceBlockIds).toEqual([]);
    expect(data.previewQuote).toBeNull();
    expect(computeSnapshot).not.toHaveBeenCalled();
  });

  it('событийный путь — onProgressSignal создаёт pending-черновик без крона', async () => {
    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_42',
    });
    expect(orgFindMany).not.toHaveBeenCalled();
    expect(issueFindFirst).toHaveBeenCalledTimes(1);
    expect(progressCreate).toHaveBeenCalledTimes(1);
    const data = progressCreate.mock.calls[0]![0].data;
    expect(data.authorType).toBe('ai_agent');
    expect(data.draftState).toBe('pending');
    expect(redisSet.mock.calls[0]![0]).toBe('progress_auto_draft:issue_1:block_42');
  });

  it('событийный путь — поблочный дедуп: тот же sourceBlockId дважды не плодит дубль', async () => {
    const acquired = new Set<string>();
    redisSet.mockImplementation(async (key: string) => {
      if (acquired.has(key)) return null;
      acquired.add(key);
      return 'OK';
    });

    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_42',
    });
    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_42',
    });

    expect(progressCreate).toHaveBeenCalledTimes(1);
  });

  it('событийный путь — разные sourceBlockId в один день создают два черновика (не суточный дедуп)', async () => {
    const acquired = new Set<string>();
    redisSet.mockImplementation(async (key: string) => {
      if (acquired.has(key)) return null;
      acquired.add(key);
      return 'OK';
    });

    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_a',
    });
    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_b',
    });

    expect(progressCreate).toHaveBeenCalledTimes(2);
  });

  it('событийный путь — задача в backlog обрабатывается (нет фильтра started)', async () => {
    issueFindFirst.mockResolvedValueOnce({
      id: 'issue_backlog',
      tenantId: 'org_1',
      title: 'Идея в бэклоге',
      descriptionStripped: null,
    });
    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_backlog',
      sourceBlockId: 'block_7',
    });
    expect(progressCreate).toHaveBeenCalledTimes(1);
    expect(progressCreate.mock.calls[0]![0].data.issueId).toBe('issue_backlog');
  });

  it('событийный путь — задачи нет (другой tenant/удалена) — no-op', async () => {
    issueFindFirst.mockResolvedValueOnce(null);
    await cron.onProgressSignal({
      tenantId: 'org_other',
      issueId: 'issue_1',
      sourceBlockId: 'block_42',
    });
    expect(progressCreate).not.toHaveBeenCalled();
    expect(llmCall).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('событийный путь — уже есть pending-черновик — новый не создаём', async () => {
    progressFindFirst.mockImplementation(
      async (args: { where?: { draftState?: unknown } }) => {
        if (args?.where?.draftState === 'pending') return { id: 'existing' };
        return null;
      },
    );
    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_42',
    });
    expect(progressCreate).not.toHaveBeenCalled();
    expect(redisSet).not.toHaveBeenCalled();
  });

  it('событийный путь — kill-switch OFF — ничего не делаем', async () => {
    cron = new ProgressAutoDraftCron(
      prisma,
      redis,
      makeCfg({ 'tracker.progressAutoDraftEnabled': false }),
      llm,
      provenance,
    );
    await cron.onProgressSignal({
      tenantId: 'org_1',
      issueId: 'issue_1',
      sourceBlockId: 'block_42',
    });
    expect(issueFindFirst).not.toHaveBeenCalled();
    expect(progressCreate).not.toHaveBeenCalled();
  });
});
