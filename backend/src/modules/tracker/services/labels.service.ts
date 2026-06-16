import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Label } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  CreateLabelDto,
  ListLabelsQuery,
  UpdateLabelDto,
} from '../dto/labels/create-label.dto';

export interface LabelResponseDto {
  id: string;
  tenantId: string;
  projectId: string | null;
  name: string;
  color: string;
}

@Injectable()
export class LabelsService {
  private readonly logger = new Logger(LabelsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(dto: CreateLabelDto, tenantId: string): Promise<LabelResponseDto> {
    try {
      const created = await this.prisma.label.create({
        data: {
          tenantId,
          projectId: dto.projectId ?? null,
          name: dto.name,
          color: dto.color,
        },
      });
      return this.toResponse(created);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({
          ok: false,
          error: { code: 'label_exists', message: 'Метка уже существует' },
        });
      }
      throw e;
    }
  }

  async findAll(tenantId: string, query: ListLabelsQuery): Promise<LabelResponseDto[]> {
    const where: Prisma.LabelWhereInput = { tenantId };
    if (query.projectId !== undefined) {
      where.OR = [{ projectId: query.projectId }, { projectId: null }];
    }
    const rows = await this.prisma.label.findMany({
      where,
      orderBy: [{ name: 'asc' }],
    });
    return rows.map((r) => this.toResponse(r));
  }

  async update(id: string, dto: UpdateLabelDto, tenantId: string): Promise<LabelResponseDto> {
    await this.requireLabel(id, tenantId);
    const updated = await this.prisma.label.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.color !== undefined && { color: dto.color }),
      },
    });
    return this.toResponse(updated);
  }

  async delete(id: string, tenantId: string): Promise<{ ok: true }> {
    await this.requireLabel(id, tenantId);
    await this.prisma.label.delete({ where: { id } });
    return { ok: true };
  }

  private async requireLabel(id: string, tenantId: string): Promise<Label> {
    const l = await this.prisma.label.findFirst({
      where: { id, tenantId },
    });
    if (!l) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'label_not_found', message: 'Метка не найдена' },
      });
    }
    return l;
  }

  private toResponse(l: Label): LabelResponseDto {
    return {
      id: l.id,
      tenantId: l.tenantId,
      projectId: l.projectId,
      name: l.name,
      color: l.color,
    };
  }
}
