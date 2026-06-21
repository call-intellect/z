import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma, type Issue, type IssueAutomationRule } from '@prisma/client';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  AutomationTriggerType,
} from '../dto/automation-rules/automation-rule.types';

import { ActivityRecorderService } from './activity-recorder.service';

interface TrackerEventPayloadShape {
  type:
    | 'issue.created'
    | 'issue.status_changed'
    | 'issue.status_changed_to_blocked'
    | 'issue.status_changed_to_done'
    | 'issue.overdue_detected'
    | 'issue.assignee_changed'
    | 'comment.created'
    | 'mention.created';
  tenantId: string;
  occurredAt: string;
  issue: {
    id: string;
    identifier: string;
    title: string;
    description?: string | null;
    projectId: string;
    stateId?: string | null;
    dueDate?: string | null;
  };
  actor: {
    userId: string | null;
    actorType: 'user' | 'ai_agent' | 'system';
  };
  meta?: Record<string, unknown>;
}

interface AutomationContext {
  appliedRuleIds: string[];
  depth: number;
}

const TRIGGER_TYPE_MAP: Partial<
  Record<TrackerEventPayloadShape['type'], AutomationTriggerType>
> = {
  'issue.created': 'created',
  'issue.status_changed': 'status_changed',
  'issue.status_changed_to_blocked': 'status_changed',
  'issue.status_changed_to_done': 'status_changed',
  'issue.assignee_changed': 'assigned',
  'issue.overdue_detected': 'due_approaching',
};

@Injectable()
export class AutomationEngineService {
  private readonly logger = new Logger(AutomationEngineService.name);

  private static readonly MAX_DEPTH = 5;
  private static readonly AGENT_NAME = 'automation';

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
  ) {}

  @OnEvent('tracker.event_occurred', { async: true })
  async handleTrackerEvent(payload: TrackerEventPayloadShape): Promise<void> {
    try {
      await this.process(payload);
    } catch (err) {
      this.logger.warn(
        {
          type: payload?.type,
          issueId: payload?.issue?.id,
          tenantId: payload?.tenantId,
          err: err instanceof Error ? err.message : String(err),
        },
        'automation-engine: обработка события упала — событие пропущено',
      );
    }
  }

  private async process(payload: TrackerEventPayloadShape): Promise<void> {
    const enabled = await this.cfg.getDynamic<boolean>(
      'tracker.automationsEnabled',
      'TRACKER_AUTOMATIONS_ENABLED',
      true,
    );
    if (!enabled) {
      this.logger.debug('automation-engine: выключен (kill-switch) — пропуск');
      return;
    }

    const triggerType = TRIGGER_TYPE_MAP[payload.type];
    if (!triggerType) return;

    const ctx = this.extractContext(payload.meta);
    if (ctx.depth >= AutomationEngineService.MAX_DEPTH) {
      this.logger.warn(
        { issueId: payload.issue.id, depth: ctx.depth },
        'automation-engine: достигнута максимальная глубина — стоп (анти-рекурсия)',
      );
      return;
    }

    const rules = await this.prisma.issueAutomationRule.findMany({
      where: {
        tenantId: payload.tenantId,
        enabled: true,
        OR: [{ projectId: payload.issue.projectId }, { projectId: null }],
      },
    });

    for (const rule of rules) {
      if (ctx.appliedRuleIds.includes(rule.id)) continue;

      const trigger = (rule.trigger ?? {}) as AutomationTrigger;
      if (trigger.type !== triggerType) continue;
      if (!this.triggerMatches(trigger, payload)) continue;

      const conditions = (rule.conditions ?? []) as AutomationCondition[];
      const issue = await this.prisma.issue.findUnique({
        where: { id: payload.issue.id },
      });
      if (!issue || issue.tenantId !== payload.tenantId || issue.deletedAt) {
        continue;
      }
      if (!this.conditionsMatch(conditions, issue)) continue;

      await this.applyRule(rule, issue, ctx);
    }
  }

  private extractContext(meta: Record<string, unknown> | undefined): AutomationContext {
    const raw = meta?.automation as
      | { appliedRuleIds?: unknown; depth?: unknown }
      | undefined;
    const appliedRuleIds = Array.isArray(raw?.appliedRuleIds)
      ? raw.appliedRuleIds.filter((x): x is string => typeof x === 'string')
      : [];
    const depth = typeof raw?.depth === 'number' ? raw.depth : 0;
    return { appliedRuleIds, depth };
  }

  private triggerMatches(
    trigger: AutomationTrigger,
    payload: TrackerEventPayloadShape,
  ): boolean {
    if (trigger.type === 'status_changed' && trigger.toCategory) {
      const newCategory =
        (payload.meta?.newStateCategory as string | undefined) ??
        (payload.meta?.newCategory as string | undefined) ??
        null;
      if (newCategory && newCategory !== trigger.toCategory) return false;
    }
    return true;
  }

  private conditionsMatch(
    conditions: AutomationCondition[],
    issue: Issue,
  ): boolean {
    return conditions.every((c) => this.conditionMatches(c, issue));
  }

  private conditionMatches(c: AutomationCondition, issue: Issue): boolean {
    const actual = this.readField(issue, c.field);
    switch (c.op) {
      case 'eq':
        return actual === c.value;
      case 'neq':
        return actual !== c.value;
      case 'in':
        return Array.isArray(c.value) && c.value.includes(actual);
      case 'not_in':
        return Array.isArray(c.value) && !c.value.includes(actual);
      case 'gt':
        return (
          typeof actual === 'number' &&
          typeof c.value === 'number' &&
          actual > c.value
        );
      case 'lt':
        return (
          typeof actual === 'number' &&
          typeof c.value === 'number' &&
          actual < c.value
        );
      case 'is_empty':
        return actual === null || actual === undefined || actual === '';
      case 'is_not_empty':
        return actual !== null && actual !== undefined && actual !== '';
      default:
        return false;
    }
  }

  private readField(issue: Issue, field: string): unknown {
    switch (field) {
      case 'priority':
        return issue.priority;
      case 'stateId':
        return issue.stateId;
      case 'goalId':
        return issue.goalId;
      case 'cycleId':
        return issue.cycleId;
      case 'externalSource':
        return issue.externalSource;
      case 'checklistDoneCount':
        return issue.checklistDoneCount;
      case 'checklistTotalCount':
        return issue.checklistTotalCount;
      default:
        return undefined;
    }
  }

  private async applyRule(
    rule: IssueAutomationRule,
    issue: Issue,
    ctx: AutomationContext,
  ): Promise<void> {
    const nextCtx: AutomationContext = {
      appliedRuleIds: [...ctx.appliedRuleIds, rule.id],
      depth: ctx.depth + 1,
    };
    const actions = (rule.actions ?? []) as AutomationAction[];
    for (const action of actions) {
      try {
        await this.applyAction(action, rule, issue, nextCtx);
      } catch (err) {
        this.logger.warn(
          {
            ruleId: rule.id,
            issueId: issue.id,
            actionType: action.type,
            err: err instanceof Error ? err.message : String(err),
          },
          'automation-engine: действие правила упало — пропущено',
        );
      }
    }
  }

  private async applyAction(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
    nextCtx: AutomationContext,
  ): Promise<void> {
    switch (action.type) {
      case 'set_status':
        await this.applySetStatus(action, rule, issue, nextCtx);
        break;
      case 'assign':
        await this.applyAssign(action, rule, issue);
        break;
      case 'add_label':
        await this.applyAddLabel(action, rule, issue);
        break;
      case 'set_priority':
        await this.applySetPriority(action, rule, issue);
        break;
      case 'create_subtask':
        await this.applyCreateSubtask(action, rule, issue);
        break;
      case 'notify':
        await this.applyNotify(action, rule, issue);
        break;
      default:
        break;
    }
  }

  private async applySetStatus(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
    nextCtx: AutomationContext,
  ): Promise<void> {
    let targetStateId = action.stateId ?? null;
    if (!targetStateId && action.toCategory) {
      const state = await this.prisma.issueState.findFirst({
        where: { projectId: issue.projectId, category: action.toCategory },
        orderBy: { sequence: 'asc' },
        select: { id: true },
      });
      targetStateId = state?.id ?? null;
    }
    if (!targetStateId || targetStateId === issue.stateId) return;
    const newState = await this.prisma.issueState.findFirst({
      where: { id: targetStateId, projectId: issue.projectId },
      select: { id: true, category: true },
    });
    if (!newState) return;
    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.IssueUpdateInput = {
        state: { connect: { id: targetStateId! } },
      };
      if (newState.category === 'completed' && !issue.completedAt) {
        data.completedAt = new Date();
      } else if (newState.category !== 'completed' && issue.completedAt) {
        data.completedAt = null;
      }
      await tx.issue.update({ where: { id: issue.id }, data });
      await this.recordActivity(
        tx,
        rule,
        issue.id,
        'status_changed',
        'stateId',
        issue.stateId,
        targetStateId,
      );
    });
    await this.process({
      type: 'issue.status_changed',
      tenantId: issue.tenantId,
      occurredAt: new Date().toISOString(),
      issue: {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description ?? null,
        projectId: issue.projectId,
        stateId: targetStateId,
        dueDate: issue.dueDate?.toISOString() ?? null,
      },
      actor: { userId: null, actorType: 'system' },
      meta: {
        newStateId: targetStateId,
        newStateCategory: newState.category,
        automation: {
          appliedRuleIds: nextCtx.appliedRuleIds,
          depth: nextCtx.depth,
        },
      },
    });
  }

  private async applyAssign(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
  ): Promise<void> {
    const userId = await this.resolveAssignee(action, issue);
    if (!userId) return;
    const existing = await this.prisma.issueAssignee.findUnique({
      where: { issueId_userId: { issueId: issue.id, userId } },
      select: { id: true },
    });
    if (existing) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.issueAssignee.create({
        data: { issueId: issue.id, userId, assignedById: rule.createdById },
      });
      await this.recordActivity(
        tx,
        rule,
        issue.id,
        'assigned',
        null,
        null,
        { userId },
      );
    });
  }

  private async resolveAssignee(
    action: AutomationAction,
    issue: Issue,
  ): Promise<string | null> {
    if (action.assigneeUserId) return action.assigneeUserId;
    if (action.assignTo === 'creator') return issue.createdById;
    if (action.assignTo === 'owner') {
      const project = await this.prisma.project.findUnique({
        where: { id: issue.projectId },
        select: { ownerId: true },
      });
      return project?.ownerId ?? null;
    }
    return null;
  }

  private async applyAddLabel(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
  ): Promise<void> {
    if (!action.labelId) return;
    const label = await this.prisma.label.findFirst({
      where: { id: action.labelId, tenantId: issue.tenantId },
      select: { id: true },
    });
    if (!label) return;
    const existing = await this.prisma.issueLabel.findUnique({
      where: { issueId_labelId: { issueId: issue.id, labelId: action.labelId } },
      select: { issueId: true },
    });
    if (existing) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.issueLabel.create({
        data: { issueId: issue.id, labelId: action.labelId! },
      });
      await this.recordActivity(tx, rule, issue.id, 'label_added', null, null, {
        labelId: action.labelId,
      });
    });
  }

  private async applySetPriority(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
  ): Promise<void> {
    if (!action.priority || action.priority === issue.priority) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.issue.update({
        where: { id: issue.id },
        data: { priority: action.priority! },
      });
      await this.recordActivity(
        tx,
        rule,
        issue.id,
        'updated',
        'priority',
        issue.priority,
        action.priority,
      );
    });
  }

  private async applyCreateSubtask(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
  ): Promise<void> {
    const title = action.subtaskTitle?.trim();
    if (!title) return;
    await this.prisma.$transaction(async (tx) => {
      const maxRow = await tx.issue.aggregate({
        where: { projectId: issue.projectId },
        _max: { sequenceId: true },
      });
      const sequenceId = (maxRow._max.sequenceId ?? 0) + 1;
      const project = await tx.project.findUnique({
        where: { id: issue.projectId },
        select: { identifier: true, defaultStateId: true },
      });
      const identifier = `${project?.identifier ?? 'TASK'}-${sequenceId}`;
      const created = await tx.issue.create({
        data: {
          tenantId: issue.tenantId,
          projectId: issue.projectId,
          identifier,
          sequenceId,
          title,
          priority: 'none',
          stateId: project?.defaultStateId ?? null,
          boardId: issue.boardId,
          parentId: issue.id,
          createdById: rule.createdById,
          createdManually: false,
          externalSource: 'automation',
        },
      });
      await this.recordActivity(
        tx,
        rule,
        issue.id,
        'subtask_created',
        null,
        null,
        { subtaskId: created.id, title },
      );
    });
  }

  private async applyNotify(
    action: AutomationAction,
    rule: IssueAutomationRule,
    issue: Issue,
  ): Promise<void> {
    await this.recordActivity(
      this.prisma,
      rule,
      issue.id,
      'automation_notified',
      null,
      null,
      { message: action.message ?? rule.name },
    );
  }

  private async recordActivity(
    tx: Prisma.TransactionClient | PrismaService,
    rule: IssueAutomationRule,
    issueId: string,
    verb: string,
    field: string | null,
    oldValue: unknown,
    newValue: unknown,
  ): Promise<void> {
    await this.activity.record({
      tenantId: rule.tenantId,
      issueId,
      actorUserId: null,
      actorType: 'system',
      agentName: AutomationEngineService.AGENT_NAME,
      verb,
      field,
      oldValue,
      newValue,
      metadata: { automationRuleId: rule.id, ruleName: rule.name },
      tx: tx as Prisma.TransactionClient,
    });
  }
}
