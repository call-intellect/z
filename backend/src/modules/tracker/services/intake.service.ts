import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type IntakeIssue } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateIntakeDto,
  ListIntakeQuery,
} from '../dto/intake/create-intake.dto';
import type {
  TriageIntakeDto,
  UpdateIntakeDto,
} from '../dto/intake/triage-intake.dto';
import type { IssueResponseDto } from '../dto/issues/issue-response.dto';

import { IssuesService } from './issues.service';

export interface IntakeResponseDto {
  id: string;
  tenantId: string;
  projectId: string | null;
  status: string;
  source: string;
  sourceEmail: string | null;
  externalSource: string | null;
  externalId: string | null;
  rawContent: string;
  extractedTitle: string | null;
  extractedDescription: string | null;
  suggestedProjectId: string | null;
  suggestedAssigneeId: string | null;
  suggestedGoalId: string | null;
  suggestedPriority: string | null;
  suggestedDueDate: string | null;
  suggestedLabels: string[];
  confidence: string | null;
  triagedByUserId: string | null;
  triagedAt: string | null;
  rejectedReason: string | null;
  snoozedUntil: string | null;
  createdIssueId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListIntakeResponse {
  items: IntakeResponseDto[];
  total: number;
  page: number;
  limit: number;
}

export interface TriageIntakeResult {
  intake: IntakeResponseDto;
  /** Создана при decision='accept'. */
  createdIssue: IssueResponseDto | null;
}

/**
 * IntakeService — входящие задачи перед триажем (из webhook чек-инов,
 * email-адаптера, Telegram-бота, concierge-AI). Триаж: accept / reject /
 * snooze / duplicate.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
  ) {}

  /** Создать intake-карточку. Не требует userId — может вызвать webhook-адаптер. */
  async create(
    dto: CreateIntakeDto,
    tenantId: string,
  ): Promise<IntakeResponseDto> {
    const created = await this.prisma.intakeIssue.create({
      data: {
        tenantId,
        projectId: dto.projectId ?? null,
        source: dto.source,
        sourceEmail: dto.sourceEmail ?? null,
        externalSource: dto.externalSource ?? null,
        externalId: dto.externalId ?? null,
        rawContent: dto.rawContent,
        extractedTitle: dto.extractedTitle ?? null,
        extractedDescription: dto.extractedDescription ?? null,
        suggestedProjectId: dto.suggestedProjectId ?? null,
        suggestedAssigneeId: dto.suggestedAssigneeId ?? null,
        suggestedGoalId: dto.suggestedGoalId ?? null,
        suggestedPriority: dto.suggestedPriority ?? null,
        suggestedDueDate: dto.suggestedDueDate ?? null,
        suggestedLabels: dto.suggestedLabels,
        confidence:
          dto.confidence != null
            ? new Prisma.Decimal(dto.confidence)
            : null,
      },
    });
    return this.toResponse(created);
  }

  /** Список intake-карточек. Доступ: admin / project_manager. */
  async findAll(
    tenantId: string,
    query: ListIntakeQuery,
  ): Promise<ListIntakeResponse> {
    const where: Prisma.IntakeIssueWhereInput = { tenantId };
    if (query.status) where.status = query.status;
    if (query.source) where.source = query.source;
    if (query.projectId) where.projectId = query.projectId;
    const [items, total] = await Promise.all([
      this.prisma.intakeIssue.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        take: query.limit,
        skip: (query.page - 1) * query.limit,
      }),
      this.prisma.intakeIssue.count({ where }),
    ]);
    return {
      items: items.map((i) => this.toResponse(i)),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** PATCH полей intake (extraction overrides / suggestions). */
  async update(
    id: string,
    dto: UpdateIntakeDto,
    tenantId: string,
    _userId: string,
  ): Promise<IntakeResponseDto> {
    await this.requireIntake(id, tenantId);
    const updated = await this.prisma.intakeIssue.update({
      where: { id },
      data: {
        ...(dto.extractedTitle !== undefined && {
          extractedTitle: dto.extractedTitle,
        }),
        ...(dto.extractedDescription !== undefined && {
          extractedDescription: dto.extractedDescription,
        }),
        ...(dto.projectId !== undefined && { projectId: dto.projectId }),
        ...(dto.suggestedProjectId !== undefined && {
          suggestedProjectId: dto.suggestedProjectId,
        }),
        ...(dto.suggestedAssigneeId !== undefined && {
          suggestedAssigneeId: dto.suggestedAssigneeId,
        }),
        ...(dto.suggestedGoalId !== undefined && {
          suggestedGoalId: dto.suggestedGoalId,
        }),
        ...(dto.suggestedPriority !== undefined && {
          suggestedPriority: dto.suggestedPriority,
        }),
        ...(dto.suggestedDueDate !== undefined && {
          suggestedDueDate: dto.suggestedDueDate,
        }),
        ...(dto.suggestedLabels !== undefined && {
          suggestedLabels: dto.suggestedLabels,
        }),
      },
    });
    return this.toResponse(updated);
  }

  /**
   * Триаж intake. accept → создаёт Issue в targetProjectId; reject → status=
   * 'rejected' + reason; snooze → status='snoozed' + snoozedUntil; duplicate →
   * status='duplicate' + ссылка на createdIssueId=duplicateOfIssueId.
   */
  async triage(
    id: string,
    dto: TriageIntakeDto,
    tenantId: string,
    userId: string,
  ): Promise<TriageIntakeResult> {
    const intake = await this.requireIntake(id, tenantId);
    if (intake.status !== 'pending' && intake.status !== 'snoozed') {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'intake_already_triaged',
          message: `Intake уже в статусе '${intake.status}'`,
        },
      });
    }

    let createdIssue: IssueResponseDto | null = null;
    const triagedAt = new Date();

    if (dto.decision === 'accept') {
      const targetProjectId =
        dto.targetProjectId ??
        intake.projectId ??
        intake.suggestedProjectId ??
        null;
      if (!targetProjectId) {
        throw new BadRequestException({
          ok: false,
          error: {
            code: 'target_project_required',
            message: 'Не указан проект для создания задачи',
          },
        });
      }
      const title =
        dto.overrideTitle ??
        intake.extractedTitle ??
        intake.rawContent.slice(0, 200);
      const description =
        dto.overrideDescription ??
        intake.extractedDescription ??
        intake.rawContent;
      createdIssue = await this.issues.create(
        targetProjectId,
        {
          title,
          description,
          descriptionHtml: null,
          descriptionStripped: description,
          priority:
            dto.overridePriority ??
            (intake.suggestedPriority as
              | 'urgent'
              | 'high'
              | 'medium'
              | 'low'
              | 'none'
              | null) ??
            'none',
          stateId: null,
          parentId: null,
          estimatePoints: null,
          sortOrder: 0,
          startDate: null,
          dueDate: dto.overrideDueDate ?? intake.suggestedDueDate ?? null,
          cycleId: null,
          goalId: dto.overrideGoalId ?? intake.suggestedGoalId ?? null,
          assigneeUserIds:
            dto.overrideAssigneeUserIds ??
            (intake.suggestedAssigneeId ? [intake.suggestedAssigneeId] : []),
          labelIds: [], // matching label ids — Sprint 2 (resolve по suggestedLabels)
          externalSource: intake.externalSource ?? intake.source,
          externalId: intake.externalId,
        },
        tenantId,
        userId,
      );
    } else if (dto.decision === 'snooze' && !dto.snoozedUntil) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'snoozed_until_required',
          message: 'Для snooze требуется snoozedUntil',
        },
      });
    } else if (dto.decision === 'duplicate' && !dto.duplicateOfIssueId) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'duplicate_of_issue_required',
          message: 'Для duplicate требуется duplicateOfIssueId',
        },
      });
    }

    const updated = await this.prisma.intakeIssue.update({
      where: { id },
      data: {
        status:
          dto.decision === 'accept'
            ? 'accepted'
            : dto.decision === 'reject'
              ? 'rejected'
              : dto.decision === 'snooze'
                ? 'snoozed'
                : 'duplicate',
        triagedByUserId: userId,
        triagedAt,
        rejectedReason:
          dto.decision === 'reject' ? (dto.reason ?? null) : null,
        snoozedUntil:
          dto.decision === 'snooze' ? (dto.snoozedUntil ?? null) : null,
        createdIssueId:
          dto.decision === 'accept'
            ? (createdIssue?.id ?? null)
            : dto.decision === 'duplicate'
              ? (dto.duplicateOfIssueId ?? null)
              : null,
      },
    });

    return { intake: this.toResponse(updated), createdIssue };
  }

  private async requireIntake(
    id: string,
    tenantId: string,
  ): Promise<IntakeIssue> {
    const i = await this.prisma.intakeIssue.findFirst({
      where: { id, tenantId },
    });
    if (!i) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'intake_not_found', message: 'Intake-карточка не найдена' },
      });
    }
    return i;
  }

  private toResponse(i: IntakeIssue): IntakeResponseDto {
    return {
      id: i.id,
      tenantId: i.tenantId,
      projectId: i.projectId,
      status: i.status,
      source: i.source,
      sourceEmail: i.sourceEmail,
      externalSource: i.externalSource,
      externalId: i.externalId,
      rawContent: i.rawContent,
      extractedTitle: i.extractedTitle,
      extractedDescription: i.extractedDescription,
      suggestedProjectId: i.suggestedProjectId,
      suggestedAssigneeId: i.suggestedAssigneeId,
      suggestedGoalId: i.suggestedGoalId,
      suggestedPriority: i.suggestedPriority,
      suggestedDueDate: i.suggestedDueDate?.toISOString() ?? null,
      suggestedLabels: i.suggestedLabels,
      confidence: i.confidence?.toString() ?? null,
      triagedByUserId: i.triagedByUserId,
      triagedAt: i.triagedAt?.toISOString() ?? null,
      rejectedReason: i.rejectedReason,
      snoozedUntil: i.snoozedUntil?.toISOString() ?? null,
      createdIssueId: i.createdIssueId,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }
}
