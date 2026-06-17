import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { CoreQueueService } from '../../core-queue/core-queue.service';
import type { RecognitionFormulateJobData } from '../../core-queue/queues';
import type {
  ContributionsSnapshotDto,
  ListRecognitionsQuery,
  ListRecognitionsResponseDto,
  MyContributionsResponseDto,
  RecognitionResponseDto,
  UserBadgeDto,
} from '../dto/recognition.dto';

@Injectable()
export class RecognitionService {
  private readonly logger = new Logger(RecognitionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CoreQueueService) private readonly queue: CoreQueueService,
  ) {}

  async enqueueFormulate(args: RecognitionFormulateJobData): Promise<{ jobId: string }> {
    return this.queue.enqueueRecognitionFormulate(args);
  }

  async getContributionsForUser(userId: string): Promise<ContributionsSnapshotDto> {
    const snap = await this.prisma.contributionSnapshot.findUnique({
      where: { userId },
    });
    if (!snap) {
      return {
        userId,
        ideasInDevelopment: 0,
        ideasShipped: 0,
        thanksReceived: 0,
        thanksReceivedWeek: 0,
        currentCheckinStreak: 0,
        longestCheckinStreak: 0,
        helpfulComments: 0,
        probeQuestionsAnswered: 0,
        updatedAt: null,
      };
    }
    return {
      userId: snap.userId,
      ideasInDevelopment: snap.ideasInDevelopment,
      ideasShipped: snap.ideasShipped,
      thanksReceived: snap.thanksReceived,
      thanksReceivedWeek: snap.thanksReceivedWeek,
      currentCheckinStreak: snap.currentCheckinStreak,
      longestCheckinStreak: snap.longestCheckinStreak,
      helpfulComments: snap.helpfulComments,
      probeQuestionsAnswered: snap.probeQuestionsAnswered,
      updatedAt: snap.updatedAt.toISOString(),
    };
  }

  async getBadgesForUser(userId: string): Promise<UserBadgeDto[]> {
    const rows = await this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { awardedAt: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      badgeId: r.badgeId,
      slug: r.badge.slug,
      name: r.badge.name,
      description: r.badge.description,
      iconUrl: r.badge.iconUrl,
      awardedAt: r.awardedAt.toISOString(),
    }));
  }

  async getMyContributions(userId: string, tenantId: string): Promise<MyContributionsResponseDto> {
    const [snapshot, badges, recent] = await Promise.all([
      this.getContributionsForUser(userId),
      this.getBadgesForUser(userId),
      this.prisma.recognition.findMany({
        where: { toUserId: userId, tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    return {
      snapshot,
      badges,
      recentRecognitions: recent.map((r) => this.toResponse(r)),
    };
  }

  async listMyRecognitions(
    userId: string,
    tenantId: string,
    q: ListRecognitionsQuery,
  ): Promise<ListRecognitionsResponseDto> {
    const where: Record<string, unknown> = { toUserId: userId, tenantId };
    if (q.type) where.type = q.type;
    if (q.fromDate || q.toDate) {
      const createdAt: Record<string, Date> = {};
      if (q.fromDate) createdAt.gte = new Date(`${q.fromDate}T00:00:00.000Z`);
      if (q.toDate) createdAt.lte = new Date(`${q.toDate}T23:59:59.999Z`);
      where.createdAt = createdAt;
    }
    const [items, total] = await Promise.all([
      this.prisma.recognition.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: (q.page - 1) * q.limit,
      }),
      this.prisma.recognition.count({ where }),
    ]);
    return {
      items: items.map((r) => this.toResponse(r)),
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.max(1, Math.ceil(total / q.limit)),
    };
  }

  private toResponse(r: {
    id: string;
    tenantId: string;
    fromUserId: string | null;
    toUserId: string;
    type: string;
    contextEntityType: string | null;
    contextEntityId: string | null;
    message: string | null;
    visibility: string;
    createdAt: Date;
  }): RecognitionResponseDto {
    return {
      id: r.id,
      tenantId: r.tenantId,
      fromUserId: r.fromUserId,
      toUserId: r.toUserId,
      type: r.type as RecognitionResponseDto['type'],
      contextEntityType: r.contextEntityType,
      contextEntityId: r.contextEntityId,
      message: r.message,
      visibility: r.visibility as RecognitionResponseDto['visibility'],
      createdAt: r.createdAt.toISOString(),
    };
  }
}
