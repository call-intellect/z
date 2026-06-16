import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { type IssueComment } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConversationalService } from '../../conversational/conversational.service';
import type { CreateCommentDto } from '../dto/comments/create-comment.dto';
import type { UpdateCommentDto } from '../dto/comments/update-comment.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';
import { TrackerEmitterService } from './tracker-emitter.service';
import { TrackerEventsService } from './tracker-events.service';
import { WebhookDispatcher } from './webhook-dispatcher.service';

export interface CommentResponseDto {
  id: string;
  issueId: string;
  authorId: string;
  parentCommentId: string | null;
  content: string;
  contentHtml: string | null;
  contentStripped: string | null;
  access: string;
  voiceUrl: string | null;
  voiceDuration: number | null;
  voiceTranscript: string | null;
  mentionedUserIds: string[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

const MENTION_REGEX = /@([a-zA-Z0-9_.-]{1,64})/gu;

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(TrackerEventsService)
    private readonly events: TrackerEventsService,
    @Inject(WebhookDispatcher)
    private readonly webhooks: WebhookDispatcher,
    @Inject(TrackerEmitterService)
    private readonly emitter: TrackerEmitterService,
    @Optional()
    @Inject(ConversationalService)
    private readonly conversational: ConversationalService | null = null,
  ) {}

  async create(
    issueId: string,
    dto: CreateCommentDto,
    tenantId: string,
    userId: string,
  ): Promise<CommentResponseDto> {
    const issue = await this.issues.requireIssue(issueId, tenantId);
    const mentionTokens = this.extractMentionTokens(`${dto.content} ${dto.contentStripped ?? ''}`);
    const mentionedUserIds = await this.resolveMentions(mentionTokens, tenantId);

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.issueComment.create({
        data: {
          issueId,
          authorId: userId,
          parentCommentId: dto.parentCommentId ?? null,
          content: dto.content,
          contentHtml: dto.contentHtml ?? null,
          contentStripped: dto.contentStripped ?? null,
          access: dto.access,
          voiceUrl: dto.voiceUrl ?? null,
          voiceDuration: dto.voiceDuration ?? null,
          voiceTranscript: dto.voiceTranscript ?? null,
        },
      });
      if (mentionedUserIds.length > 0) {
        await tx.issueMention.createMany({
          data: mentionedUserIds.map((mid) => ({
            issueId,
            commentId: created.id,
            mentionedUserId: mid,
            mentionedByUserId: userId,
          })),
          skipDuplicates: true,
        });
      }
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'commented',
        metadata: {
          commentId: created.id,
          mentions: mentionedUserIds,
        },
        tx,
      });
      return created;
    });

    const response = await this.assemble(comment.id);
    this.events.publishCommentCreated(response, tenantId);
    this.emitter.emitCommentCreated({
      issue,
      comment: response,
      actorUserId: userId,
    });
    const contextText = response.contentStripped ?? response.content;
    for (const mentionedUserId of response.mentionedUserIds) {
      this.emitter.emitMentionCreated({
        issue,
        actorUserId: userId,
        mentionedUserId,
        commentId: response.id,
        contextText,
      });
      if (this.conversational !== null && mentionedUserId !== userId) {
        const snippet = (contextText ?? response.content).slice(0, 200);
        void this.conversational
          .sendNotification({
            tenantId,
            recipientUserId: mentionedUserId,
            eventType: 'issue.mention',
            payload: {
              issueId: issue.id,
              commentId: response.id,
              byUserId: userId,
              snippet,
              issueIdentifier: issue.identifier,
              issueTitle: issue.title,
            },
            dataClass: 'internal',
            preferredChannelKinds: ['in_app', 'telegram_bot', 'max_bot'],
          })
          .catch((e) => {
            this.logger.warn(
              {
                commentId: response.id,
                mentionedUserId,
                err: e instanceof Error ? e.message : String(e),
              },
              'issue.mention notification failed',
            );
          });
      }
    }
    void this.webhooks.dispatch(tenantId, 'comment.created', { comment: response }).catch((e) => {
      this.logger.warn(
        { commentId: response.id, err: e instanceof Error ? e.message : String(e) },
        'comment.created webhook dispatch failed',
      );
    });
    return response;
  }

  async update(
    commentId: string,
    dto: UpdateCommentDto,
    tenantId: string,
    userId: string,
  ): Promise<CommentResponseDto> {
    const existing = await this.requireComment(commentId, tenantId);
    if (existing.authorId !== userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'comment_not_author',
          message: 'Редактировать может только автор комментария',
        },
      });
    }
    await this.prisma.issueComment.update({
      where: { id: commentId },
      data: {
        content: dto.content,
        contentHtml: dto.contentHtml ?? null,
        contentStripped: dto.contentStripped ?? null,
        editedAt: new Date(),
      },
    });
    const response = await this.assemble(commentId);
    this.events.publishCommentUpdated(response, tenantId);
    void this.webhooks.dispatch(tenantId, 'comment.updated', { comment: response }).catch((e) => {
      this.logger.warn(
        { commentId, err: e instanceof Error ? e.message : String(e) },
        'comment.updated webhook dispatch failed',
      );
    });
    return response;
  }

  async softDelete(
    commentId: string,
    tenantId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{ ok: true }> {
    const existing = await this.requireComment(commentId, tenantId);
    if (existing.authorId !== userId && !isAdmin) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'comment_not_author',
          message: 'Удалить комментарий может только автор или администратор',
        },
      });
    }
    await this.prisma.issueComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
    this.events.publishCommentDeleted(commentId, tenantId, existing.issueId);
    void this.webhooks
      .dispatch(tenantId, 'comment.deleted', {
        commentId,
        issueId: existing.issueId,
      })
      .catch((e) => {
        this.logger.warn(
          { commentId, err: e instanceof Error ? e.message : String(e) },
          'comment.deleted webhook dispatch failed',
        );
      });
    return { ok: true };
  }

  async findByIssue(issueId: string, tenantId: string): Promise<CommentResponseDto[]> {
    await this.issues.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueComment.findMany({
      where: { issueId, deletedAt: null },
      include: { mentions: { select: { mentionedUserId: true } } },
      orderBy: [{ createdAt: 'asc' }],
    });
    return rows.map((r) => this.toResponseFromInclude(r));
  }

  private async requireComment(
    commentId: string,
    tenantId: string,
  ): Promise<IssueComment & { issue: { tenantId: string } }> {
    const c = await this.prisma.issueComment.findUnique({
      where: { id: commentId },
      include: { issue: { select: { tenantId: true } } },
    });
    if (!c || c.deletedAt !== null) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    if (c.issue.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    return c;
  }

  private extractMentionTokens(text: string): string[] {
    const tokens = new Set<string>();
    for (const match of text.matchAll(MENTION_REGEX)) {
      const t = match[1];
      if (t) tokens.add(t.toLowerCase());
    }
    return [...tokens];
  }

  private async resolveMentions(tokens: string[], tenantId: string): Promise<string[]> {
    if (tokens.length === 0) return [];
    const members = await this.prisma.user.findMany({
      where: { memberships: { some: { orgId: tenantId } } },
      select: { id: true, email: true },
      take: 5_000,
    });
    const matched = new Set<string>();
    for (const m of members) {
      const localPart = m.email?.split('@')[0]?.toLowerCase() ?? null;
      if (tokens.includes(m.id) || (localPart && tokens.includes(localPart))) {
        matched.add(m.id);
      }
    }
    return [...matched];
  }

  private async assemble(commentId: string): Promise<CommentResponseDto> {
    const r = await this.prisma.issueComment.findUnique({
      where: { id: commentId },
      include: { mentions: { select: { mentionedUserId: true } } },
    });
    if (!r) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'comment_not_found', message: 'Комментарий не найден' },
      });
    }
    return this.toResponseFromInclude(r);
  }

  private toResponseFromInclude(
    r: IssueComment & { mentions: Array<{ mentionedUserId: string }> },
  ): CommentResponseDto {
    return {
      id: r.id,
      issueId: r.issueId,
      authorId: r.authorId,
      parentCommentId: r.parentCommentId,
      content: r.content,
      contentHtml: r.contentHtml,
      contentStripped: r.contentStripped,
      access: r.access,
      voiceUrl: r.voiceUrl,
      voiceDuration: r.voiceDuration,
      voiceTranscript: r.voiceTranscript,
      mentionedUserIds: r.mentions.map((m) => m.mentionedUserId),
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
    };
  }
}
