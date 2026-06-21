import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { type IssueProgressUpdate } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ProvenancePreviewRef } from '../../knowledge-core/services/provenance.service';
import type { CreateProgressUpdateDto } from '../dto/progress-updates/create-progress-update.dto';
import type { UpdateProgressUpdateDto } from '../dto/progress-updates/update-progress-update.dto';

import { ActivityRecorderService } from './activity-recorder.service';
import { IssuesService } from './issues.service';

export interface ProgressUpdateResponseDto {
  id: string;
  issueId: string;
  authorId: string | null;
  authorType: string;
  health: string;
  body: string;
  doneText: string | null;
  nextText: string | null;
  draftState: string | null;
  sourceBlockIds: string[];
  evidenceQuote: string | null;
  confidence: number | null;
  previewQuote: string | null;
  previewSourceRef: ProvenancePreviewRef | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ProgressUpdatesService {
  private readonly logger = new Logger(ProgressUpdatesService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ActivityRecorderService)
    private readonly activity: ActivityRecorderService,
    @Inject(IssuesService) private readonly issues: IssuesService,
  ) {}

  async findByIssue(
    issueId: string,
    tenantId: string,
  ): Promise<ProgressUpdateResponseDto[]> {
    await this.issues.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueProgressUpdate.findMany({
      where: { issueId, tenantId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async create(
    issueId: string,
    dto: CreateProgressUpdateDto,
    tenantId: string,
    userId: string,
  ): Promise<ProgressUpdateResponseDto> {
    await this.issues.requireIssue(issueId, tenantId);
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.issueProgressUpdate.create({
        data: {
          tenantId,
          issueId,
          authorId: userId,
          authorType: 'human',
          health: dto.health,
          body: dto.body,
          doneText: dto.doneText ?? null,
          nextText: dto.nextText ?? null,
          draftState: null,
          periodStart: dto.periodStart ? new Date(dto.periodStart) : null,
          periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : null,
        },
      });
      await this.activity.record({
        tenantId,
        issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'progress_updated',
        metadata: { progressUpdateId: row.id, health: dto.health },
        tx,
      });
      return row;
    });
    return this.toResponse(created);
  }

  async update(
    id: string,
    dto: UpdateProgressUpdateDto,
    tenantId: string,
    userId: string,
  ): Promise<ProgressUpdateResponseDto> {
    const existing = await this.requireUpdate(id, tenantId);
    if (existing.authorId !== userId) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'progress_update_not_author',
          message: 'Редактировать может только автор обновления',
        },
      });
    }
    const updated = await this.prisma.issueProgressUpdate.update({
      where: { id },
      data: {
        ...(dto.health !== undefined ? { health: dto.health } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.doneText !== undefined ? { doneText: dto.doneText } : {}),
        ...(dto.nextText !== undefined ? { nextText: dto.nextText } : {}),
      },
    });
    return this.toResponse(updated);
  }

  /** Подтверждение авто-черновика Коры: pending → accepted (как есть) | edited (с правками). */
  async confirm(
    id: string,
    dto: UpdateProgressUpdateDto,
    tenantId: string,
    userId: string,
  ): Promise<ProgressUpdateResponseDto> {
    const existing = await this.requireUpdate(id, tenantId);
    if (existing.draftState !== 'pending') {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'progress_update_not_pending',
          message: 'Подтверждать можно только черновик в статусе «ожидает»',
        },
      });
    }
    const edited =
      dto.health !== undefined ||
      dto.body !== undefined ||
      dto.doneText !== undefined ||
      dto.nextText !== undefined;
    const confirmed = await this.prisma.$transaction(async (tx) => {
      const row = await tx.issueProgressUpdate.update({
        where: { id },
        data: {
          authorId: userId,
          draftState: edited ? 'edited' : 'accepted',
          ...(dto.health !== undefined ? { health: dto.health } : {}),
          ...(dto.body !== undefined ? { body: dto.body } : {}),
          ...(dto.doneText !== undefined ? { doneText: dto.doneText } : {}),
          ...(dto.nextText !== undefined ? { nextText: dto.nextText } : {}),
        },
      });
      await this.activity.record({
        tenantId,
        issueId: existing.issueId,
        actorUserId: userId,
        actorType: 'user',
        verb: 'progress_updated',
        metadata: {
          progressUpdateId: row.id,
          health: row.health,
          confirmedDraft: true,
          edited,
        },
        tx,
      });
      return row;
    });
    return this.toResponse(confirmed);
  }

  async softDelete(
    id: string,
    tenantId: string,
    userId: string,
    isAdmin: boolean,
  ): Promise<{ ok: true }> {
    const existing = await this.requireUpdate(id, tenantId);
    if (existing.authorId !== userId && !isAdmin) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'progress_update_not_author',
          message: 'Удалить обновление может только автор или администратор',
        },
      });
    }
    await this.prisma.issueProgressUpdate.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private async requireUpdate(
    id: string,
    tenantId: string,
  ): Promise<IssueProgressUpdate> {
    const row = await this.prisma.issueProgressUpdate.findUnique({
      where: { id },
    });
    if (!row || row.deletedAt !== null || row.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'progress_update_not_found',
          message: 'Обновление прогресса не найдено',
        },
      });
    }
    return row;
  }

  private toResponse(r: IssueProgressUpdate): ProgressUpdateResponseDto {
    return {
      id: r.id,
      issueId: r.issueId,
      authorId: r.authorId,
      authorType: r.authorType,
      health: r.health,
      body: r.body,
      doneText: r.doneText,
      nextText: r.nextText,
      draftState: r.draftState,
      sourceBlockIds: r.sourceBlockIds,
      evidenceQuote: r.evidenceQuote,
      confidence: r.confidence !== null ? Number(r.confidence) : null,
      previewQuote: r.previewQuote ?? null,
      previewSourceRef:
        (r.previewSourceRef as ProvenancePreviewRef | null) ?? null,
      periodStart: r.periodStart?.toISOString() ?? null,
      periodEnd: r.periodEnd?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
