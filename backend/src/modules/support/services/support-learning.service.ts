import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';

import { TypedConfigService } from '../../../common/config/index';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MessageService } from '../../messaging/services/message.service';

import { SupportAccessService } from './support-access.service';
import { SupportContourService } from './support-contour.service';
import { SupportEditClassifyService } from './support-edit-classify.service';

const BLOCK_CITATION_REGEX = /\[BLOCK:[a-zA-Z0-9_-]+\]/g;

interface PendingDraft {
  id: string;
  conversationId: string;
  tenantId: string;
  content: string;
  cloneConfidence: string | null;
  groundednessScore: string | null;
}

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
    @Inject(MessageService) private readonly messages: MessageService,
    @Inject(TypedConfigService) private readonly cfg: TypedConfigService,
  ) {}

  async accept(draftMessageId: string, agentUserId: string): Promise<{ ok: true }> {
    const draft = await this.requirePendingDraft(draftMessageId);

    const draftText = draft.content;
    const externalText = toClientFacingText(draftText);

    await this.messages.appendTicketMessage({
      tenantId: draft.tenantId,
      conversationId: draft.conversationId,
      authorUserId: agentUserId,
      content: externalText,
      access: 'external',
      authorType: 'human',
    });

    await this.messages.setDraftState({ messageId: draft.id, draftState: 'accepted' });

    await this.markFirstResponded(draft.conversationId);

    await this.prisma.$transaction(async (tx) => {
      await tx.supportDraftOutcome.create({
        data: {
          tenantId: draft.tenantId,
          conversationId: draft.conversationId,
          draftMessageId: draft.id,
          draftText,
          finalText: externalText,
          outcome: 'accepted',
          cloneConfidence: draft.cloneConfidence,
          groundednessScore: draft.groundednessScore,
        },
      });

      await tx.llmPreferenceSample.create({
        data: {
          tenantId: draft.tenantId,
          taskType: 'support-clone-draft',
          inputContext: { conversationId: draft.conversationId },
          modelOutput: { answer: draftText },
          label: 'correct',
          recordedBy: agentUserId,
        },
      });
    });

    return { ok: true };
  }

  async reject(draftMessageId: string, agentUserId: string): Promise<{ ok: true }> {
    const draft = await this.requirePendingDraft(draftMessageId);

    await this.messages.setDraftState({ messageId: draft.id, draftState: 'rejected' });

    await this.prisma.$transaction(async (tx) => {
      await tx.supportDraftOutcome.create({
        data: {
          tenantId: draft.tenantId,
          conversationId: draft.conversationId,
          draftMessageId: draft.id,
          draftText: draft.content,
          finalText: null,
          outcome: 'rejected',
          cloneConfidence: draft.cloneConfidence,
          groundednessScore: draft.groundednessScore,
        },
      });

      await tx.llmPreferenceSample.create({
        data: {
          tenantId: draft.tenantId,
          taskType: 'support-clone-draft',
          inputContext: { conversationId: draft.conversationId },
          modelOutput: { answer: draft.content },
          label: 'wrong',
          recordedBy: agentUserId,
        },
      });
    });

    return { ok: true };
  }

  async recordEdit(draftMessageId: string, finalText: string, agentUserId: string): Promise<void> {
    const draft = await this.messages.getDraftMessage(draftMessageId);
    if (!draft || draft.authorType !== 'clone') {
      return;
    }

    const editType = await this.editClassify.classify({
      tenantId: draft.tenantId,
      userId: agentUserId,
      draft: draft.content,
      final: finalText,
    });

    await this.messages.setDraftState({ messageId: draft.id, draftState: 'edited' });

    await this.prisma.$transaction(async (tx) => {
      await tx.supportDraftOutcome.create({
        data: {
          tenantId: draft.tenantId,
          conversationId: draft.conversationId,
          draftMessageId: draft.id,
          draftText: draft.content,
          finalText,
          outcome: 'edited',
          editType,
          cloneConfidence: draft.cloneConfidence,
          groundednessScore: draft.groundednessScore,
        },
      });

      await tx.llmPreferenceSample.create({
        data: {
          tenantId: draft.tenantId,
          taskType: 'support-clone-draft',
          inputContext: { conversationId: draft.conversationId },
          modelOutput: { answer: draft.content },
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

    const ticket = await this.prisma.supportTicket.findUnique({
      where: { conversationId },
      select: { tenantId: true, conversation: { select: { title: true } } },
    });
    if (!ticket) return { promoted: 0 };
    const question = ticket.conversation.title ?? '';

    const outcomes = await this.prisma.supportDraftOutcome.findMany({
      where: {
        tenantId: ticket.tenantId,
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
        const r = await this.contour.promoteAnswer(question, finalText);
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

  private async requirePendingDraft(draftMessageId: string): Promise<PendingDraft> {
    const draft = await this.messages.getDraftMessage(draftMessageId);
    if (!draft || draft.authorType !== 'clone' || draft.draftState !== 'pending') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'draft_not_available',
          message: 'Черновик недоступен',
        },
      });
    }
    return {
      id: draft.id,
      conversationId: draft.conversationId,
      tenantId: draft.tenantId,
      content: draft.content,
      cloneConfidence: draft.cloneConfidence,
      groundednessScore: draft.groundednessScore,
    };
  }

  private async markFirstResponded(conversationId: string): Promise<void> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { conversationId },
      select: { firstRespondedAt: true },
    });
    if (ticket && !ticket.firstRespondedAt) {
      await this.prisma.supportTicket.update({
        where: { conversationId },
        data: { firstRespondedAt: new Date() },
      });
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
