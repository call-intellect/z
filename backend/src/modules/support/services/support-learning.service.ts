import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ActivityRecorderService } from '../../tracker/services/activity-recorder.service';

import { SupportAccessService } from './support-access.service';
import { SupportContourService } from './support-contour.service';
import { SupportEditClassifyService } from './support-edit-classify.service';

const BLOCK_CITATION_REGEX = /\[BLOCK:[a-zA-Z0-9_-]+\]/g;

@Injectable()
export class SupportLearningService {
  private readonly logger = new Logger(SupportLearningService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SupportEditClassifyService)
    private readonly editClassify: SupportEditClassifyService,
    @Inject(SupportContourService)
    private readonly contour: SupportContourService,
    @Inject(SupportAccessService)
    private readonly access: SupportAccessService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async accept(draftCommentId: string, agentUserId: string): Promise<{ ok: true }> {
    const { comment, issue } = await this.requirePendingDraft(draftCommentId);

    const draftText = comment.content;
    const externalText = toClientFacingText(draftText);

    await this.prisma.$transaction(async (tx) => {
      await tx.issueComment.create({
        data: {
          issueId: issue.id,
          authorId: agentUserId,
          content: externalText,
          contentStripped: externalText,
          access: 'external',
          authorType: 'human',
        },
      });

      if (!issue.firstRespondedAt) {
        await tx.issue.update({
          where: { id: issue.id },
          data: { firstRespondedAt: new Date(), updatedAt: new Date() },
        });
      } else {
        await tx.issue.update({
          where: { id: issue.id },
          data: { updatedAt: new Date() },
        });
      }

      await tx.issueComment.update({
        where: { id: comment.id },
        data: { draftState: 'accepted' },
      });

      await tx.supportDraftOutcome.create({
        data: {
          tenantId: issue.tenantId,
          conversationId: issue.id,
          draftMessageId: comment.id,
          draftText,
          finalText: externalText,
          outcome: 'accepted',
          cloneConfidence: comment.cloneConfidence ? comment.cloneConfidence.toString() : null,
          groundednessScore: comment.groundednessScore
            ? comment.groundednessScore.toString()
            : null,
        },
      });

      await tx.llmPreferenceSample.create({
        data: {
          tenantId: issue.tenantId,
          taskType: 'support-clone-draft',
          inputContext: { issueId: issue.id },
          modelOutput: { answer: draftText },
          label: 'correct',
          recordedBy: agentUserId,
        },
      });
    });

    await this.recordActivitySafe({
      tenantId: issue.tenantId,
      issueId: issue.id,
      actorUserId: agentUserId,
      verb: 'draft_accepted',
    });

    return { ok: true };
  }

  async reject(draftCommentId: string, agentUserId: string): Promise<{ ok: true }> {
    const { comment, issue } = await this.requirePendingDraft(draftCommentId);

    await this.prisma.$transaction(async (tx) => {
      await tx.issueComment.update({
        where: { id: comment.id },
        data: { draftState: 'rejected' },
      });

      await tx.supportDraftOutcome.create({
        data: {
          tenantId: issue.tenantId,
          conversationId: issue.id,
          draftMessageId: comment.id,
          draftText: comment.content,
          finalText: null,
          outcome: 'rejected',
          cloneConfidence: comment.cloneConfidence ? comment.cloneConfidence.toString() : null,
          groundednessScore: comment.groundednessScore
            ? comment.groundednessScore.toString()
            : null,
        },
      });

      await tx.llmPreferenceSample.create({
        data: {
          tenantId: issue.tenantId,
          taskType: 'support-clone-draft',
          inputContext: { issueId: issue.id },
          modelOutput: { answer: comment.content },
          label: 'wrong',
          recordedBy: agentUserId,
        },
      });
    });

    await this.recordActivitySafe({
      tenantId: issue.tenantId,
      issueId: issue.id,
      actorUserId: agentUserId,
      verb: 'draft_rejected',
    });

    return { ok: true };
  }

  async recordEdit(draftCommentId: string, finalText: string, agentUserId: string): Promise<void> {
    const comment = await this.prisma.issueComment.findUnique({
      where: { id: draftCommentId },
      select: {
        id: true,
        issueId: true,
        content: true,
        authorType: true,
        draftState: true,
        cloneConfidence: true,
        groundednessScore: true,
      },
    });
    if (!comment || comment.authorType !== 'clone') {
      return;
    }

    const issue = await this.prisma.issue.findUnique({
      where: { id: comment.issueId },
      select: { id: true, tenantId: true },
    });
    if (!issue) return;

    const editType = await this.editClassify.classify({
      tenantId: issue.tenantId,
      userId: agentUserId,
      draft: comment.content,
      final: finalText,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.issueComment.update({
        where: { id: comment.id },
        data: { draftState: 'edited' },
      });

      await tx.supportDraftOutcome.create({
        data: {
          tenantId: issue.tenantId,
          conversationId: issue.id,
          draftMessageId: comment.id,
          draftText: comment.content,
          finalText,
          outcome: 'edited',
          editType,
          cloneConfidence: comment.cloneConfidence ? comment.cloneConfidence.toString() : null,
          groundednessScore: comment.groundednessScore
            ? comment.groundednessScore.toString()
            : null,
        },
      });

      await tx.llmPreferenceSample.create({
        data: {
          tenantId: issue.tenantId,
          taskType: 'support-clone-draft',
          inputContext: { issueId: issue.id },
          modelOutput: { answer: comment.content },
          label: 'edited',
          recordedBy: agentUserId,
        },
      });
    });
  }

  async maybePromote(conversationId: string): Promise<{ promoted: number }> {
    const minCsat = await this.cfg.getDynamic<number>('support_promote_min_csat', undefined, 4);

    const rating = await this.prisma.issueRating.findUnique({
      where: { conversationId },
      select: { score: true },
    });
    if (!rating || rating.score < minCsat) {
      return { promoted: 0 };
    }

    const issue = await this.prisma.issue.findUnique({
      where: { id: conversationId },
      select: { id: true, tenantId: true, title: true },
    });
    if (!issue) return { promoted: 0 };

    const outcomes = await this.prisma.supportDraftOutcome.findMany({
      where: {
        tenantId: issue.tenantId,
        conversationId,
        outcome: { in: ['accepted', 'edited'] },
        promotedToContour: false,
      },
      select: { id: true, finalText: true },
    });

    let promoted = 0;
    for (const outcome of outcomes) {
      const finalText = outcome.finalText?.trim();
      if (!finalText) continue;
      try {
        const r = await this.contour.promoteAnswer(issue.title, finalText);
        if (r.promoted) {
          await this.prisma.supportDraftOutcome.update({
            where: { id: outcome.id },
            data: { promotedToContour: true },
          });
          promoted++;
        }
      } catch (err) {
        this.logger.warn(
          {
            conversationId,
            outcomeId: outcome.id,
            err: err instanceof Error ? err.message : String(err),
          },
          'maybePromote: промоут пары упал — пропуск',
        );
      }
    }

    return { promoted };
  }

  private async requirePendingDraft(draftCommentId: string): Promise<{
    comment: {
      id: string;
      content: string;
      cloneConfidence: { toString(): string } | null;
      groundednessScore: { toString(): string } | null;
    };
    issue: { id: string; tenantId: string; firstRespondedAt: Date | null };
  }> {
    const comment = await this.prisma.issueComment.findUnique({
      where: { id: draftCommentId },
      select: {
        id: true,
        issueId: true,
        content: true,
        authorType: true,
        draftState: true,
        cloneConfidence: true,
        groundednessScore: true,
      },
    });
    if (!comment || comment.authorType !== 'clone' || comment.draftState !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'draft_not_available',
          message: 'Черновик недоступен',
        },
      });
    }

    const issue = await this.prisma.issue.findUnique({
      where: { id: comment.issueId },
      select: { id: true, tenantId: true, firstRespondedAt: true },
    });
    if (!issue) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'draft_not_available',
          message: 'Черновик недоступен',
        },
      });
    }

    return {
      comment: {
        id: comment.id,
        content: comment.content,
        cloneConfidence: comment.cloneConfidence,
        groundednessScore: comment.groundednessScore,
      },
      issue,
    };
  }

  private async recordActivitySafe(args: {
    tenantId: string;
    issueId: string;
    actorUserId: string;
    verb: string;
  }): Promise<void> {
    try {
      await this.activity.record({
        tenantId: args.tenantId,
        issueId: args.issueId,
        actorUserId: args.actorUserId,
        actorType: 'user',
        verb: args.verb,
      });
    } catch (err) {
      this.logger.warn(
        {
          issueId: args.issueId,
          verb: args.verb,
          err: err instanceof Error ? err.message : String(err),
        },
        'recordActivitySafe: запись активности упала — продолжаю',
      );
    }
  }
}

function toClientFacingText(draft: string): string {
  let text = draft;
  if (text.startsWith('⚠')) {
    const sep = text.indexOf('\n\n');
    if (sep >= 0) {
      text = text.slice(sep + 2);
    }
  }
  return text
    .replace(BLOCK_CITATION_REGEX, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
