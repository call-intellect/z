import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type IssueFieldDef, type IssueFieldValue } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { CreateFieldDefDto } from '../dto/issue-fields/create-field-def.dto';
import type { SetFieldValueDto } from '../dto/issue-fields/set-field-value.dto';

import {
  isIssueFieldType,
  validateIssueFieldValue,
  type IssueFieldConfig,
  type IssueFieldType,
} from './issue-field-validation.util';
import { IssuesService } from './issues.service';
import { ProjectsService } from './projects.service';

export interface IssueFieldDefResponseDto {
  id: string;
  projectId: string | null;
  name: string;
  type: string;
  config: IssueFieldConfig;
  order: number;
  archivedAt: string | null;
  createdAt: string;
}

export interface IssueFieldValueResponseDto {
  id: string;
  issueId: string;
  fieldId: string;
  value: unknown;
}

@Injectable()
export class IssueFieldsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(IssuesService) private readonly issues: IssuesService,
    @Inject(ProjectsService) private readonly projects: ProjectsService,
  ) {}

  async listDefs(
    tenantId: string,
    projectId: string | null,
    includeArchived: boolean,
  ): Promise<IssueFieldDefResponseDto[]> {
    if (projectId) {
      await this.projects.requireProject(projectId, tenantId);
    }
    const rows = await this.prisma.issueFieldDef.findMany({
      where: {
        tenantId,
        ...(includeArchived ? {} : { archivedAt: null }),
        ...(projectId === null
          ? {}
          : { OR: [{ projectId }, { projectId: null }] }),
      },
      orderBy: [{ order: 'asc' }],
    });
    return rows.map((r) => this.toDefResponse(r));
  }

  async createDef(
    dto: CreateFieldDefDto,
    tenantId: string,
  ): Promise<IssueFieldDefResponseDto> {
    const projectId = dto.projectId ?? null;
    if (projectId) {
      await this.projects.requireProject(projectId, tenantId);
    }
    if (!isIssueFieldType(dto.type)) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'invalid_field_type', message: 'Недопустимый тип поля' },
      });
    }
    const config = (dto.config ?? {}) as IssueFieldConfig;
    if (
      (dto.type === 'status' ||
        dto.type === 'selectSingle' ||
        dto.type === 'selectMulti') &&
      (config.options ?? []).length === 0
    ) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'field_options_required',
          message: 'Для поля-выбора нужно задать хотя бы одну опцию',
        },
      });
    }
    const last = await this.prisma.issueFieldDef.findFirst({
      where: { tenantId, projectId },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    const nextOrder = last
      ? new Prisma.Decimal(last.order).plus(1000)
      : new Prisma.Decimal(1000);
    const created = await this.prisma.issueFieldDef.create({
      data: {
        tenantId,
        projectId,
        name: dto.name,
        type: dto.type,
        config: config as Prisma.InputJsonValue,
        order: nextOrder,
      },
    });
    return this.toDefResponse(created);
  }

  async archiveDef(
    id: string,
    tenantId: string,
  ): Promise<IssueFieldDefResponseDto> {
    const def = await this.requireDef(id, tenantId);
    const updated = await this.prisma.issueFieldDef.update({
      where: { id: def.id },
      data: { archivedAt: new Date() },
    });
    return this.toDefResponse(updated);
  }

  async listValues(
    issueId: string,
    tenantId: string,
  ): Promise<IssueFieldValueResponseDto[]> {
    await this.issues.requireIssue(issueId, tenantId);
    const rows = await this.prisma.issueFieldValue.findMany({
      where: { issueId, tenantId },
    });
    return rows.map((r) => this.toValueResponse(r));
  }

  async setValue(
    issueId: string,
    dto: SetFieldValueDto,
    tenantId: string,
  ): Promise<IssueFieldValueResponseDto> {
    await this.issues.requireIssue(issueId, tenantId);
    const def = await this.requireDef(dto.fieldId, tenantId);
    if (def.archivedAt !== null) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'field_archived',
          message: 'Нельзя задать значение архивному полю',
        },
      });
    }
    const result = validateIssueFieldValue(
      def.type as IssueFieldType,
      (def.config ?? {}) as IssueFieldConfig,
      dto.value,
    );
    if (!result.ok) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'invalid_field_value',
          message: 'Значение не соответствует типу поля',
          reason: result.reason,
        },
      });
    }
    const normalized = (result.normalized ?? null) as Prisma.InputJsonValue;
    const row = await this.prisma.issueFieldValue.upsert({
      where: { issueId_fieldId: { issueId, fieldId: dto.fieldId } },
      create: { tenantId, issueId, fieldId: dto.fieldId, value: normalized },
      update: { value: normalized },
    });
    return this.toValueResponse(row);
  }

  async deleteValue(
    issueId: string,
    fieldId: string,
    tenantId: string,
  ): Promise<{ ok: true }> {
    await this.issues.requireIssue(issueId, tenantId);
    await this.prisma.issueFieldValue.deleteMany({
      where: { tenantId, issueId, fieldId },
    });
    return { ok: true };
  }

  private async requireDef(
    id: string,
    tenantId: string,
  ): Promise<IssueFieldDef> {
    const def = await this.prisma.issueFieldDef.findUnique({ where: { id } });
    if (!def || def.tenantId !== tenantId) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'field_def_not_found',
          message: 'Определение поля не найдено',
        },
      });
    }
    return def;
  }

  private toDefResponse(r: IssueFieldDef): IssueFieldDefResponseDto {
    return {
      id: r.id,
      projectId: r.projectId,
      name: r.name,
      type: r.type,
      config: (r.config ?? {}) as IssueFieldConfig,
      order: Number(r.order),
      archivedAt: r.archivedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private toValueResponse(r: IssueFieldValue): IssueFieldValueResponseDto {
    return {
      id: r.id,
      issueId: r.issueId,
      fieldId: r.fieldId,
      value: r.value,
    };
  }
}
