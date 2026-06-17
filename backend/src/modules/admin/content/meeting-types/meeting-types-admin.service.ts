import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { MeetingType, type Prisma } from '@prisma/client';

import { PrismaService } from '../../../../common/prisma/prisma.service';

export interface MeetingTypeItem {
  id: string;
  displayName: string;
  description: string | null;
  icon: string | null;
  reportPromptKey: string | null;
  isActive: boolean;
  sortOrder: number;
  updatedBy: string | null;
  updatedAt: Date;
}

@Injectable()
export class MeetingTypesAdminService {
  private readonly logger = new Logger(MeetingTypesAdminService.name);

  private syncing: Promise<void> | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(): Promise<{ items: MeetingTypeItem[] }> {
    const count = await this.prisma.meetingTypeConfig.count();
    if (count === 0) {
      await this.ensureBootstrap();
    }
    const rows = await this.prisma.meetingTypeConfig.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return { items: rows.map((r) => this.toItem(r)) };
  }

  async create(
    input: {
      id: string;
      displayName: string;
      description?: string;
      icon?: string;
      reportPromptKey?: string;
      sortOrder?: number;
    },
    userId: string | null,
  ): Promise<MeetingTypeItem> {
    const exists = await this.prisma.meetingTypeConfig.findUnique({
      where: { id: input.id },
    });
    if (exists) {
      throw new BadRequestException({
        ok: false,
        error: {
          code: 'meeting_type_id_taken',
          message: `MeetingTypeConfig id="${input.id}" уже существует`,
        },
      });
    }
    const created = await this.prisma.meetingTypeConfig.create({
      data: {
        id: input.id,
        displayName: input.displayName,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.reportPromptKey !== undefined ? { reportPromptKey: input.reportPromptKey } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedBy: userId,
      },
    });
    this.logger.log(`MeetingTypesAdminService: создан MeetingTypeConfig id=${created.id}`);
    return this.toItem(created);
  }

  async update(
    id: string,
    input: {
      displayName?: string;
      description?: string | null;
      icon?: string | null;
      reportPromptKey?: string | null;
      sortOrder?: number;
      isActive?: boolean;
    },
    userId: string | null,
  ): Promise<MeetingTypeItem> {
    const exists = await this.prisma.meetingTypeConfig.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'meeting_type_not_found',
          message: `MeetingTypeConfig id="${id}" не найден`,
        },
      });
    }
    const data: Prisma.MeetingTypeConfigUpdateInput = { updatedBy: userId };
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.description !== undefined) data.description = input.description;
    if (input.icon !== undefined) data.icon = input.icon;
    if (input.reportPromptKey !== undefined) data.reportPromptKey = input.reportPromptKey;
    if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await this.prisma.meetingTypeConfig.update({ where: { id }, data });
    return this.toItem(updated);
  }

  async softDelete(id: string, userId: string | null): Promise<{ ok: true }> {
    const exists = await this.prisma.meetingTypeConfig.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'meeting_type_not_found',
          message: `MeetingTypeConfig id="${id}" не найден`,
        },
      });
    }
    await this.prisma.meetingTypeConfig.update({
      where: { id },
      data: { isActive: false, updatedBy: userId },
    });
    return { ok: true };
  }

  private async ensureBootstrap(): Promise<void> {
    if (this.syncing) {
      await this.syncing;
      return;
    }
    this.syncing = (async () => {
      const values = Object.values(MeetingType) as readonly string[];
      this.logger.log(
        `MeetingTypesAdminService: bootstrap-sync из enum MeetingType (${values.length} значений)`,
      );
      let order = 0;
      for (const id of values) {
        await this.prisma.meetingTypeConfig.upsert({
          where: { id },
          create: {
            id,
            displayName: id,
            isActive: true,
            sortOrder: order++,
            defaultClosedGroupKind: id === 'interview' ? 'personal' : null,
          },
          update: {},
        });
      }
    })();
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  private toItem(row: {
    id: string;
    displayName: string;
    description: string | null;
    icon: string | null;
    reportPromptKey: string | null;
    isActive: boolean;
    sortOrder: number;
    updatedBy: string | null;
    updatedAt: Date;
  }): MeetingTypeItem {
    return {
      id: row.id,
      displayName: row.displayName,
      description: row.description,
      icon: row.icon,
      reportPromptKey: row.reportPromptKey,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }
}
