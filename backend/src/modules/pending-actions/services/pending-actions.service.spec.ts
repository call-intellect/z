import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../../common/config/typed-config.service';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { ConversationalService } from '../../conversational/conversational.service';
import type { ConflictService } from '../../curation/services/conflict.service';
import type { CurationService } from '../../curation/services/curation.service';
import type { WorkChatService } from '../../messaging/services/work-chat.service';
import type { RbacService } from '../../rbac/rbac.service';
import type { IntakeService } from '../../tracker/services/intake.service';
import type { IssuesService } from '../../tracker/services/issues.service';
import type { ProgressUpdatesService } from '../../tracker/services/progress-updates.service';
import type { ConflictPendingProvider } from '../providers/conflict.provider';
import type { CurationPendingProvider } from '../providers/curation.provider';
import type { IntakePendingProvider } from '../providers/intake.provider';
import type { PendingActionItem } from '../providers/pending-actions-provider.types';
import type { ProbePendingProvider } from '../providers/probe.provider';
import type { ProgressDraftPendingProvider } from '../providers/progress-draft.provider';
import type { TaskClosurePendingProvider } from '../providers/task-closure.provider';
import type { TaskReviewPendingProvider } from '../providers/task-review.provider';

import { PendingActionsService } from './pending-actions.service';

function item(
  source: PendingActionItem['source'],
  over: Partial<PendingActionItem> = {},
): PendingActionItem {
  return {
    source,
    resourceType: 'x',
    resourceId: 'r',
    title: 't',
    severity: 'normal',
    ageDays: 0,
    actionUrl: '/x',
    canQuickConfirm: false,
    ...over,
  };
}

describe('PendingActionsService (B0)', () => {
  let prisma: PrismaService;
  let svc: PendingActionsService;
  let membershipFindUnique: ReturnType<typeof vi.fn>;
  let snoozeFindMany: ReturnType<typeof vi.fn>;
  let snoozeUpsert: ReturnType<typeof vi.fn>;

  let curation: CurationPendingProvider;
  let conflict: ConflictPendingProvider;
  let intake: IntakePendingProvider;
  let probe: ProbePendingProvider;
  let taskClosure: TaskClosurePendingProvider;
  let taskReview: TaskReviewPendingProvider;
  let progressDraft: ProgressDraftPendingProvider;
  let curationService: CurationService;
  let conflictService: ConflictService;
  let intakeService: IntakeService;
  let conversational: ConversationalService;
  let issuesService: IssuesService;
  let progressUpdatesService: ProgressUpdatesService;
  let workChat: WorkChatService;
  let rbac: RbacService;
  let canWriteMock: ReturnType<typeof vi.fn>;
  let cfg: TypedConfigService;
  let sendNotification: ReturnType<typeof vi.fn>;
  let progressConfirm: ReturnType<typeof vi.fn>;
  let progressReject: ReturnType<typeof vi.fn>;
  let curationItemFindUnique: ReturnType<typeof vi.fn>;
  let taskClosureFindUnique: ReturnType<typeof vi.fn>;
  let taskClosureUpdate: ReturnType<typeof vi.fn>;
  let issueCommentCreate: ReturnType<typeof vi.fn>;
  let txTaskClosureUpdate: ReturnType<typeof vi.fn>;
  let prismaTransaction: ReturnType<typeof vi.fn>;
  let issueFindFirst: ReturnType<typeof vi.fn>;
  let issueUpdate: ReturnType<typeof vi.fn>;
  let issueStateFindFirst: ReturnType<typeof vi.fn>;
  let transitionState: ReturnType<typeof vi.fn>;
  let decide: ReturnType<typeof vi.fn>;
  let resolveConflict: ReturnType<typeof vi.fn>;
  let triage: ReturnType<typeof vi.fn>;
  let respondToProbe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    membershipFindUnique = vi.fn().mockResolvedValue({ role: 'owner' });
    snoozeFindMany = vi.fn().mockResolvedValue([]);
    snoozeUpsert = vi.fn().mockResolvedValue({});
    curationItemFindUnique = vi.fn().mockResolvedValue(null);
    taskClosureFindUnique = vi.fn().mockResolvedValue(null);
    taskClosureUpdate = vi.fn().mockResolvedValue({});
    issueCommentCreate = vi.fn().mockResolvedValue({ id: 'cmt-1' });
    txTaskClosureUpdate = vi.fn().mockResolvedValue({});
    issueFindFirst = vi
      .fn()
      .mockResolvedValue({ id: 'iss-1', projectId: 'proj-1' });
    issueUpdate = vi.fn().mockResolvedValue({ id: 'iss-1' });
    issueStateFindFirst = vi.fn().mockResolvedValue({ id: 'state-done' });
    prismaTransaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        issueComment: { create: issueCommentCreate },
        taskClosureCandidate: { update: txTaskClosureUpdate },
      }),
    );
    prisma = {
      membership: { findUnique: membershipFindUnique },
      pendingActionSnooze: { findMany: snoozeFindMany, upsert: snoozeUpsert },
      curationItem: { findUnique: curationItemFindUnique },
      taskClosureCandidate: {
        findUnique: taskClosureFindUnique,
        update: taskClosureUpdate,
      },
      issue: { findFirst: issueFindFirst, update: issueUpdate },
      issueState: { findFirst: issueStateFindFirst },
      $transaction: prismaTransaction,
    } as unknown as PrismaService;

    decide = vi.fn().mockResolvedValue({ id: 'ci-1', status: 'decided' });
    curationService = { decide } as unknown as CurationService;
    resolveConflict = vi.fn().mockResolvedValue({ id: 'cf-1', status: 'resolved' });
    conflictService = { resolve: resolveConflict } as unknown as ConflictService;
    triage = vi.fn().mockResolvedValue({ intake: { id: 'ii-1' }, createdIssue: null });
    intakeService = { triage } as unknown as IntakeService;
    respondToProbe = vi.fn().mockResolvedValue({ id: 'nt-1', responseStatus: 'answered' });
    sendNotification = vi.fn().mockResolvedValue({ id: 'ntf-1' });
    conversational = {
      respondToProbe,
      sendNotification,
    } as unknown as ConversationalService;
    transitionState = vi.fn().mockResolvedValue({ id: 'iss-1' });
    issuesService = { transitionState } as unknown as IssuesService;
    progressConfirm = vi.fn().mockResolvedValue({ id: 'pu-1', draftState: 'accepted' });
    progressReject = vi.fn().mockResolvedValue({ ok: true });
    progressUpdatesService = {
      confirm: progressConfirm,
      reject: progressReject,
    } as unknown as ProgressUpdatesService;
    workChat = {
      appendMessage: vi.fn().mockResolvedValue({
        messageId: 'msg-1',
        conversationId: 'conv-1',
        seq: '1',
      }),
    } as unknown as WorkChatService;
    cfg = {
      tracker: { closureNotifyCreatorEnabled: true },
    } as unknown as TypedConfigService;
    canWriteMock = vi.fn().mockResolvedValue(true);
    rbac = { canWrite: canWriteMock } as unknown as RbacService;

    curation = {
      source: 'curation',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as CurationPendingProvider;
    conflict = {
      source: 'conflict',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as ConflictPendingProvider;
    intake = {
      source: 'intake',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as IntakePendingProvider;
    probe = {
      source: 'probe',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as ProbePendingProvider;
    taskClosure = {
      source: 'task_closure',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as TaskClosurePendingProvider;
    taskReview = {
      source: 'task_review',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as TaskReviewPendingProvider;
    progressDraft = {
      source: 'progress_draft',
      countForUser: vi.fn().mockResolvedValue(0),
      listForUser: vi.fn().mockResolvedValue([]),
    } as unknown as ProgressDraftPendingProvider;

    svc = new PendingActionsService(
      prisma,
      curation,
      conflict,
      intake,
      probe,
      taskClosure,
      taskReview,
      progressDraft,
      curationService,
      conflictService,
      intakeService,
      conversational,
      issuesService,
      progressUpdatesService,
      workChat,
      rbac,
      cfg,
    );
  });

  it('getCount: total = сумма bySource', async () => {
    (curation.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(3);
    (conflict.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(1);
    (intake.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(2);
    (probe.countForUser as ReturnType<typeof vi.fn>).mockResolvedValue(4);

    const res = await svc.getCount({ tenantId: 't-1', userId: 'u-1' });
    expect(res.bySource).toEqual({
      curation: 3,
      conflict: 1,
      intake: 2,
      probe: 4,
      task_closure: 0,
      task_review: 0,
      progress_draft: 0,
    });
    expect(res.total).toBe(10);
  });

  it('getCount: роль из Membership и snoozed-сет передаются провайдеру', async () => {
    membershipFindUnique.mockResolvedValue({ role: 'manager' });
    snoozeFindMany.mockResolvedValue([
      { source: 'curation', resourceId: 'ci-1' },
      { source: 'probe', resourceId: 'nt-1' },
    ]);
    await svc.getCount({ tenantId: 't-1', userId: 'u-1' });

    const curationArgs = (curation.countForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(curationArgs.role).toBe('manager');
    expect([...curationArgs.snoozedResourceIds]).toEqual(['ci-1']);

    const probeArgs = (probe.countForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect([...probeArgs.snoozedResourceIds]).toEqual(['nt-1']);
  });

  it('getCount: не член Org → role=null', async () => {
    membershipFindUnique.mockResolvedValue(null);
    await svc.getCount({ tenantId: 't-1', userId: 'u-x' });
    const args = (curation.countForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(args.role).toBeNull();
  });

  it('getList: urgent-first, затем ageDays desc, затем limit', async () => {
    (curation.listForUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      item('curation', { resourceId: 'a', severity: 'normal', ageDays: 10 }),
      item('curation', { resourceId: 'b', severity: 'urgent', ageDays: 1 }),
    ]);
    (probe.listForUser as ReturnType<typeof vi.fn>).mockResolvedValue([
      item('probe', { resourceId: 'c', severity: 'urgent', ageDays: 8 }),
      item('probe', { resourceId: 'd', severity: 'normal', ageDays: 2 }),
    ]);

    const { items } = await svc.getList({
      tenantId: 't-1',
      userId: 'u-1',
      limit: 3,
    });
    expect(items.map((i) => i.resourceId)).toEqual(['c', 'b', 'a']);
  });

  it('getList: передаёт limit и snoozed-сет провайдерам', async () => {
    snoozeFindMany.mockResolvedValue([{ source: 'intake', resourceId: 'ii-1' }]);
    await svc.getList({ tenantId: 't-1', userId: 'u-1', limit: 25 });
    const intakeArgs = (intake.listForUser as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(intakeArgs.limit).toBe(25);
    expect([...intakeArgs.snoozedResourceIds]).toEqual(['ii-1']);
  });

  it('snooze: upsert с snoozedUntil = now + hours', async () => {
    const before = Date.now();
    const res = await svc.snooze({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceType: 'regulation',
      resourceId: 'ci-1',
      hours: 24,
    });
    expect(res.ok).toBe(true);
    expect(snoozeUpsert).toHaveBeenCalledTimes(1);
    const call = snoozeUpsert.mock.calls[0]![0];
    expect(call.where.tenantId_userId_source_resourceId).toEqual({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceId: 'ci-1',
    });
    const until = new Date(res.snoozedUntil).getTime();
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000 - 1000);
  });

  it('snooze: hours вне [1..720] → BadRequest', async () => {
    await expect(
      svc.snooze({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceType: 'x',
        resourceId: 'r',
        hours: 0,
      }),
    ).rejects.toThrow();
    await expect(
      svc.snooze({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceType: 'x',
        resourceId: 'r',
        hours: 721,
      }),
    ).rejects.toThrow();
    expect(snoozeUpsert).not.toHaveBeenCalled();
  });

  it('confirm curation: light pending → decide(approve) вызван', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-1',
      tenantId: 't-1',
      status: 'pending',
      level: 'light',
    });
    const res = await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceId: 'ci-1',
    });
    expect(res).toEqual({ ok: true });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0]).toEqual({
      tenantId: 't-1',
      curationItemId: 'ci-1',
      reviewerUserId: 'u-1',
      decisionType: 'approve',
    });
  });

  it('confirm curation: resolution=reject → decide(reject)', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-r',
      tenantId: 't-1',
      status: 'pending',
      level: 'light',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'curation',
      resourceId: 'ci-r',
      resolution: 'reject',
    });
    expect(decide.mock.calls[0]![0].decisionType).toBe('reject');
  });

  it('confirm conflict: keep_old → ConflictService.resolve(keep_old)', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'conflict',
      resourceId: 'cf-1',
      resolution: 'keep_old',
    });
    expect(resolveConflict).toHaveBeenCalledTimes(1);
    expect(resolveConflict.mock.calls[0]![0]).toEqual({
      tenantId: 't-1',
      conflictId: 'cf-1',
      reviewerUserId: 'u-1',
      resolution: 'keep_old',
    });
  });

  it('confirm conflict: без resolution → BadRequest, resolve не вызван', async () => {
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'conflict',
        resourceId: 'cf-2',
      }),
    ).rejects.toThrow();
    expect(resolveConflict).not.toHaveBeenCalled();
  });

  it('confirm intake: accept → IntakeService.triage(accept) c targetProjectId', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'intake',
      resourceId: 'ii-1',
      resolution: 'accept',
      targetProjectId: 'proj-1',
    });
    expect(triage).toHaveBeenCalledTimes(1);
    const [id, dto, tenantId, userId] = triage.mock.calls[0]!;
    expect(id).toBe('ii-1');
    expect(dto).toEqual({ decision: 'accept', targetProjectId: 'proj-1' });
    expect(tenantId).toBe('t-1');
    expect(userId).toBe('u-1');
  });

  it('confirm intake: reject → triage(reject), targetProjectId=null', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'intake',
      resourceId: 'ii-2',
      resolution: 'reject',
    });
    expect(triage.mock.calls[0]![1]).toEqual({
      decision: 'reject',
      targetProjectId: null,
    });
  });

  it('confirm intake: невалидный resolution → BadRequest, triage не вызван', async () => {
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'intake',
        resourceId: 'ii-3',
        resolution: 'merge',
      }),
    ).rejects.toThrow();
    expect(triage).not.toHaveBeenCalled();
  });

  it('confirm probe: answerText → respondToProbe({text})', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'probe',
      resourceId: 'nt-1',
      answerText: '  Да, согласен  ',
    });
    expect(respondToProbe).toHaveBeenCalledTimes(1);
    expect(respondToProbe.mock.calls[0]![0]).toEqual({
      notificationId: 'nt-1',
      userId: 'u-1',
      payload: { text: 'Да, согласен' },
    });
  });

  it('confirm probe: без answerText → BadRequest, respondToProbe не вызван', async () => {
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'probe',
        resourceId: 'nt-2',
      }),
    ).rejects.toThrow();
    expect(respondToProbe).not.toHaveBeenCalled();
  });

  // ──── task_closure (TZ task-dedup, 2026-06-16, Ф2) ────

  it('confirm task_closure approve → закрытие Issue (transitionState) + accepted', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-1',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: null,
    });
    const res = await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_closure',
      resourceId: 'tcc-1',
      resolution: 'approve',
    });
    expect(res).toEqual({ ok: true });
    // Issue закрыта через transitionState в completed-статус проекта.
    expect(transitionState).toHaveBeenCalledTimes(1);
    const [issueId, dto, tenantId, userId] = transitionState.mock.calls[0]!;
    expect(issueId).toBe('iss-1');
    expect((dto as { stateId: string }).stateId).toBe('state-done');
    expect(tenantId).toBe('t-1');
    expect(userId).toBe('u-1');
    // Кандидат → accepted.
    expect(taskClosureUpdate.mock.calls[0]![0].data.status).toBe('accepted');
  });

  it('confirm task_closure approve с comment → IssueComment с решением (метка) + accepted в одной транзакции', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-c',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: 'цитата из разговора',
      rationale: 'обоснование',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_closure',
      resourceId: 'tcc-c',
      resolution: 'approve',
      comment: 'Сделано вчера, выкатили на прод',
    });
    // решение пишется сообщением work_chat; кандидат → accepted.
    const appendMessageMock = workChat.appendMessage as ReturnType<typeof vi.fn>;
    expect(appendMessageMock).toHaveBeenCalledTimes(1);
    const commentData = appendMessageMock.mock.calls[0]![0];
    expect(commentData.issueId).toBe('iss-1');
    expect(commentData.authorUserId).toBe('u-1');
    expect(commentData.authorType).toBe('human');
    expect(commentData.access).toBe('internal');
    expect(commentData.content).toContain('Сделано вчера, выкатили на прод');
    // ручной comment имеет метку решения.
    expect(commentData.content).toContain('Решение');
    expect(commentData.contentStripped).toBe(commentData.content);
    // вне разговора (ручной ввод) — не приоритет evidenceQuote.
    expect(commentData.content).not.toContain('цитата из разговора');
    expect(taskClosureUpdate.mock.calls[0]![0].data.status).toBe('accepted');
  });

  it('confirm task_closure approve без comment → fallback на evidenceQuote с меткой «(из разговора)»', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-e',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: 'я закрыл эту задачу',
      rationale: 'обоснование',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_closure',
      resourceId: 'tcc-e',
      resolution: 'approve',
    });
    const appendMessageMock = workChat.appendMessage as ReturnType<typeof vi.fn>;
    expect(appendMessageMock).toHaveBeenCalledTimes(1);
    const commentData = appendMessageMock.mock.calls[0]![0];
    expect(commentData.content).toContain('я закрыл эту задачу');
    expect(commentData.content).toContain('из разговора');
    // evidenceQuote приоритетнее rationale.
    expect(commentData.content).not.toContain('обоснование');
  });

  it('confirm task_closure approve без comment и без evidenceQuote → fallback на rationale', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-r',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: 'итог обсуждения',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_closure',
      resourceId: 'tcc-r',
      resolution: 'approve',
    });
    const appendMessageMock = workChat.appendMessage as ReturnType<typeof vi.fn>;
    const commentData = appendMessageMock.mock.calls[0]![0];
    expect(commentData.content).toContain('итог обсуждения');
  });

  it('confirm task_closure approve: повторный confirm не плодит дубль комментария (guard not_pending)', async () => {
    taskClosureFindUnique
      .mockResolvedValueOnce({
        id: 'tcc-i',
        tenantId: 't-1',
        issueId: 'iss-1',
        status: 'pending',
        evidenceQuote: null,
        rationale: null,
      })
      .mockResolvedValueOnce({
        id: 'tcc-i',
        tenantId: 't-1',
        issueId: 'iss-1',
        status: 'accepted',
        evidenceQuote: null,
        rationale: null,
      });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_closure',
      resourceId: 'tcc-i',
      resolution: 'approve',
    });
    const appendMessageMock = workChat.appendMessage as ReturnType<typeof vi.fn>;
    expect(appendMessageMock).toHaveBeenCalledTimes(1);
    // повторный confirm: кандидат уже accepted → guard → BadRequest, комментарий не создаётся.
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'task_closure',
        resourceId: 'tcc-i',
        resolution: 'approve',
      }),
    ).rejects.toThrow();
    expect(appendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('confirm task_closure reject → Issue НЕ тронут, кандидат rejected, комментарий НЕ создан', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-2',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: 'цитата',
      rationale: 'обоснование',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_closure',
      resourceId: 'tcc-2',
      resolution: 'reject',
    });
    expect(transitionState).not.toHaveBeenCalled();
    expect(taskClosureUpdate.mock.calls[0]![0].data.status).toBe('rejected');
    // reject-ветка не пишет решение сообщением.
    expect(workChat.appendMessage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
  });

  it('confirm task_closure: уже не pending → BadRequest, Issue не тронут', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-3',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'accepted',
      evidenceQuote: null,
      rationale: null,
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'task_closure',
        resourceId: 'tcc-3',
        resolution: 'approve',
      }),
    ).rejects.toThrow();
    expect(transitionState).not.toHaveBeenCalled();
  });

  it('confirm task_closure: чужой tenant → BadRequest', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-4',
      tenantId: 'other',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: null,
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'task_closure',
        resourceId: 'tcc-4',
        resolution: 'approve',
      }),
    ).rejects.toThrow();
  });

  // ──── уведомление постановщика при закрытии (Ф8/Р-7) ────

  it('confirm task_closure approve: исполнитель ≠ постановщик → уведомление постановщику (task.closed_for_review)', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-n',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: null,
    });
    issueFindFirst.mockResolvedValue({
      id: 'iss-1',
      projectId: 'proj-1',
      createdById: 'creator-1',
      title: 'Починить виджет',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'executor-2',
      source: 'task_closure',
      resourceId: 'tcc-n',
      resolution: 'approve',
    });
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        recipientUserId: 'creator-1',
        eventType: 'task.closed_for_review',
      }),
    );
  });

  it('confirm task_closure approve: само-закрытие (createdById === userId) → уведомление НЕ шлётся (Р-7)', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-self',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: null,
    });
    issueFindFirst.mockResolvedValue({
      id: 'iss-1',
      projectId: 'proj-1',
      createdById: 'same-user',
      title: 'Задача',
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'same-user',
      source: 'task_closure',
      resourceId: 'tcc-self',
      resolution: 'approve',
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('confirm task_closure reject → уведомление постановщику НЕ шлётся', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-rej',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: null,
    });
    await svc.confirm({
      tenantId: 't-1',
      userId: 'executor-2',
      source: 'task_closure',
      resourceId: 'tcc-rej',
      resolution: 'reject',
    });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it('confirm task_closure approve: ошибка sendNotification → закрытие всё равно успешно (best-effort)', async () => {
    taskClosureFindUnique.mockResolvedValue({
      id: 'tcc-be',
      tenantId: 't-1',
      issueId: 'iss-1',
      status: 'pending',
      evidenceQuote: null,
      rationale: null,
    });
    issueFindFirst.mockResolvedValue({
      id: 'iss-1',
      projectId: 'proj-1',
      createdById: 'creator-1',
      title: 'Задача',
    });
    sendNotification.mockRejectedValue(new Error('канал недоступен'));
    const res = await svc.confirm({
      tenantId: 't-1',
      userId: 'executor-2',
      source: 'task_closure',
      resourceId: 'tcc-be',
      resolution: 'approve',
    });
    expect(res).toEqual({ ok: true });
    expect(transitionState).toHaveBeenCalledTimes(1);
    expect(taskClosureUpdate.mock.calls[0]![0].data.status).toBe('accepted');
  });

  // ──── task_review (TZ task-dedup, 2026-06-16, Ф4, R11/R13) ────

  it('confirm task_review: пометка снята (closureReviewState=null), Issue НЕ закрыт', async () => {
    issueFindFirst.mockResolvedValue({
      id: 'iss-1',
      closureReviewState: 'superseded_decision',
    });
    const res = await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'task_review',
      resourceId: 'iss-1',
    });
    expect(res).toEqual({ ok: true });
    // снята ТОЛЬКО review-пометка.
    expect(issueUpdate).toHaveBeenCalledTimes(1);
    const call = issueUpdate.mock.calls[0]![0];
    expect(call.where).toEqual({ id: 'iss-1' });
    expect(call.data).toEqual({
      closureReviewState: null,
      closureReviewReason: null,
      closureReviewAt: null,
    });
    // R13: задача НЕ закрывается/не отменяется — статус/completedAt не трогаем.
    expect(call.data.completedAt).toBeUndefined();
    expect(call.data.stateId).toBeUndefined();
    // closure-путь (transitionState) не задействован.
    expect(transitionState).not.toHaveBeenCalled();
  });

  it('confirm task_review: задача уже без пометки → BadRequest, update не вызван', async () => {
    issueFindFirst.mockResolvedValue({
      id: 'iss-2',
      closureReviewState: null,
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'task_review',
        resourceId: 'iss-2',
      }),
    ).rejects.toThrow();
    expect(issueUpdate).not.toHaveBeenCalled();
  });

  it('confirm task_review: задача не найдена (чужой tenant) → BadRequest', async () => {
    issueFindFirst.mockResolvedValue(null);
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'task_review',
        resourceId: 'iss-x',
      }),
    ).rejects.toThrow();
    expect(issueUpdate).not.toHaveBeenCalled();
  });

  // ──── progress_draft (TZ tracker-redesign, 2026-06-20, Ф8/R17a) ────

  it('confirm progress_draft (по умолчанию) → ProgressUpdatesService.confirm («как есть»)', async () => {
    const res = await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'progress_draft',
      resourceId: 'pu-1',
    });
    expect(res).toEqual({ ok: true });
    expect(progressConfirm).toHaveBeenCalledTimes(1);
    const [id, dto, tenantId, userId] = progressConfirm.mock.calls[0]!;
    expect(id).toBe('pu-1');
    expect(dto).toEqual({});
    expect(tenantId).toBe('t-1');
    expect(userId).toBe('u-1');
    expect(progressReject).not.toHaveBeenCalled();
  });

  it('confirm progress_draft reject → ProgressUpdatesService.reject, confirm не вызван', async () => {
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-1',
      source: 'progress_draft',
      resourceId: 'pu-2',
      resolution: 'reject',
    });
    expect(progressReject).toHaveBeenCalledTimes(1);
    expect(progressReject.mock.calls[0]!).toEqual(['pu-2', 't-1', 'u-1']);
    expect(progressConfirm).not.toHaveBeenCalled();
  });

  it('confirm curation: не-light уровень → BadRequest, decide не вызван', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-2',
      tenantId: 't-1',
      status: 'pending',
      level: 'deep',
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-2',
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('confirm: чужой tenant / не найден → BadRequest', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-3',
      tenantId: 'other',
      status: 'pending',
      level: 'light',
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-3',
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('confirm: не pending → BadRequest', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-4',
      tenantId: 't-1',
      status: 'decided',
      level: 'light',
    });
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-4',
      }),
    ).rejects.toThrow();
    expect(decide).not.toHaveBeenCalled();
  });

  it('confirm: Forbidden из decide пробрасывается наружу (RBAC)', async () => {
    curationItemFindUnique.mockResolvedValue({
      id: 'ci-5',
      tenantId: 't-1',
      status: 'pending',
      level: 'light',
    });
    decide.mockRejectedValue(new Error('not_in_candidates'));
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-1',
        source: 'curation',
        resourceId: 'ci-5',
      }),
    ).rejects.toThrow();
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('confirm intake: нет write-права → Forbidden, triage НЕ вызван (закрытие обхода RBAC)', async () => {
    canWriteMock.mockResolvedValue(false);
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-member',
        source: 'intake',
        resourceId: 'ii-9',
        resolution: 'accept',
      }),
    ).rejects.toThrow();
    expect(canWriteMock).toHaveBeenCalledWith('u-member', 't-1', 'intake_issue');
    expect(triage).not.toHaveBeenCalled();
  });

  it('confirm intake: есть write-право → triage вызван', async () => {
    canWriteMock.mockResolvedValue(true);
    await svc.confirm({
      tenantId: 't-1',
      userId: 'u-admin',
      source: 'intake',
      resourceId: 'ii-9',
      resolution: 'accept',
    });
    expect(triage).toHaveBeenCalledTimes(1);
  });

  it('confirm conflict: нет write-права → Forbidden, resolve НЕ вызван (закрытие обхода RBAC)', async () => {
    canWriteMock.mockResolvedValue(false);
    await expect(
      svc.confirm({
        tenantId: 't-1',
        userId: 'u-member',
        source: 'conflict',
        resourceId: 'cf-9',
        resolution: 'keep_old',
      }),
    ).rejects.toThrow();
    expect(canWriteMock).toHaveBeenCalledWith('u-member', 't-1', 'conflict_item');
    expect(resolveConflict).not.toHaveBeenCalled();
  });
});
