import { Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import {
  type DebateVerdict,
  MultiAgentDebateService,
} from '../../ai/services/multi-agent-debate.service';
import {
  SUPPORT_CONTOUR_CURATE_JSON_SCHEMA,
  SUPPORT_CONTOUR_CURATE_SYSTEM_PROMPT,
  buildSupportContourCurateUserPrompt,
} from '../prompts/support-contour-curate.prompt';

import { SupportAccessService } from './support-access.service';

const CURATE_BLOCK_LIMIT = 200;

const SIGNALS_WINDOW_MS = 24 * 60 * 60 * 1000;

type CuratorAction = 'keep' | 'promote' | 'fix' | 'merge' | 'archive';
const DESTRUCTIVE_ACTIONS: ReadonlySet<CuratorAction> = new Set<CuratorAction>([
  'fix',
  'merge',
  'archive',
]);

interface CuratorProposal {
  blockId: string;
  action: CuratorAction;
  reason: string;
  targetBlockId: string | null;
}

interface ContourBlockLite {
  id: string;
  criticalQuestion: string | null;
  trustedAnswer: string | null;
  status: string;
}

@Injectable()
export class SupportCuratorService {
  private readonly logger = new Logger(SupportCuratorService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(MultiAgentDebateService)
    private readonly debate: MultiAgentDebateService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async runOnce(now: Date): Promise<{ skipped?: boolean; proposed: number; applied: number }> {
    if (!this.cfg.supportDesk.curatorEnabled) {
      return { skipped: true, proposed: 0, applied: 0 };
    }

    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      return { proposed: 0, applied: 0 };
    }
    const supportGroupId = await this.access.getSupportGroupId(vendorOrgId);
    if (!supportGroupId) {
      return { proposed: 0, applied: 0 };
    }

    const runDate = now.toISOString().slice(0, 10);

    const blocks: ContourBlockLite[] = await this.prisma.ideaBlock.findMany({
      where: {
        tenantId: vendorOrgId,
        status: 'canonical',
        blockAccess: { some: { groupId: supportGroupId } },
      },
      select: {
        id: true,
        criticalQuestion: true,
        trustedAnswer: true,
        status: true,
      },
      take: CURATE_BLOCK_LIMIT,
    });
    if (blocks.length === 0) {
      return { proposed: 0, applied: 0 };
    }

    const since = new Date(now.getTime() - SIGNALS_WINDOW_MS);
    const signals = await this.prisma.supportDraftOutcome.findMany({
      where: { tenantId: vendorOrgId, createdAt: { gte: since } },
      select: { issueId: true, outcome: true, editType: true },
    });

    let proposals: CuratorProposal[];
    try {
      const llmResult = await this.llm.call({
        taskType: 'support-contour-curate',
        tenantId: vendorOrgId,
        systemPrompt: SUPPORT_CONTOUR_CURATE_SYSTEM_PROMPT,
        userMessage: buildSupportContourCurateUserPrompt({
          blocks: blocks.map((b) => ({
            id: b.id,
            criticalQuestion: b.criticalQuestion ?? '',
            trustedAnswer: b.trustedAnswer ?? '',
          })),
          dailySignals: signals.map((s) => ({
            outcome: s.outcome,
            editType: s.editType,
          })),
        }),
        maxTokens: 4000,
        responseFormat: {
          type: 'json_schema',
          name: 'support_contour_curate_response',
          strict: true,
          schema: SUPPORT_CONTOUR_CURATE_JSON_SCHEMA,
        },
      });
      proposals = parseCurateJson(llmResult.text);
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        'support-curator: LLM-куратор упал — прогон без изменений',
      );
      return { proposed: 0, applied: 0 };
    }

    const blocksById = new Map(blocks.map((b) => [b.id, b]));
    let proposed = 0;
    let applied = 0;

    for (const proposal of proposals) {
      const block = blocksById.get(proposal.blockId);
      if (!block) {
        continue;
      }
      proposed++;
      try {
        const wasApplied = await this.applyAction({
          vendorOrgId,
          runDate,
          proposal,
          block,
          blocksById,
          now,
        });
        if (wasApplied) {
          applied++;
        }
      } catch (err) {
        this.logger.warn(
          {
            blockId: proposal.blockId,
            action: proposal.action,
            err: err instanceof Error ? err.message : String(err),
          },
          'support-curator: применение действия упало — пропуск',
        );
      }
    }

    this.logger.log(
      { runDate, proposed, applied, blocks: blocks.length },
      'support-curator: прогон завершён',
    );
    return { proposed, applied };
  }

  private async applyAction(args: {
    vendorOrgId: string;
    runDate: string;
    proposal: CuratorProposal;
    block: ContourBlockLite;
    blocksById: Map<string, ContourBlockLite>;
    now: Date;
  }): Promise<boolean> {
    const { vendorOrgId, runDate, proposal, block, blocksById, now } = args;
    const { blockId, action, reason } = proposal;

    const existing = await this.prisma.supportCuratorAction.findFirst({
      where: { tenantId: vendorOrgId, runDate, blockId },
      select: { id: true },
    });
    if (existing) {
      return false;
    }

    if (block.status !== 'canonical') {
      return false;
    }

    if (!DESTRUCTIVE_ACTIONS.has(action)) {
      await this.recordAudit({
        vendorOrgId,
        runDate,
        blockId,
        action,
        reason,
        targetBlockId: null,
        debateDecision: null,
        applied: action === 'promote',
      });
      return action === 'promote';
    }

    const verdict = await this.debate.judge({
      taskType: 'debate-decision-supersede',
      taskFamily: 'decision-supersede',
      task: `Куратор предлагает ${action} блока: ${reason}`,
      candidates: [{ action, blockId, targetBlockId: proposal.targetBlockId }],
      contextBlocks: [
        {
          id: block.id,
          criticalQuestion: block.criticalQuestion ?? '',
          trustedAnswer: block.trustedAnswer ?? '',
        },
      ],
      tenantId: vendorOrgId,
      n: 3,
      rounds: 1,
    });

    if (!isAffirmative(verdict)) {
      await this.recordAudit({
        vendorOrgId,
        runDate,
        blockId,
        action,
        reason,
        targetBlockId: null,
        debateDecision: verdict.decision,
        applied: false,
      });
      return false;
    }

    let appliedTargetBlockId: string | null = null;
    if (action === 'merge') {
      const target = proposal.targetBlockId ? blocksById.get(proposal.targetBlockId) : undefined;
      const targetValid = !!target && target.id !== blockId && target.status === 'canonical';
      if (targetValid) {
        await this.prisma.ideaBlock.update({
          where: { id_tenantId: { id: blockId, tenantId: vendorOrgId } },
          data: { status: 'merged_into', mergedIntoId: proposal.targetBlockId },
        });
        appliedTargetBlockId = proposal.targetBlockId;
      } else {
        await this.prisma.ideaBlock.update({
          where: { id_tenantId: { id: blockId, tenantId: vendorOrgId } },
          data: { status: 'archived', supersededAt: now },
        });
      }
    } else {
      await this.prisma.ideaBlock.update({
        where: { id_tenantId: { id: blockId, tenantId: vendorOrgId } },
        data: { status: 'archived', supersededAt: now },
      });
    }

    await this.recordAudit({
      vendorOrgId,
      runDate,
      blockId,
      action,
      reason,
      targetBlockId: appliedTargetBlockId,
      debateDecision: verdict.decision,
      applied: true,
    });
    return true;
  }

  private async recordAudit(args: {
    vendorOrgId: string;
    runDate: string;
    blockId: string;
    action: CuratorAction;
    reason: string;
    targetBlockId: string | null;
    debateDecision: string | null;
    applied: boolean;
  }): Promise<void> {
    await this.prisma.supportCuratorAction.create({
      data: {
        tenantId: args.vendorOrgId,
        runDate: args.runDate,
        blockId: args.blockId,
        action: args.action,
        reason: args.reason,
        targetBlockId: args.targetBlockId,
        debateDecision: args.debateDecision,
        applied: args.applied,
      },
    });
  }
}

function isAffirmative(verdict: DebateVerdict): boolean {
  if (verdict.consensusType === 'split') return false;
  if (verdict.fallbackUsed) return false;
  const decision = verdict.decision.trim().toLowerCase();
  const AFFIRM = new Set(['supersedes', 'supersede', 'merge', 'accept', 'archive', 'fix']);
  return AFFIRM.has(decision);
}

function parseCurateJson(text: string): CuratorProposal[] {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as { actions?: unknown };
    if (!Array.isArray(parsed.actions)) return [];
    const result: CuratorProposal[] = [];
    for (const raw of parsed.actions) {
      if (typeof raw !== 'object' || raw === null) continue;
      const obj = raw as Record<string, unknown>;
      const blockId = typeof obj.blockId === 'string' ? obj.blockId : '';
      const action = obj.action;
      if (blockId.length === 0 || !isCuratorAction(action)) continue;
      const reason = typeof obj.reason === 'string' ? obj.reason : '';
      const targetBlockId =
        typeof obj.targetBlockId === 'string' && obj.targetBlockId.length > 0
          ? obj.targetBlockId
          : null;
      result.push({ blockId, action, reason, targetBlockId });
    }
    return result;
  } catch {
    return [];
  }
}

function isCuratorAction(x: unknown): x is CuratorAction {
  return x === 'keep' || x === 'promote' || x === 'fix' || x === 'merge' || x === 'archive';
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
