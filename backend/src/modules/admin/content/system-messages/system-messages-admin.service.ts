import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../common/prisma/prisma.service';

export interface SystemMessageItem {
  id: string;
  type: string;
  severity: string;
  body: string;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  targetOrgs: string[];
  createdBy: string;
  createdAt: Date;
}

@Injectable()
export class SystemMessagesAdminService {
  private readonly logger = new Logger(SystemMessagesAdminService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(filters: {
    type?: string;
    isActive?: boolean;
  }): Promise<{ items: SystemMessageItem[] }> {
    const where: Prisma.SystemMessageWhereInput = {};
    if (filters.type) where.type = filters.type;
    if (filters.isActive !== undefined) where.isActive = filters.isActive;

    const rows = await this.prisma.systemMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((r) => this.toItem(r)) };
  }

  async getActive(now: Date = new Date()): Promise<{ items: SystemMessageItem[] }> {
    const rows = await this.prisma.systemMessage.findMany({
      where: {
        isActive: true,
        AND: [
          {
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          },
          {
            OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
    return { items: rows.map((r) => this.toItem(r)) };
  }

  async create(
    input: {
      type: string;
      severity: string;
      body: string;
      startsAt?: Date;
      endsAt?: Date;
      targetOrgs?: string[];
      isActive?: boolean;
    },
    userId: string,
  ): Promise<SystemMessageItem> {
    const created = await this.prisma.systemMessage.create({
      data: {
        type: input.type,
        severity: input.severity,
        body: input.body,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        isActive: input.isActive ?? true,
        targetOrgs: input.targetOrgs ?? [],
        createdBy: userId,
      },
    });
    this.logger.log(
      `SystemMessagesAdminService: создано SystemMessage id=${created.id} type=${created.type}`,
    );
    return this.toItem(created);
  }

  async update(
    id: string,
    input: {
      type?: string;
      severity?: string;
      body?: string;
      startsAt?: Date | null;
      endsAt?: Date | null;
      targetOrgs?: string[];
      isActive?: boolean;
    },
  ): Promise<SystemMessageItem> {
    const exists = await this.prisma.systemMessage.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'system_message_not_found',
          message: `SystemMessage id="${id}" не найден`,
        },
      });
    }
    const data: Prisma.SystemMessageUpdateInput = {};
    if (input.type !== undefined) data.type = input.type;
    if (input.severity !== undefined) data.severity = input.severity;
    if (input.body !== undefined) data.body = input.body;
    if (input.startsAt !== undefined) data.startsAt = input.startsAt;
    if (input.endsAt !== undefined) data.endsAt = input.endsAt;
    if (input.targetOrgs !== undefined) data.targetOrgs = input.targetOrgs;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const updated = await this.prisma.systemMessage.update({ where: { id }, data });
    return this.toItem(updated);
  }

  async remove(id: string): Promise<{ ok: true }> {
    const exists = await this.prisma.systemMessage.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'system_message_not_found',
          message: `SystemMessage id="${id}" не найден`,
        },
      });
    }
    await this.prisma.systemMessage.delete({ where: { id } });
    return { ok: true };
  }

  private toItem(row: {
    id: string;
    type: string;
    severity: string;
    body: string;
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
    targetOrgs: string[];
    createdBy: string;
    createdAt: Date;
  }): SystemMessageItem {
    return {
      id: row.id,
      type: row.type,
      severity: row.severity,
      body: row.body,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      isActive: row.isActive,
      targetOrgs: row.targetOrgs,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }
}
