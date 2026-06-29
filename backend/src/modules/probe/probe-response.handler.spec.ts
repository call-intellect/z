import type { Notification, ProbeEvent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TypedConfigService } from '../../common/config/typed-config.service';
import type { BusinessMetricsService } from '../../common/metrics/business-metrics.service';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { LlmRouterService } from '../ai/services/llm-router.service';
import type { CompanyProfileService } from '../company-foundation/services/company-profile.service';
import type { ConversationalIngestAdapter } from '../conversational/adapters/conversational-ingest.adapter';
import type { ConversationalService } from '../conversational/conversational.service';
import type { CoreQueueService } from '../core-queue/core-queue.service';
import type { CurationService } from '../curation/services/curation.service';
import type { AssigneeResolverService } from '../tracker/services/assignee-resolver.service';
import type { IssuesService } from '../tracker/services/issues.service';

import type { ProbeDialogService } from './probe-dialog.service';
import { ProbeResponseHandler } from './probe-response.handler';
import type { NotificationRespondedPayload } from './probe.types';

function buildProbe(): ProbeEvent {
  return {
    id: 'probe-classify-1',
    tenantId: 'org-classify',
    emittedByService: '3-3-decisions',
    reason: 'decision.confirm_status',
    payload: {
      question: 'Решение по миграции на DeepSeek принято?',
      message: 'Нужно подтверждение статуса по миграции на DeepSeek.',
    },
    recipientCandidates: ['user-1'],
    selectedRecipientId: 'user-1',
    status: 'dispatched',
    dispatchedNotificationId: 'notif-classify-1',
    contentHash: 'h',
    priority: 50,
    createdAt: new Date(Date.now() - 60_000),
    dispatchedAt: new Date(Date.now() - 30_000),
    expiresAt: null,
  } as unknown as ProbeEvent;
}

function buildNotification(): Notification {
  return {
    id: 'notif-classify-1',
    tenantId: 'org-classify',
    recipientUserId: 'user-1',
    eventType: 'probe.question',
    payload: { question: 'Решение принято?' },
    status: 'responded',
  } as unknown as Notification;
}

interface Mocks {
  prisma: PrismaService;
  metrics: BusinessMetricsService;
  ingestAdapter: ConversationalIngestAdapter;
  ingestArgs: Array<Record<string, unknown>>;
  llmCall: ReturnType<typeof vi.fn>;
  curationFindFirst: ReturnType<typeof vi.fn>;
  curationDecide: ReturnType<typeof vi.fn>;
  issueUpdateMany: ReturnType<typeof vi.fn>;
  issueFindFirst: ReturnType<typeof vi.fn>;
  intakeIssueUpdateMany: ReturnType<typeof vi.fn>;
  intakeIssueFindFirst: ReturnType<typeof vi.fn>;
  issueAssigneeFindFirst: ReturnType<typeof vi.fn>;
  decisionUpdateMany: ReturnType<typeof vi.fn>;
  personFindFirst: ReturnType<typeof vi.fn>;
  assigneeResolve: ReturnType<typeof vi.fn>;
  addAssignee: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
  closureUpsert: ReturnType<typeof vi.fn>;
  experimentFindFirst: ReturnType<typeof vi.fn>;
  experimentUpdate: ReturnType<typeof vi.fn>;
  companyProfileUpdate: ReturnType<typeof vi.fn>;
  companyProfileGetRaw: ReturnType<typeof vi.fn>;
  membershipFindMany: ReturnType<typeof vi.fn>;
  probeEventUpdate: ReturnType<typeof vi.fn>;
  notificationUpdate: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
  dialog: ProbeDialogService;
  dialogEnsureState: ReturnType<typeof vi.fn>;
  dialogRecordTurn: ReturnType<typeof vi.fn>;
  dialogSetPhase: ReturnType<typeof vi.fn>;
  dialogGetActive: ReturnType<typeof vi.fn>;
  dialogFinalize: ReturnType<typeof vi.fn>;
}

function makeMocks(): Mocks {
  const probe = buildProbe();
  const notif = buildNotification();
  const ingestArgs: Array<Record<string, unknown>> = [];

  const curationFindFirst = vi.fn().mockResolvedValue({ id: 'curation-item-1' });
  const curationDecide = vi.fn().mockResolvedValue({ id: 'curation-item-1' });
  const issueUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const issueFindFirst = vi
    .fn()
    .mockResolvedValue({ description: null, descriptionStripped: null });
  const intakeIssueUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const intakeIssueFindFirst = vi.fn().mockResolvedValue({ extractedDescription: null });
  const issueAssigneeFindFirst = vi.fn().mockResolvedValue(null);
  const decisionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const personFindFirst = vi.fn().mockResolvedValue(null);
  const assigneeResolve = vi.fn().mockResolvedValue({ kind: 'not_found' });
  const addAssignee = vi.fn().mockResolvedValue({ ok: true });
  const softDelete = vi.fn().mockResolvedValue({ ok: true });
  const closureUpsert = vi.fn().mockResolvedValue({ id: 'cand-1', status: 'pending' });
  const experimentFindFirst = vi.fn().mockResolvedValue({ lessonsJson: null });
  const experimentUpdate = vi.fn().mockResolvedValue({ id: 'exp-1' });
  const companyProfileUpdate = vi.fn().mockResolvedValue({ id: 'cp-1' });
  const companyProfileGetRaw = vi.fn().mockResolvedValue(null);
  const dialogEnsureState = vi
    .fn()
    .mockResolvedValue({ id: 'pds-1', turnCount: 1, phase: 'awaiting_answer' });
  const dialogRecordTurn = vi
    .fn()
    .mockResolvedValue({ id: 'pds-1', turnCount: 1, phase: 'awaiting_answer' });
  const dialogSetPhase = vi.fn().mockResolvedValue(undefined);
  const dialogGetActive = vi.fn().mockResolvedValue(null);
  const dialogFinalize = vi.fn().mockResolvedValue(true);
  const dialog = {
    ensureState: dialogEnsureState,
    recordTurn: dialogRecordTurn,
    getActive: dialogGetActive,
    setPhase: dialogSetPhase,
    finalizeIfPending: dialogFinalize,
  } as unknown as ProbeDialogService;
  const membershipFindMany = vi
    .fn()
    .mockResolvedValue([{ userId: 'owner-1' }, { userId: 'admin-1' }]);
  const probeEventUpdate = vi.fn().mockResolvedValue({});
  const notificationUpdate = vi.fn().mockResolvedValue({});
  const sendNotification = vi.fn().mockResolvedValue({ id: 'clarify-notif-1' });

  const prisma = {
    probeEvent: {
      findFirst: vi.fn().mockResolvedValue(probe),
      update: probeEventUpdate,
    },
    membership: {
      findMany: membershipFindMany,
    },
    notification: {
      findUnique: vi.fn().mockResolvedValue(notif),
      update: notificationUpdate,
    },
    notificationDelivery: {
      findFirst: vi.fn().mockResolvedValue({
        id: 'd',
        notificationId: 'notif-classify-1',
        channelBinding: { channel: { kind: 'telegram_bot' } },
      }),
    },
    curationItem: {
      findFirst: curationFindFirst,
    },
    issue: {
      updateMany: issueUpdateMany,
      findFirst: issueFindFirst,
    },
    intakeIssue: {
      updateMany: intakeIssueUpdateMany,
      findFirst: intakeIssueFindFirst,
    },
    issueAssignee: {
      findFirst: issueAssigneeFindFirst,
    },
    decision: {
      updateMany: decisionUpdateMany,
    },
    person: {
      findFirst: personFindFirst,
    },
    taskClosureCandidate: {
      upsert: closureUpsert,
    },
    experiment: {
      findFirst: experimentFindFirst,
      update: experimentUpdate,
    },
  } as unknown as PrismaService;

  const metrics = {
    incProbeResponse: vi.fn(),
    observeProbeResponseTime: vi.fn(),
    incProbeClosed: vi.fn(),
    incProbeResponseClassified: vi.fn(),
    incProbeResponseUnclear: vi.fn(),
    incProbeOutcome: vi.fn(),
    incProbeDialogTransition: vi.fn(),
    incProbeDialogOutcome: vi.fn(),
    incProbeDialogDegraded: vi.fn(),
  } as unknown as BusinessMetricsService;

  const ingestAdapter = {
    ingestNotificationResponse: vi.fn().mockImplementation(async (args) => {
      ingestArgs.push(args as Record<string, unknown>);
      return {};
    }),
  } as unknown as ConversationalIngestAdapter;

  const llmCall = vi.fn();

  return {
    prisma,
    metrics,
    ingestAdapter,
    ingestArgs,
    llmCall,
    curationFindFirst,
    curationDecide,
    issueUpdateMany,
    issueFindFirst,
    intakeIssueUpdateMany,
    intakeIssueFindFirst,
    issueAssigneeFindFirst,
    decisionUpdateMany,
    personFindFirst,
    assigneeResolve,
    addAssignee,
    softDelete,
    closureUpsert,
    experimentFindFirst,
    experimentUpdate,
    companyProfileUpdate,
    companyProfileGetRaw,
    membershipFindMany,
    probeEventUpdate,
    notificationUpdate,
    sendNotification,
    dialog,
    dialogEnsureState,
    dialogRecordTurn,
    dialogSetPhase,
    dialogGetActive,
    dialogFinalize,
  };
}

function makeHandler(args: {
  mocks: Mocks;
  classifyEnabled: boolean;
  minConfidence?: number;
  withTracker?: boolean;
  dialogEnabled?: boolean;
}): ProbeResponseHandler {
  const llm = { call: args.mocks.llmCall } as unknown as LlmRouterService;
  const cfg = {
    probe: {
      responseClassifyEnabled: args.classifyEnabled,
      voiceInputEnabled: true,
      responseClassifyMinConfidence: args.minConfidence ?? 0.5,
      dialogEnabled: args.dialogEnabled ?? false,
    },
    subjectMemory: { enabled: false },
    getDynamic: vi
      .fn()
      .mockImplementation((key: string) =>
        key === 'probe.dialogEscalateMaxConfidence'
          ? 0.6
          : key === 'probe.dialogMaxTurns'
            ? 2
            : undefined,
      ),
  } as unknown as TypedConfigService;
  const conversational = {
    sendNotification: args.mocks.sendNotification,
  } as unknown as ConversationalService;
  const coreQueue = {
    enqueueSubjectMemoryDerive: vi.fn().mockResolvedValue({ jobId: 'sm-1' }),
  } as unknown as CoreQueueService;
  const curation = {
    decide: args.mocks.curationDecide,
  } as unknown as CurationService;
  const withTracker = args.withTracker !== false;
  const assigneeResolver = withTracker
    ? ({ resolve: args.mocks.assigneeResolve } as unknown as AssigneeResolverService)
    : undefined;
  const issues = withTracker
    ? ({
        addAssignee: args.mocks.addAssignee,
        softDelete: args.mocks.softDelete,
      } as unknown as IssuesService)
    : undefined;
  const companyProfile = {
    update: args.mocks.companyProfileUpdate,
    getRaw: args.mocks.companyProfileGetRaw,
  } as unknown as CompanyProfileService;
  return new ProbeResponseHandler(
    args.mocks.prisma,
    args.mocks.metrics,
    args.mocks.ingestAdapter,
    llm,
    cfg,
    conversational,
    coreQueue,
    curation,
    assigneeResolver,
    issues,
    companyProfile,
    args.mocks.dialog,
  );
}

const event: NotificationRespondedPayload = {
  tenantId: 'org-classify',
  notificationId: 'notif-classify-1',
  recipientUserId: 'user-1',
  eventType: 'probe.question',
  payload: { text: 'Да, согласовано, начинаем в понедельник' },
  contextBlockId: null,
  contextCardId: null,
};

describe('ProbeResponseHandler — Agents v2 Фаза 0.1 classifier', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('high confidence (0.9) — parsedAnswer/parsedConfidence в payload, bucket=high', async () => {
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Человек подтвердил согласование',
        outcome: 'apply',
        value: 'Да, согласовано',
        confidence: 0.9,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    expect(mocks.metrics.incProbeResponseClassified).toHaveBeenCalledWith({
      confidence_bucket: 'high',
    });
    expect(mocks.metrics.incProbeResponseUnclear).not.toHaveBeenCalled();
    expect(mocks.ingestArgs).toHaveLength(1);
    const ingested = mocks.ingestArgs[0]!;
    const payload = ingested.payload as Record<string, unknown>;
    expect(payload.parsedAnswer).toBe('Да, согласовано');
    expect(payload.parsedConfidence).toBe(0.9);
    expect(payload.notification_response_unclear).toBeUndefined();
  });

  it('low confidence (0.3) — bucket=low + unclear, payload помечен, closing-loop НЕ блокируется', async () => {
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Ответ невозможно разобрать',
        outcome: 'unclear',
        value: 'непонятно',
        confidence: 0.3,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.metrics.incProbeResponseClassified).toHaveBeenCalledWith({
      confidence_bucket: 'low',
    });
    expect(mocks.metrics.incProbeResponseUnclear).toHaveBeenCalledWith({
      originalReason: 'decision.confirm_status',
    });
    expect(mocks.ingestArgs).toHaveLength(1);
    const payload = mocks.ingestArgs[0]!.payload as Record<string, unknown>;
    expect(payload.notification_response_unclear).toBe(true);
    expect(payload.parsedConfidence).toBe(0.3);
    expect(mocks.metrics.incProbeClosed).toHaveBeenCalled();
  });

  it('LLM throw — handler не падает, classify-метрики НЕ дёрнуты, ingest БЕЗ parsedAnswer', async () => {
    mocks.llmCall.mockRejectedValueOnce(new Error('llm proxy 500'));

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.metrics.incProbeResponseClassified).not.toHaveBeenCalled();
    expect(mocks.metrics.incProbeResponseUnclear).not.toHaveBeenCalled();
    expect(mocks.ingestArgs).toHaveLength(1);
    const payload = mocks.ingestArgs[0]!.payload as Record<string, unknown>;
    expect(payload.parsedAnswer).toBeUndefined();
    expect(payload.parsedConfidence).toBeUndefined();
    expect(payload.notification_response_unclear).toBeUndefined();
    expect(mocks.metrics.incProbeClosed).toHaveBeenCalled();
  });

  it('PROBE_RESPONSE_CLASSIFY_ENABLED=false — LLM не вызывается, ingest без parsing', async () => {
    const handler = makeHandler({ mocks, classifyEnabled: false });
    await handler.handle(event);

    expect(mocks.llmCall).not.toHaveBeenCalled();
    expect(mocks.metrics.incProbeResponseClassified).not.toHaveBeenCalled();
    expect(mocks.ingestArgs).toHaveLength(1);
    const payload = mocks.ingestArgs[0]!.payload as Record<string, unknown>;
    expect(payload.parsedAnswer).toBeUndefined();
  });

  it('payload.formulatedQuestion — приоритет над reason/message при сборке question для LLM', async () => {
    const probeWithFormulated = {
      ...buildProbe(),
      payload: {
        formulatedQuestion: 'Вы согласовали с финдиректором?',
        question: 'устаревший legacy ключ',
        message: 'контекст от specialist, не сам вопрос',
      },
      reason: 'decision.confirm_status_machine_code',
    };
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(probeWithFormulated);

    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Подтверждение',
        outcome: 'apply',
        value: 'Да',
        confidence: 0.9,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.llmCall).toHaveBeenCalledTimes(1);
    const llmArgs = mocks.llmCall.mock.calls[0]![0] as {
      userMessage: string;
    };
    expect(llmArgs.userMessage).toContain('Вы согласовали с финдиректором?');
    expect(llmArgs.userMessage).not.toContain('decision.confirm_status_machine_code');
    expect(llmArgs.userMessage).not.toContain('устаревший legacy ключ');
    expect(llmArgs.userMessage).not.toContain('контекст от specialist, не сам вопрос');
  });

  it('reason=skill.cdm_interview → ingest получает signalTypeHint=reasoning и questionText (каскад formulatedQuestion)', async () => {
    const probeCdm = {
      ...buildProbe(),
      reason: 'skill.cdm_interview',
      payload: {
        formulatedQuestion: 'Какие альтернативы вы рассматривали и почему отвергли?',
        suggestedQuestion: 'fallback-вопрос специалиста',
        message: 'контекст кейса',
      },
    };
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(probeCdm);
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Описал рассмотренные альтернативы',
        outcome: 'apply',
        value: 'Рассматривал выкат в пятницу',
        confidence: 0.9,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.ingestArgs).toHaveLength(1);
    const ingested = mocks.ingestArgs[0]!;
    expect(ingested.signalTypeHint).toBe('reasoning');
    expect(ingested.questionText).toBe('Какие альтернативы вы рассматривали и почему отвергли?');
  });

  it('обычный reason → signalTypeHint НЕ передаётся (undefined), questionText из каскада есть', async () => {
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Подтверждение',
        outcome: 'apply',
        value: 'Да',
        confidence: 0.9,
      }),
    });

    const handler = makeHandler({ mocks, classifyEnabled: true });
    await handler.handle(event);

    expect(mocks.ingestArgs).toHaveLength(1);
    const ingested = mocks.ingestArgs[0]!;
    expect(ingested.signalTypeHint).toBeUndefined();
    expect(ingested.questionText).toBe('Решение по миграции на DeepSeek принято?');
  });
});

describe('ProbeResponseHandler — existence-confirm → curation.decide', () => {
  function setExistenceConfirmProbe(mocks: Mocks): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'regulation.existence_confirm',
      payload: {
        message: 'Кора зафиксировала регламент «Возвраты». Оставить, переименовать или удалить?',
        contextCardId: 'reg-99',
        contextCardKind: 'regulation',
      },
    });
  }

  it('ответ «Удалить» (classifier off) → decide(reject) по существующему pending CurationItem', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Удалить, это устарело' },
    });

    expect(mocks.curationFindFirst).toHaveBeenCalledTimes(1);
    const where = mocks.curationFindFirst.mock.calls[0]![0] as {
      where: { tenantId: string; resourceId: string; status: string };
    };
    expect(where.where).toMatchObject({
      tenantId: 'org-classify',
      resourceId: 'reg-99',
      status: 'pending',
    });
    expect(mocks.curationDecide).toHaveBeenCalledTimes(1);
    const decideArg = mocks.curationDecide.mock.calls[0]![0] as {
      tenantId: string;
      curationItemId: string;
      reviewerUserId: string;
      decisionType: string;
    };
    expect(decideArg).toMatchObject({
      tenantId: 'org-classify',
      curationItemId: 'curation-item-1',
      reviewerUserId: 'user-1',
      decisionType: 'reject',
    });
  });

  it('ответ «Переименовать» → decide(approve_with_edits)', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Переименовать в «Политика возвратов»' },
    });

    expect(mocks.curationDecide).toHaveBeenCalledTimes(1);
    const decideArg = mocks.curationDecide.mock.calls[0]![0] as {
      decisionType: string;
    };
    expect(decideArg.decisionType).toBe('approve_with_edits');
  });

  it('нераспознанный ответ → curation НЕ трогается', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'хм не уверен' },
    });

    expect(mocks.curationFindFirst).not.toHaveBeenCalled();
    expect(mocks.curationDecide).not.toHaveBeenCalled();
  });

  it('pending CurationItem не найден → decide НЕ вызывается (best-effort no-op)', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    mocks.curationFindFirst.mockResolvedValueOnce(null);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Удалить' },
    });

    expect(mocks.curationFindFirst).toHaveBeenCalledTimes(1);
    expect(mocks.curationDecide).not.toHaveBeenCalled();
  });

  it('обычный probe (не existence_confirm) → curation не трогается', async () => {
    const mocks = makeMocks();
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Удалить' },
    });

    expect(mocks.curationFindFirst).not.toHaveBeenCalled();
    expect(mocks.curationDecide).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — task-probe → исполнение ответа (A3)', () => {
  function setTaskProbe(mocks: Mocks, reason: string): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason,
      payload: {
        contextCardId: 'issue-7',
        contextCardKind: 'issue',
        contextCardTitle: 'Сверстать лендинг',
        suggestedQuestion: 'Кому поручить задачу «Сверстать лендинг»?',
      },
    });
  }

  it('assignee_unresolved «Анна» → resolved(u1), нет исполнителя → addAssignee(issue-7, u1, tenant, actor)', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.assignee_unresolved');
    mocks.assigneeResolve.mockResolvedValueOnce({
      kind: 'resolved',
      userId: 'u1',
      name: 'Анна',
      via: 'name',
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Анна' } });

    expect(mocks.issueAssigneeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { issueId: 'issue-7' } }),
    );
    expect(mocks.assigneeResolve).toHaveBeenCalledWith('org-classify', 'Анна');
    expect(mocks.addAssignee).toHaveBeenCalledTimes(1);
    expect(mocks.addAssignee).toHaveBeenCalledWith('issue-7', 'u1', 'org-classify', 'user-1');
  });

  it('идемпотентность: у задачи уже есть исполнитель → addAssignee НЕ вызван', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.assignee_unresolved');
    mocks.issueAssigneeFindFirst.mockResolvedValueOnce({ id: 'ia-1' });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Анна' } });

    expect(mocks.assigneeResolve).not.toHaveBeenCalled();
    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });

  it('resolver not_found/ambiguous/collective → addAssignee НЕ вызван (fail-open)', async () => {
    for (const resolution of [
      { kind: 'not_found' },
      {
        kind: 'ambiguous',
        candidates: [
          { userId: 'a', name: 'А' },
          { userId: 'b', name: 'Б' },
        ],
      },
      { kind: 'collective', label: 'отдел дизайна' },
    ]) {
      const mocks = makeMocks();
      setTaskProbe(mocks, 'task.assignee_unresolved');
      mocks.assigneeResolve.mockResolvedValueOnce(resolution);
      const handler = makeHandler({ mocks, classifyEnabled: false });

      await handler.handle({ ...event, payload: { text: 'кто-то' } });

      expect(mocks.addAssignee).not.toHaveBeenCalled();
    }
  });

  it('due_date_missing «до пятницы» → issue.updateMany с data.dueDate (Date) и where.dueDate=null', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.due_date_missing');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'до пятницы' } });

    expect(mocks.issueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.issueUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string; dueDate: null; deletedAt: null };
      data: { dueDate: Date };
    };
    expect(call.where).toMatchObject({
      id: 'issue-7',
      tenantId: 'org-classify',
      dueDate: null,
      deletedAt: null,
    });
    expect(call.data.dueDate).toBeInstanceOf(Date);
  });

  it('due_date_missing невалидный срок → updateMany НЕ вызван', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.due_date_missing');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'когда-нибудь потом' } });

    expect(mocks.issueUpdateMany).not.toHaveBeenCalled();
  });

  it('tracker-сервисы недоступны (assigneeResolver=undefined) → не падает, addAssignee недоступен', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.assignee_unresolved');
    const handler = makeHandler({ mocks, classifyEnabled: false, withTracker: false });

    await expect(handler.handle({ ...event, payload: { text: 'Анна' } })).resolves.toBeUndefined();

    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });

  it('contextCardId отсутствует → ничего не делает', async () => {
    const mocks = makeMocks();
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'task.assignee_unresolved',
      payload: { contextCardKind: 'issue' },
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Анна' } });

    expect(mocks.issueAssigneeFindFirst).not.toHaveBeenCalled();
    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — task-probe для intake_issue (A5)', () => {
  function setIntakeTaskProbe(mocks: Mocks, reason: string): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason,
      payload: {
        contextCardId: 'intake-7',
        contextCardKind: 'intake_issue',
        contextCardTitle: 'Сделать отчёт',
        suggestedQuestion: 'Кому поручить задачу «Сделать отчёт»?',
      },
    });
  }

  it('assignee_unresolved «Анна» → resolved(u1) → intakeIssue.updateMany, НЕ issues.addAssignee', async () => {
    const mocks = makeMocks();
    setIntakeTaskProbe(mocks, 'task.assignee_unresolved');
    mocks.assigneeResolve.mockResolvedValueOnce({
      kind: 'resolved',
      userId: 'u1',
      name: 'Анна',
      via: 'name',
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Анна' } });

    expect(mocks.assigneeResolve).toHaveBeenCalledWith('org-classify', 'Анна');
    expect(mocks.addAssignee).not.toHaveBeenCalled();
    expect(mocks.issueAssigneeFindFirst).not.toHaveBeenCalled();
    expect(mocks.intakeIssueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.intakeIssueUpdateMany.mock.calls[0]![0] as {
      where: {
        id: string;
        tenantId: string;
        suggestedAssigneeId: null;
        status: string;
      };
      data: { suggestedAssigneeId: string };
    };
    expect(call.where).toMatchObject({
      id: 'intake-7',
      tenantId: 'org-classify',
      suggestedAssigneeId: null,
      status: 'pending',
    });
    expect(call.data.suggestedAssigneeId).toBe('u1');
  });

  it('assignee_unresolved resolver not_found → intakeIssue.updateMany НЕ вызван', async () => {
    const mocks = makeMocks();
    setIntakeTaskProbe(mocks, 'task.assignee_unresolved');
    mocks.assigneeResolve.mockResolvedValueOnce({ kind: 'not_found' });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'кто-то' } });

    expect(mocks.intakeIssueUpdateMany).not.toHaveBeenCalled();
    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });

  it('due_date_missing «до пятницы» → intakeIssue.updateMany c suggestedDueDate, issue.updateMany НЕ вызван', async () => {
    const mocks = makeMocks();
    setIntakeTaskProbe(mocks, 'task.due_date_missing');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'до пятницы' } });

    expect(mocks.issueUpdateMany).not.toHaveBeenCalled();
    expect(mocks.intakeIssueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.intakeIssueUpdateMany.mock.calls[0]![0] as {
      where: {
        id: string;
        tenantId: string;
        suggestedDueDate: null;
        status: string;
      };
      data: { suggestedDueDate: Date };
    };
    expect(call.where).toMatchObject({
      id: 'intake-7',
      tenantId: 'org-classify',
      suggestedDueDate: null,
      status: 'pending',
    });
    expect(call.data.suggestedDueDate).toBeInstanceOf(Date);
  });
});

describe('ProbeResponseHandler — Фаза 6 отрицательная ветка (мягкое удаление)', () => {
  function setTaskProbe(
    mocks: Mocks,
    reason: string,
    kind: 'issue' | 'intake_issue',
    contextCardId: string,
  ): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason,
      payload: {
        contextCardId,
        contextCardKind: kind,
        contextCardTitle: 'Сверстать лендинг',
        suggestedQuestion: 'Кому поручить задачу?',
      },
    });
  }

  it('«это не задача, удали» на task.assignee_unresolved (intake pending) → intakeIssue.updateMany({status:rejected})', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.assignee_unresolved', 'intake_issue', 'intake-7');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'это не задача, удали' } });

    expect(mocks.intakeIssueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.intakeIssueUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string; status: string };
      data: { status: string };
    };
    expect(call.where).toMatchObject({
      id: 'intake-7',
      tenantId: 'org-classify',
      status: 'pending',
    });
    expect(call.data.status).toBe('rejected');
    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });

  it('«удалить» на promoted issue (task.false_positive) → issues.softDelete(issue, tenant, actor)', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.false_positive', 'issue', 'issue-7');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'удалить, это ошибочно' } });

    expect(mocks.softDelete).toHaveBeenCalledTimes(1);
    expect(mocks.softDelete).toHaveBeenCalledWith('issue-7', 'org-classify', 'user-1');
    expect(mocks.intakeIssueUpdateMany).not.toHaveBeenCalled();
  });

  it('обычный ответ-имя «Анна» на task.assignee_unresolved НЕ удаляет (reject-ветка не срабатывает)', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'task.assignee_unresolved', 'issue', 'issue-7');
    mocks.assigneeResolve.mockResolvedValueOnce({
      kind: 'resolved',
      userId: 'u1',
      name: 'Анна',
      via: 'name',
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Анна' } });

    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.addAssignee).toHaveBeenCalledTimes(1);
  });
});

describe('ProbeResponseHandler — Фаза 6 poorly_specified (доработка описания)', () => {
  function setTaskProbe(mocks: Mocks, kind: 'issue' | 'intake_issue', contextCardId: string): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'task.poorly_specified',
      payload: {
        contextCardId,
        contextCardKind: kind,
        contextCardTitle: 'Сделать отчёт',
        suggestedQuestion: 'Уточните, что именно нужно сделать?',
      },
    });
  }

  it('issue с пустым описанием → descriptionStripped = answer, description продублирован', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'issue', 'issue-7');
    mocks.issueFindFirst.mockResolvedValueOnce({
      description: null,
      descriptionStripped: null,
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Подготовить квартальный отчёт по продажам' },
    });

    expect(mocks.issueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.issueUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string; deletedAt: null };
      data: { descriptionStripped: string; description?: string };
    };
    expect(call.where).toMatchObject({
      id: 'issue-7',
      tenantId: 'org-classify',
      deletedAt: null,
    });
    expect(call.data.descriptionStripped).toBe('Подготовить квартальный отчёт по продажам');
    expect(call.data.description).toBe('Подготовить квартальный отчёт по продажам');
  });

  it('issue с непустым описанием → старое не теряется (конкатенация в descriptionStripped, description не трогаем)', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'issue', 'issue-7');
    mocks.issueFindFirst.mockResolvedValueOnce({
      description: '{"type":"doc"}',
      descriptionStripped: 'Старое описание',
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Новое уточнение' } });

    const call = mocks.issueUpdateMany.mock.calls[0]![0] as {
      data: { descriptionStripped: string; description?: string };
    };
    expect(call.data.descriptionStripped).toBe('Старое описание\n\nНовое уточнение');
    expect(call.data.description).toBeUndefined();
  });

  it('intake_issue → extractedDescription дополнен конкатенацией (старое сохранено)', async () => {
    const mocks = makeMocks();
    setTaskProbe(mocks, 'intake_issue', 'intake-7');
    mocks.intakeIssueFindFirst.mockResolvedValueOnce({
      extractedDescription: 'Исходный текст',
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'Дополнение' } });

    expect(mocks.intakeIssueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.intakeIssueUpdateMany.mock.calls[0]![0] as {
      where: { id: string; tenantId: string; status: string };
      data: { extractedDescription: string };
    };
    expect(call.where).toMatchObject({
      id: 'intake-7',
      tenantId: 'org-classify',
      status: 'pending',
    });
    expect(call.data.extractedDescription).toBe('Исходный текст\n\nДополнение');
  });
});

describe('ProbeResponseHandler — completion_detail_missing → кандидат на закрытие (Ф7)', () => {
  function setCompletionDetailProbe(mocks: Mocks): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'task.completion_detail_missing',
      payload: {
        contextCardId: 'issue-77',
        contextCardKind: 'issue',
        contextCardTitle: 'Сделать макет',
        suggestedQuestion: 'Что конкретно вы сделали с задачей «Сделать макет»?',
      },
    });
  }

  it('ответ с деталями (не reject) → taskClosureCandidate.upsert c evidenceQuote=answer', async () => {
    const mocks = makeMocks();
    setCompletionDetailProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'собрал макет и отправил клиенту на согласование' },
    });

    expect(mocks.closureUpsert).toHaveBeenCalledTimes(1);
    const call = mocks.closureUpsert.mock.calls[0]![0] as {
      where: { tenantId_issueId_sourceBlockId: Record<string, string> };
      create: { evidenceQuote: string; status: string; sourceBlockId: string };
      update: { evidenceQuote: string };
    };
    expect(call.where.tenantId_issueId_sourceBlockId).toMatchObject({
      tenantId: 'org-classify',
      issueId: 'issue-77',
      sourceBlockId: 'concierge-complete:user-1',
    });
    expect(call.create.evidenceQuote).toBe('собрал макет и отправил клиенту на согласование');
    expect(call.create.status).toBe('pending');
    expect(call.update.evidenceQuote).toBe('собрал макет и отправил клиенту на согласование');
  });

  it('ответ «не делал / удалить» (reject) → upsert НЕ вызван', async () => {
    const mocks = makeMocks();
    setCompletionDetailProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'удалить, я не делал' } });

    expect(mocks.closureUpsert).not.toHaveBeenCalled();
  });

  it('пустой ответ → upsert НЕ вызван', async () => {
    const mocks = makeMocks();
    setCompletionDetailProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: {} });

    expect(mocks.closureUpsert).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — experiment.result_without_lesson → урок в lessonsJson (B-1)', () => {
  function setExperimentProbe(mocks: Mocks): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'experiment.result_without_lesson',
      payload: {
        contextCardId: 'exp-1',
        contextCardKind: 'experiment',
        contextCardTitle: 'Битрикс',
        suggestedQuestion: 'Какой урок вынесли из эксперимента?',
      },
    });
  }

  it('подтверждённый урок → experiment.update c lessonsJson (append к существующим)', async () => {
    const mocks = makeMocks();
    setExperimentProbe(mocks);
    mocks.experimentFindFirst.mockResolvedValueOnce({
      lessonsJson: [{ text: 'старый урок', type: 'what_worked', sourceBlockId: null }],
    });
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Не мигрировать в пик продаж' },
    });

    expect(mocks.experimentUpdate).toHaveBeenCalledTimes(1);
    const call = mocks.experimentUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: { lessonsJson: Array<{ text: string; type: string; sourceBlockId: null }> };
    };
    expect(call.where).toMatchObject({ id: 'exp-1' });
    expect(call.data.lessonsJson).toHaveLength(2);
    expect(call.data.lessonsJson[0]!.text).toBe('старый урок');
    expect(call.data.lessonsJson[1]).toMatchObject({
      text: 'Не мигрировать в пик продаж',
      type: 'manual',
      sourceBlockId: null,
    });
  });

  it('reject-ответ → experiment.update НЕ вызван', async () => {
    const mocks = makeMocks();
    setExperimentProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'удалить, это не эксперимент' } });

    expect(mocks.experimentUpdate).not.toHaveBeenCalled();
  });

  it('пустой ответ → experiment.update НЕ вызван', async () => {
    const mocks = makeMocks();
    setExperimentProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: {} });

    expect(mocks.experimentUpdate).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — companyprofile.missing_* → запись в профиль (B-3)', () => {
  function setCompanyProfileProbe(mocks: Mocks, reason: string): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason,
      payload: {
        contextCardId: 'cp-1',
        contextCardKind: 'company_profile',
        objectName: 'Компания',
        suggestedQuestion: 'Какая у компании миссия?',
      },
    });
  }

  it('подтверждённая миссия → companyProfile.update c body.mission.contentMd', async () => {
    const mocks = makeMocks();
    setCompanyProfileProbe(mocks, 'companyprofile.missing_mission');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'Делаем память компании для среднего бизнеса' },
    });

    expect(mocks.companyProfileUpdate).toHaveBeenCalledTimes(1);
    const call = mocks.companyProfileUpdate.mock.calls[0]![0] as {
      tenantId: string;
      userId: string;
      body: { mission?: { contentMd: string } };
    };
    expect(call.tenantId).toBe('org-classify');
    expect(call.userId).toBe('user-1');
    expect(call.body.mission?.contentMd).toBe('Делаем память компании для среднего бизнеса');
  });

  it('vision → body.vision; strategy → body.strategy', async () => {
    const mocksV = makeMocks();
    setCompanyProfileProbe(mocksV, 'companyprofile.missing_vision');
    await makeHandler({ mocks: mocksV, classifyEnabled: false }).handle({
      ...event,
      payload: { text: 'Стать стандартом памяти компаний в РФ' },
    });
    const vCall = mocksV.companyProfileUpdate.mock.calls[0]![0] as {
      body: { vision?: { contentMd: string } };
    };
    expect(vCall.body.vision?.contentMd).toBe('Стать стандартом памяти компаний в РФ');

    const mocksS = makeMocks();
    setCompanyProfileProbe(mocksS, 'companyprofile.missing_strategy');
    await makeHandler({ mocks: mocksS, classifyEnabled: false }).handle({
      ...event,
      payload: { text: 'Сначала средний бизнес, потом enterprise' },
    });
    const sCall = mocksS.companyProfileUpdate.mock.calls[0]![0] as {
      body: { strategy?: { contentMd: string } };
    };
    expect(sCall.body.strategy?.contentMd).toBe('Сначала средний бизнес, потом enterprise');
  });

  it('reject-ответ → companyProfile.update НЕ вызван', async () => {
    const mocks = makeMocks();
    setCompanyProfileProbe(mocks, 'companyprofile.missing_mission');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'удалить, это лишнее' } });

    expect(mocks.companyProfileUpdate).not.toHaveBeenCalled();
  });

  it('пустой ответ → companyProfile.update НЕ вызван', async () => {
    const mocks = makeMocks();
    setCompanyProfileProbe(mocks, 'companyprofile.missing_mission');
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: {} });

    expect(mocks.companyProfileUpdate).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — Ф1 typed-intent (outcome-маршрутизация)', () => {
  function setProbe(mocks: Mocks, reason: string, payload: Record<string, unknown>): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue({ ...buildProbe(), reason, payload });
  }

  it('outcome=unclear → 0 мутаций (decision.outcome_unknown)', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'decision.outcome_unknown', {
      contextCardId: 'dec-9',
      contextCardKind: 'decision',
      suggestedQuestion: 'Какой итог решения?',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Невозможно разобрать',
        outcome: 'unclear',
        value: '',
        confidence: 0.2,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await handler.handle({ ...event, payload: { text: 'эээ ну хз' } });

    expect(mocks.decisionUpdateMany).not.toHaveBeenCalled();
  });

  it('outcome=refine НЕ удаляет — дополняет описание (task.poorly_specified, issue)', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.poorly_specified', {
      contextCardId: 'issue-7',
      contextCardKind: 'issue',
      suggestedQuestion: 'Уточните описание',
    });
    mocks.issueFindFirst.mockResolvedValueOnce({
      description: '{"type":"doc"}',
      descriptionStripped: 'Описание про дедлайн до пятницы',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Уточнение текста, не удаление объекта',
        outcome: 'refine',
        value: 'убрать упоминание про дедлайн',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({
      mocks,
      classifyEnabled: true,
      dialogEnabled: false,
    });

    await handler.handle({
      ...event,
      payload: { text: 'удалить упоминание про дедлайн из описания' },
    });

    expect(mocks.softDelete).not.toHaveBeenCalled();
    expect(mocks.intakeIssueUpdateMany).not.toHaveBeenCalled();
    expect(mocks.issueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.issueUpdateMany.mock.calls[0]![0] as {
      data: { descriptionStripped: string };
    };
    expect(call.data.descriptionStripped).toContain('убрать упоминание про дедлайн');
  });

  it('experiment идемпотентность — дубликат по text → experiment.update НЕ вызван', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'experiment.result_without_lesson', {
      contextCardId: 'exp-1',
      contextCardKind: 'experiment',
      suggestedQuestion: 'Какой урок?',
    });
    mocks.experimentFindFirst.mockResolvedValueOnce({
      lessonsJson: [{ text: 'Не мигрировать в пик', type: 'manual', sourceBlockId: null }],
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Тот же урок',
        outcome: 'apply',
        value: 'Не мигрировать в пик',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await handler.handle({ ...event, payload: { text: 'Не мигрировать в пик' } });

    expect(mocks.experimentUpdate).not.toHaveBeenCalled();
  });

  it('task.due_date_missing — идемпотентный guard where.dueDate=null', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.due_date_missing', {
      contextCardId: 'issue-7',
      contextCardKind: 'issue',
      suggestedQuestion: 'Когда срок?',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Новый срок',
        outcome: 'apply',
        value: 'до пятницы',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await handler.handle({ ...event, payload: { text: 'до пятницы' } });

    expect(mocks.issueUpdateMany).toHaveBeenCalledTimes(1);
    const call = mocks.issueUpdateMany.mock.calls[0]![0] as {
      where: { dueDate: null };
      data: { dueDate: Date };
    };
    expect(call.where.dueDate).toBeNull();
    expect(call.data.dueDate).toBeInstanceOf(Date);
  });

  it('assignee не зарезолвлен → needs_clarification, addAssignee НЕ вызван', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.assignee_unresolved', {
      contextCardId: 'issue-7',
      contextCardKind: 'issue',
      suggestedQuestion: 'Кому поручить?',
    });
    mocks.assigneeResolve.mockResolvedValueOnce({ kind: 'not_found' });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Имя непонятное',
        outcome: 'apply',
        value: 'кто-то непонятный',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await expect(
      handler.handle({ ...event, payload: { text: 'кто-то непонятный' } }),
    ).resolves.toBeUndefined();

    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });

  it('companyprofile guard — поле уже заполнено вручную → update НЕ вызван', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'companyprofile.missing_mission', {
      contextCardId: 'cp-1',
      contextCardKind: 'company_profile',
      suggestedQuestion: 'Какая миссия?',
    });
    mocks.companyProfileGetRaw.mockResolvedValueOnce({
      missionJson: { contentMd: 'Уже заполнено вручную' },
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Новая миссия',
        outcome: 'apply',
        value: 'новая миссия',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await handler.handle({ ...event, payload: { text: 'новая миссия' } });

    expect(mocks.companyProfileUpdate).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — Ф2 dialog-state привязка', () => {
  it('валидный ответ — ensureState({tenantId, probeEventId, recipientUserId}) + recordTurn(outcome/value/confidence)', async () => {
    const mocks = makeMocks();
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Имя названо',
        outcome: 'apply',
        value: 'Анна',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await handler.handle(event);

    expect(mocks.dialogEnsureState).toHaveBeenCalledWith({
      tenantId: 'org-classify',
      probeEventId: 'probe-classify-1',
      recipientUserId: 'user-1',
    });
    expect(mocks.dialogRecordTurn).toHaveBeenCalledWith({
      probeEventId: 'probe-classify-1',
      outcome: 'apply',
      collectedValue: 'Анна',
      confidence: 0.9,
    });
  });

  it('ошибка dialog (ensureState throws) НЕ роняет handle', async () => {
    const mocks = makeMocks();
    mocks.dialogEnsureState.mockRejectedValueOnce(new Error('db down'));
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Имя названо',
        outcome: 'apply',
        value: 'Анна',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true });

    await expect(handler.handle(event)).resolves.toBeUndefined();
    expect(mocks.dialogRecordTurn).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — Ф3 clarify/escalate', () => {
  function setProbe(mocks: Mocks, reason: string, payload: Record<string, unknown>): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue({ ...buildProbe(), reason, payload });
  }

  it('low confidence (0.4) → probe.clarify, ноль мутаций, status=awaiting_dialog', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'decision.outcome_unknown', {
      contextCardId: 'dec-9',
      contextCardKind: 'decision',
      contextCardTitle: 'Миграция на DeepSeek',
      suggestedQuestion: 'Какой итог решения?',
    });
    mocks.dialogRecordTurn.mockResolvedValueOnce({
      id: 'pds-1',
      turnCount: 1,
      phase: 'awaiting_answer',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Низкая уверенность',
        outcome: 'apply',
        value: 'что-то невнятное',
        confidence: 0.4,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'ну как бы да' } });

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const callArg = mocks.sendNotification.mock.calls[0]![0] as {
      eventType: string;
    };
    expect(callArg.eventType).toBe('probe.clarify');
    expect(mocks.decisionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.probeEventUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mocks.probeEventUpdate.mock.calls[0]![0] as {
      where: { id: string };
      data: { status: string; dispatchedNotificationId: string };
    };
    expect(updateArg.where.id).toBe('probe-classify-1');
    expect(updateArg.data.status).toBe('awaiting_dialog');
    expect(updateArg.data.dispatchedNotificationId).toBe('clarify-notif-1');
    expect(mocks.dialogSetPhase).toHaveBeenCalledWith({
      probeEventId: 'probe-classify-1',
      phase: 'awaiting_clarification',
    });
  });

  it('counter_question → probe.clarify, не применение (addAssignee НЕ вызван)', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.assignee_unresolved', {
      contextCardId: 'issue-7',
      contextCardKind: 'issue',
      suggestedQuestion: 'Кому поручить?',
    });
    mocks.dialogRecordTurn.mockResolvedValueOnce({
      id: 'pds-1',
      turnCount: 1,
      phase: 'awaiting_answer',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Человек задал встречный вопрос',
        outcome: 'counter_question',
        value: '',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'а кто свободен?' } });

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const callArg = mocks.sendNotification.mock.calls[0]![0] as {
      eventType: string;
    };
    expect(callArg.eventType).toBe('probe.clarify');
    expect(mocks.addAssignee).not.toHaveBeenCalled();
  });

  it('turnCount=3 > maxTurns=2 → escalated_to_human + owner/admin', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'decision.missing_decider', {
      contextCardId: 'dec-9',
      contextCardKind: 'decision',
      contextCardTitle: 'Миграция на DeepSeek',
      suggestedQuestion: 'Кто принял решение?',
    });
    mocks.dialogRecordTurn.mockResolvedValueOnce({
      id: 'pds-1',
      turnCount: 3,
      phase: 'awaiting_clarification',
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Снова непонятно',
        outcome: 'unclear',
        value: '',
        confidence: 0.3,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'хз' } });

    expect(mocks.membershipFindMany).toHaveBeenCalledTimes(1);
    const membershipArg = mocks.membershipFindMany.mock.calls[0]![0] as {
      where: { orgId: string; role: { in: string[] } };
    };
    expect(membershipArg.where.orgId).toBe('org-classify');
    expect(membershipArg.where.role.in).toEqual(['owner', 'admin']);

    expect(mocks.sendNotification).toHaveBeenCalledTimes(2);
    for (const call of mocks.sendNotification.mock.calls) {
      const arg = call[0] as { eventType: string; recipientUserId: string };
      expect(arg.eventType).toBe('probe.clarify');
    }
    const recipients = mocks.sendNotification.mock.calls.map(
      (c) => (c[0] as { recipientUserId: string }).recipientUserId,
    );
    expect(recipients).toEqual(['owner-1', 'admin-1']);

    for (const call of mocks.sendNotification.mock.calls) {
      const arg = call[0] as { payload: { question: string } };
      expect(arg.payload.question).toContain('Ответ человека: «хз»');
    }

    expect(mocks.notificationUpdate).toHaveBeenCalledTimes(2);
    for (const call of mocks.notificationUpdate.mock.calls) {
      const arg = call[0] as {
        where: { id: string };
        data: { responseStatus: null };
      };
      expect(arg.where.id).toBe('clarify-notif-1');
      expect(arg.data.responseStatus).toBeNull();
    }

    expect(mocks.probeEventUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mocks.probeEventUpdate.mock.calls[0]![0] as {
      data: { status: string };
    };
    expect(updateArg.data.status).toBe('escalated_to_human');
    expect(mocks.dialogSetPhase).toHaveBeenCalledWith({
      probeEventId: 'probe-classify-1',
      phase: 'resolved',
    });
  });
});

describe('ProbeResponseHandler — Ф4 echo-back подтверждение', () => {
  function setProbe(mocks: Mocks, reason: string, payload: Record<string, unknown>): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue({ ...buildProbe(), reason, payload });
  }

  it('apply conf 0.95 → сперва probe.confirm, без мутации', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'decision.outcome_unknown', {
      contextCardId: 'dec-9',
      contextCardKind: 'decision',
      contextCardTitle: 'Миграция на DeepSeek',
      suggestedQuestion: 'Какой итог решения?',
    });
    mocks.dialogGetActive.mockResolvedValue(null);
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Уверенный результат',
        outcome: 'apply',
        value: 'Выручка выросла',
        confidence: 0.95,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'выручка выросла на 20%' } });

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const callArg = mocks.sendNotification.mock.calls[0]![0] as { eventType: string };
    expect(callArg.eventType).toBe('probe.confirm');
    expect(mocks.decisionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.probeEventUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mocks.probeEventUpdate.mock.calls[0]![0] as {
      data: { status: string; dispatchedNotificationId: string };
    };
    expect(updateArg.data.status).toBe('awaiting_dialog');
    expect(updateArg.data.dispatchedNotificationId).toBe('clarify-notif-1');
    expect(mocks.dialogSetPhase).toHaveBeenCalledWith({
      probeEventId: 'probe-classify-1',
      phase: 'awaiting_confirmation',
    });
  });

  it('подтверждение «да» → применение сохранённого намерения (из priorState, не из «да»)', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.completion_detail_missing', {
      contextCardId: 'issue-77',
      contextCardKind: 'issue',
      contextCardTitle: 'Сделать макет',
      suggestedQuestion: 'Что конкретно вы сделали?',
    });
    mocks.dialogGetActive.mockResolvedValue({
      id: 'pds-1',
      turnCount: 1,
      phase: 'awaiting_confirmation',
      outcome: 'apply',
      collectedValue: 'Собрал и отправил макет',
      confidence: 0.95,
    });
    mocks.dialogFinalize.mockResolvedValue(true);
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Подтверждение',
        outcome: 'apply',
        value: 'да',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'да' } });

    expect(mocks.dialogFinalize).toHaveBeenCalledTimes(1);
    expect(mocks.closureUpsert).toHaveBeenCalledTimes(1);
    const call = mocks.closureUpsert.mock.calls[0]![0] as {
      create: { evidenceQuote: string };
    };
    expect(call.create.evidenceQuote).toBe('Собрал и отправил макет');
    const statuses = mocks.probeEventUpdate.mock.calls.map(
      (c) => (c[0] as { data: { status?: string } }).data.status,
    );
    expect(statuses).toContain('applied');
    const ackCall = mocks.sendNotification.mock.calls.find(
      (c) => (c[0] as { eventType: string }).eventType === 'probe.answer_acknowledged',
    );
    expect(ackCall).toBeDefined();
  });

  it('delete при любой уверенности → echo-back, без авто-удаления', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.false_positive', {
      contextCardId: 'issue-7',
      contextCardKind: 'issue',
      contextCardTitle: 'Сверстать лендинг',
      suggestedQuestion: 'Это задача?',
    });
    mocks.dialogGetActive.mockResolvedValue(null);
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Человек просит удалить',
        outcome: 'delete',
        value: '',
        confidence: 0.95,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'это не задача, удали' } });

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const callArg = mocks.sendNotification.mock.calls[0]![0] as { eventType: string };
    expect(callArg.eventType).toBe('probe.confirm');
    expect(mocks.softDelete).not.toHaveBeenCalled();
  });

  it('двойной «да» → применение ровно один раз (идемпотентность)', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'task.completion_detail_missing', {
      contextCardId: 'issue-77',
      contextCardKind: 'issue',
      contextCardTitle: 'Сделать макет',
      suggestedQuestion: 'Что конкретно вы сделали?',
    });
    mocks.dialogGetActive.mockResolvedValue({
      id: 'pds-1',
      turnCount: 1,
      phase: 'awaiting_confirmation',
      outcome: 'apply',
      collectedValue: 'Собрал и отправил макет',
      confidence: 0.95,
    });
    mocks.dialogFinalize.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.llmCall.mockResolvedValue({
      text: JSON.stringify({
        reasoning: 'Подтверждение',
        outcome: 'apply',
        value: 'да',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'да' } });
    await handler.handle({ ...event, payload: { text: 'да' } });

    expect(mocks.dialogFinalize).toHaveBeenCalledTimes(2);
    expect(mocks.closureUpsert).toHaveBeenCalledTimes(1);
  });

  it('поправка на confirm → повторный classify, turnCount++, не применение', async () => {
    const mocks = makeMocks();
    setProbe(mocks, 'decision.missing_decider', {
      contextCardId: 'dec-9',
      contextCardKind: 'decision',
      contextCardTitle: 'Миграция на DeepSeek',
      suggestedQuestion: 'Кто принял решение?',
    });
    mocks.dialogGetActive.mockResolvedValue({
      id: 'pds-1',
      turnCount: 1,
      phase: 'awaiting_confirmation',
      outcome: 'apply',
      collectedValue: 'старое',
      confidence: 0.9,
    });
    mocks.llmCall.mockResolvedValueOnce({
      text: JSON.stringify({
        reasoning: 'Поправка ответственного',
        outcome: 'apply',
        value: 'Пётр',
        confidence: 0.9,
      }),
    });
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await handler.handle({ ...event, payload: { text: 'нет, ответственный Пётр' } });

    expect(mocks.sendNotification).toHaveBeenCalledTimes(1);
    const callArg = mocks.sendNotification.mock.calls[0]![0] as { eventType: string };
    expect(callArg.eventType).toBe('probe.confirm');
    expect(mocks.dialogRecordTurn).toHaveBeenCalledTimes(1);
    expect(mocks.decisionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.dialogFinalize).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — Ф5 адресность дайджеста (explicit probeEventId)', () => {
  let mocks: Mocks;

  beforeEach(() => {
    mocks = makeMocks();
  });

  it('payload.probeEventId → lookup по {id, tenantId, dispatchedNotificationId} (адресность сохранена)', async () => {
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      eventType: 'probe.digest',
      payload: { text: 'дедлайн до пятницы', probeEventId: 'probe-explicit-1' },
    });

    const findFirst = mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>;
    expect(findFirst).toHaveBeenCalledTimes(1);
    const where = findFirst.mock.calls[0]![0] as {
      where: { id?: string; tenantId: string; dispatchedNotificationId?: string };
    };
    expect(where.where.id).toBe('probe-explicit-1');
    expect(where.where.tenantId).toBe('org-classify');
    expect(where.where.dispatchedNotificationId).toBe('notif-classify-1');
  });

  it('инъекция чужого probeEventId (probe не привязан к notificationId) → no-op, не падает', async () => {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(null);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await expect(
      handler.handle({
        ...event,
        eventType: 'probe.digest',
        payload: { text: 'любой ответ', probeEventId: 'probe-чужой-X' },
      }),
    ).resolves.toBeUndefined();

    const findFirst = mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>;
    const where = findFirst.mock.calls[0]![0] as {
      where: { id?: string; dispatchedNotificationId?: string };
    };
    expect(where.where.id).toBe('probe-чужой-X');
    expect(where.where.dispatchedNotificationId).toBe('notif-classify-1');
    expect(mocks.ingestArgs).toHaveLength(0);
    expect(mocks.decisionUpdateMany).not.toHaveBeenCalled();
    expect(mocks.sendNotification).not.toHaveBeenCalled();
  });

  it('без payload.probeEventId → lookup по dispatchedNotificationId (старый путь)', async () => {
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({ ...event, payload: { text: 'ответ' } });

    const findFirst = mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>;
    const where = findFirst.mock.calls[0]![0] as {
      where: { id?: string; dispatchedNotificationId?: string };
    };
    expect(where.where.id).toBeUndefined();
    expect(where.where.dispatchedNotificationId).toBe('notif-classify-1');
  });
});

describe('ProbeResponseHandler — Ф6 деградация (LLM-классификатор упал)', () => {
  function setExistenceConfirmProbe(mocks: Mocks): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'regulation.existence_confirm',
      payload: {
        message: 'Кора зафиксировала регламент «Возвраты». Оставить, переименовать или удалить?',
        contextCardId: 'reg-99',
        contextCardKind: 'regulation',
      },
    });
  }

  it('classify throws → incProbeDialogDegraded, handler не падает, детерминированный one-shot применён', async () => {
    const mocks = makeMocks();
    setExistenceConfirmProbe(mocks);
    mocks.llmCall.mockRejectedValueOnce(new Error('llm proxy 500'));
    const handler = makeHandler({ mocks, classifyEnabled: true, dialogEnabled: true });

    await expect(
      handler.handle({ ...event, payload: { text: 'Удалить, это устарело' } }),
    ).resolves.toBeUndefined();

    expect(mocks.metrics.incProbeDialogDegraded).toHaveBeenCalledTimes(1);
    expect(mocks.curationDecide).toHaveBeenCalledTimes(1);
    const decideArg = mocks.curationDecide.mock.calls[0]![0] as { decisionType: string };
    expect(decideArg.decisionType).toBe('reject');
    expect(mocks.metrics.incProbeResponseClassified).not.toHaveBeenCalled();
  });
});

describe('ProbeResponseHandler — Ф6 мостик task.method_capture → дальняя цепочка', () => {
  function setMethodCaptureProbe(mocks: Mocks): void {
    (mocks.prisma.probeEvent.findFirst as ReturnType<typeof vi.fn>) = vi.fn().mockResolvedValue({
      ...buildProbe(),
      reason: 'task.method_capture',
      payload: {
        contextCardId: 'issue-mc-1',
        contextCardKind: 'issue',
        contextCardTitle: 'Найти подрядчика',
        formulatedQuestion: 'Как вы решали эту задачу?',
      },
    });
  }

  it('(bridge-1) ответ «как решал» уходит в дальнюю цепочку с signalTypeHint=reasoning', async () => {
    const mocks = makeMocks();
    setMethodCaptureProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'сначала погуглил, потом списался с подрядчиком и сравнил цены' },
    });

    expect(mocks.ingestAdapter.ingestNotificationResponse).toHaveBeenCalledTimes(1);
    expect(mocks.ingestAdapter.ingestNotificationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        signalTypeHint: 'reasoning',
        payload: expect.objectContaining({
          text: 'сначала погуглил, потом списался с подрядчиком и сравнил цены',
        }),
      }),
    );
  });

  it('(bridge-2) мостик идёт с тем же notificationId (ключ идемпотентности resp:<id>)', async () => {
    const mocks = makeMocks();
    setMethodCaptureProbe(mocks);
    const handler = makeHandler({ mocks, classifyEnabled: false });

    await handler.handle({
      ...event,
      payload: { text: 'разбил на шаги и делал по порядку' },
    });

    expect(mocks.ingestAdapter.ingestNotificationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationId: 'notif-classify-1',
        tenantId: 'org-classify',
        questionText: 'Как вы решали эту задачу?',
      }),
    );
  });
});
