import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { LlmRouterService } from '../../ai/services/llm-router.service';
import { ChatV2RetrievalService } from '../../knowledge-core/services/chat-v2-retrieval.service';
import { ConfidenceCalibrationService } from '../../knowledge-core/services/confidence-calibration.service';
import {
  SUPPORT_CLONE_DRAFT_JSON_SCHEMA,
  SUPPORT_CLONE_DRAFT_SYSTEM_PROMPT,
  buildSupportCloneDraftUserPrompt,
} from '../prompts/support-clone-draft.prompt';

import { SupportAccessService } from './support-access.service';
import { SupportAnswerCriticService } from './support-answer-critic.service';

const BLOCK_CITATION_REGEX = /\[BLOCK:([a-zA-Z0-9_-]+)\]/g;

const CONTOUR_RETRIEVAL_LIMIT = 8;

const FEW_SHOT_LIMIT = 3;

interface ContourBlock {
  id: string;
  criticalQuestion: string | null;
  trustedAnswer: string | null;
}

@Injectable()
export class SupportCloneService {
  private readonly logger = new Logger(SupportCloneService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(ChatV2RetrievalService)
    private readonly retrieval: ChatV2RetrievalService,
    @Inject(LlmRouterService) private readonly llm: LlmRouterService,
    @Inject(SupportAnswerCriticService)
    private readonly critic: SupportAnswerCriticService,
    @Inject(ConfidenceCalibrationService)
    private readonly calibration: ConfidenceCalibrationService,
  ) {}

  async generateDraft(ticketId: string, agentUserId: string): Promise<{ draftCommentId: string }> {
    const vendorOrgId = await this.access.getVendorOrgId();
    if (!vendorOrgId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'SUPPORT_DESK_DISABLED',
          message: 'Деск поддержки не настроен',
        },
      });
    }
    const supportGroupId = await this.access.getSupportGroupId(vendorOrgId);
    if (!supportGroupId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'SUPPORT_CONTOUR_NOT_INITIALIZED',
          message: 'Контур поддержки не инициализирован',
        },
      });
    }

    const issue = await this.prisma.issue.findFirst({
      where: {
        id: ticketId,
        tenantId: vendorOrgId,
        supportCustomerUserId: { not: null },
        deletedAt: null,
      },
      select: { id: true, title: true },
    });
    if (!issue) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'ticket_not_found', message: 'Тикет не найден' },
      });
    }

    const lastExternal = await this.prisma.issueComment.findFirst({
      where: {
        issueId: issue.id,
        access: 'external',
        authorType: { not: 'clone' },
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true, contentStripped: true },
    });
    const question =
      lastExternal?.contentStripped?.trim() || lastExternal?.content?.trim() || issue.title;

    try {
      const ranked = await this.retrieval.fetchCandidates({
        tenantId: vendorOrgId,
        scope: 'org',
        scopeId: null,
        query: question,
        limit: CONTOUR_RETRIEVAL_LIMIT,
        graphHops: 0,
        contourGroupId: supportGroupId,
      });
      const blockIds = ranked.map((r) => r.blockId);

      const contourBlocks: ContourBlock[] =
        blockIds.length > 0
          ? await this.prisma.ideaBlock.findMany({
              where: { id: { in: blockIds } },
              select: {
                id: true,
                criticalQuestion: true,
                trustedAnswer: true,
                name: true,
              },
            })
          : [];

      const fewShot = await this.loadFewShot(vendorOrgId);

      const llmResult = await this.llm.call({
        taskType: 'support-clone-draft',
        tenantId: vendorOrgId,
        userId: agentUserId,
        systemPrompt: SUPPORT_CLONE_DRAFT_SYSTEM_PROMPT,
        userMessage: buildSupportCloneDraftUserPrompt({
          question,
          contourBlocks: contourBlocks.map((b) => ({
            id: b.id,
            criticalQuestion: b.criticalQuestion ?? '',
            trustedAnswer: b.trustedAnswer ?? '',
          })),
          fewShot,
        }),
        maxTokens: 1500,
        responseFormat: {
          type: 'json_schema',
          name: 'support_clone_draft_response',
          strict: true,
          schema: SUPPORT_CLONE_DRAFT_JSON_SCHEMA,
        },
        sourceRef: { type: 'support_ticket', id: issue.id },
      });

      const parsed = parseDraftJson(llmResult.text);
      if (parsed === null) {
        this.logger.warn(
          { ticketId, model: llmResult.modelUsed },
          'support-clone-draft: непарсимый JSON — отдаём человеку',
        );
        throw new ServiceUnavailableException({
          ok: false,
          error: {
            code: 'SUPPORT_CLONE_DRAFT_FAILED',
            message: 'Клон не смог сформировать черновик',
          },
        });
      }

      const { answer } = parsed;
      const rawConfidence = clamp01(parsed.confidence);

      const cloneConfidence = await this.calibration.calibrate(
        rawConfidence,
        'support-clone-draft',
      );

      const crit = await this.critic.check({
        tenantId: vendorOrgId,
        userId: agentUserId,
        answer,
        contourBlocks,
      });

      let draftContent = answer;
      if (crit.verdict !== 'answer') {
        const recommendation =
          crit.verdict === 'escalate' ? 'эскалировать специалисту' : 'уточнить детали у клиента';
        const note = `⚠ Клон не уверен (обоснованность ${(crit.groundedness * 100).toFixed(0)}%). Рекомендация: ${recommendation}.\n\n`;
        draftContent = note + answer;
      }

      if (!hasBlockCitation(answer)) {
        draftContent = `${draftContent}\n\n(без ссылок на базу — проверьте обоснованность)`;
      }

      const comment = await this.prisma.issueComment.create({
        data: {
          issueId: issue.id,
          authorId: agentUserId,
          content: draftContent,
          contentStripped: draftContent,
          access: 'internal',
          authorType: 'clone',
          draftState: 'pending',
          cloneConfidence: clamp01(cloneConfidence).toFixed(3),
          groundednessScore: clamp01(crit.groundedness).toFixed(3),
        },
        select: { id: true },
      });

      return { draftCommentId: comment.id };
    } catch (err) {
      if (
        err instanceof ServiceUnavailableException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      this.logger.warn(
        {
          ticketId,
          err: err instanceof Error ? err.message : String(err),
        },
        'generateDraft: retrieval/LLM упал — отдаём человеку (fail-open)',
      );
      throw new ServiceUnavailableException({
        ok: false,
        error: {
          code: 'SUPPORT_CLONE_DRAFT_FAILED',
          message: 'Клон не смог сформировать черновик',
        },
      });
    }
  }

  private async loadFewShot(vendorOrgId: string): Promise<{ question: string; answer: string }[]> {
    const outcomes = await this.prisma.supportDraftOutcome.findMany({
      where: {
        tenantId: vendorOrgId,
        outcome: { in: ['accepted', 'edited'] },
        finalText: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: FEW_SHOT_LIMIT,
      select: { issueId: true, finalText: true },
    });
    if (outcomes.length === 0) return [];

    const issueIds = [...new Set(outcomes.map((o) => o.issueId))];
    const issues = await this.prisma.issue.findMany({
      where: { id: { in: issueIds } },
      select: { id: true, title: true },
    });
    const titleById = new Map(issues.map((i) => [i.id, i.title]));

    return outcomes
      .filter((o): o is typeof o & { finalText: string } => !!o.finalText)
      .map((o) => ({
        question: titleById.get(o.issueId) ?? '',
        answer: o.finalText,
      }));
  }
}

interface ParsedDraft {
  answer: string;
  confidence: number;
}

function parseDraftJson(text: string): ParsedDraft | null {
  try {
    const cleaned = stripCodeFence(text).trim();
    const parsed = JSON.parse(cleaned) as {
      answer?: unknown;
      confidence?: unknown;
    };
    if (typeof parsed.answer !== 'string' || parsed.answer.trim().length === 0) {
      return null;
    }
    const confidence = Number(parsed.confidence);
    return {
      answer: parsed.answer,
      confidence: Number.isFinite(confidence) ? confidence : 0,
    };
  } catch {
    return null;
  }
}

function hasBlockCitation(text: string): boolean {
  BLOCK_CITATION_REGEX.lastIndex = 0;
  return BLOCK_CITATION_REGEX.test(text);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

function stripCodeFence(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
}
