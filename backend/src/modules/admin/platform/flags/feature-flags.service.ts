import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../common/prisma/prisma.service';

import type { FeatureFlagItemDto, ResolveResultDto } from './dto/feature-flags.dto';
import { computeRolloutHash, normalizeOrgOverrides } from './feature-flags.helpers';

@Injectable()
export class FeatureFlagsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(): Promise<FeatureFlagItemDto[]> {
    const rows = await this.prisma.featureFlag.findMany({
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(args: {
    key: string;
    description: string;
    defaultValue: boolean;
    category: string;
    userId: string;
  }): Promise<FeatureFlagItemDto> {
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key: args.key },
    });
    if (existing) {
      throw new ConflictException({
        ok: false,
        error: {
          code: 'feature_flag_exists',
          message: `Флаг ${args.key} уже существует`,
        },
      });
    }
    const created = await this.prisma.featureFlag.create({
      data: {
        key: args.key,
        description: args.description,
        defaultValue: args.defaultValue,
        category: args.category,
        orgOverrides: {} as Prisma.InputJsonValue,
        updatedBy: args.userId,
      },
    });
    return this.toDto(created);
  }

  async update(args: {
    key: string;
    patch: {
      description?: string;
      defaultValue?: boolean;
      rolloutPercent?: number | null;
      orgOverrides?: Record<string, boolean>;
      category?: string;
    };
    userId: string;
  }): Promise<FeatureFlagItemDto> {
    const existing = await this.requireFlag(args.key);
    const data: Prisma.FeatureFlagUpdateInput = { updatedBy: args.userId };
    if (args.patch.description !== undefined) {
      data.description = args.patch.description;
    }
    if (args.patch.defaultValue !== undefined) {
      data.defaultValue = args.patch.defaultValue;
    }
    if (args.patch.rolloutPercent !== undefined) {
      data.rolloutPercent = args.patch.rolloutPercent;
    }
    if (args.patch.orgOverrides !== undefined) {
      data.orgOverrides = args.patch.orgOverrides as Prisma.InputJsonValue;
    }
    if (args.patch.category !== undefined) {
      data.category = args.patch.category;
    }
    const updated = await this.prisma.featureFlag.update({
      where: { key: existing.key },
      data,
    });
    return this.toDto(updated);
  }

  async delete(key: string): Promise<{ ok: true }> {
    await this.requireFlag(key);
    await this.prisma.featureFlag.delete({ where: { key } });
    return { ok: true };
  }

  async resolve(key: string, tenantId: string): Promise<ResolveResultDto> {
    const flag = await this.requireFlag(key);
    const overrides = normalizeOrgOverrides(flag.orgOverrides);

    if (Object.prototype.hasOwnProperty.call(overrides, tenantId)) {
      return {
        key,
        tenantId,
        value: overrides[tenantId]!,
        source: 'override',
      };
    }
    if (flag.rolloutPercent !== null && flag.rolloutPercent !== undefined) {
      const pct = Math.max(0, Math.min(100, flag.rolloutPercent));
      let value: boolean;
      if (pct === 0) value = false;
      else if (pct === 100) value = true;
      else value = computeRolloutHash(key, tenantId) % 100 < pct;
      return { key, tenantId, value, source: 'rollout' };
    }
    return {
      key,
      tenantId,
      value: flag.defaultValue,
      source: 'default',
    };
  }

  async setOverride(args: {
    key: string;
    tenantId: string;
    value: boolean;
    userId: string;
  }): Promise<FeatureFlagItemDto> {
    const flag = await this.requireFlag(args.key);
    const overrides = normalizeOrgOverrides(flag.orgOverrides);
    overrides[args.tenantId] = args.value;
    const updated = await this.prisma.featureFlag.update({
      where: { key: flag.key },
      data: {
        orgOverrides: overrides as Prisma.InputJsonValue,
        updatedBy: args.userId,
      },
    });
    return this.toDto(updated);
  }

  async clearOverride(args: {
    key: string;
    tenantId: string;
    userId: string;
  }): Promise<FeatureFlagItemDto> {
    const flag = await this.requireFlag(args.key);
    const overrides = normalizeOrgOverrides(flag.orgOverrides);
    if (!Object.prototype.hasOwnProperty.call(overrides, args.tenantId)) {
      return this.toDto(flag);
    }
    delete overrides[args.tenantId];
    const updated = await this.prisma.featureFlag.update({
      where: { key: flag.key },
      data: {
        orgOverrides: overrides as Prisma.InputJsonValue,
        updatedBy: args.userId,
      },
    });
    return this.toDto(updated);
  }

  private async requireFlag(key: string) {
    const flag = await this.prisma.featureFlag.findUnique({ where: { key } });
    if (!flag) {
      throw new NotFoundException({
        ok: false,
        error: {
          code: 'feature_flag_not_found',
          message: `Флаг ${key} не найден`,
        },
      });
    }
    return flag;
  }

  private toDto(row: {
    key: string;
    description: string;
    defaultValue: boolean;
    orgOverrides: unknown;
    rolloutPercent: number | null;
    category: string;
    updatedBy: string | null;
    updatedAt: Date;
  }): FeatureFlagItemDto {
    return {
      key: row.key,
      description: row.description,
      defaultValue: row.defaultValue,
      orgOverrides: normalizeOrgOverrides(row.orgOverrides),
      rolloutPercent: row.rolloutPercent,
      category: row.category,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
