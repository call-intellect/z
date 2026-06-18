import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CreateVendorDto,
  type ListVendorsQuery,
  type ListVendorsResponse,
  type UpdateVendorDto,
  type VendorDto,
  type VendorListItemDto,
  type VendorSegmentDto,
  type VendorStatusDto,
} from '../dto/vendors.dto';

@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: { tenantId: string; query: ListVendorsQuery }): Promise<ListVendorsResponse> {
    const { tenantId, query } = args;
    const where: Prisma.VendorWhereInput = { tenantId };

    if (!query.includeDeleted) {
      where.deletedAt = null;
    }
    if (query.segment) where.segment = query.segment;
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { inn: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.vendor.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.vendor.count({ where }),
    ]);

    return {
      items: items.map((v) => this.toListItem(v)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<VendorDto> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: args.id },
    });
    if (!vendor || vendor.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'vendor_not_found', message: 'Поставщик не найден' },
      });
    }
    return this.toDetail(vendor);
  }

  async create(args: {
    tenantId: string;
    dto: CreateVendorDto;
    actorUserId: string;
  }): Promise<VendorDto> {
    const { tenantId, dto } = args;
    const name = dto.name.trim();
    const inn = dto.inn?.trim() ? dto.inn.trim() : null;
    const segment = dto.segment ?? null;
    const status = dto.status ?? 'active';
    const responsibleUserId = dto.responsibleUserId ?? null;

    const vendor = await this.prisma.$transaction(async (tx) => {
      const canonicalName = name.toLowerCase();
      let entityId: string;
      try {
        const ent = await tx.entity.create({
          data: {
            tenantId,
            type: 'vendor',
            name,
            canonicalName,
            mentionsCount: 0,
          },
          select: { id: true },
        });
        entityId = ent.id;
      } catch (err) {
        if (err instanceof Object && 'code' in err && (err as { code?: string }).code === 'P2002') {
          const existingEntity = await tx.entity.findFirst({
            where: { tenantId, type: 'vendor', canonicalName },
            select: { id: true },
          });
          if (!existingEntity) throw err;
          entityId = existingEntity.id;
        } else {
          throw err;
        }
      }

      const existingVendor = await tx.vendor.findUnique({
        where: { entityId },
        select: { id: true },
      });
      if (existingVendor) {
        const v = await tx.vendor.findUnique({ where: { id: existingVendor.id } });
        return v!;
      }

      return tx.vendor.create({
        data: {
          tenantId,
          entityId,
          name: name.slice(0, 300),
          inn,
          segment: segment ?? undefined,
          status,
          responsibleUserId,
        },
      });
    });

    return this.toDetail(vendor);
  }

  async update(args: {
    tenantId: string;
    id: string;
    dto: UpdateVendorDto;
    actorUserId: string;
  }): Promise<VendorDto> {
    const existing = await this.prisma.vendor.findUnique({
      where: { id: args.id },
      select: { id: true, tenantId: true, deletedAt: true },
    });
    if (!existing || existing.tenantId !== args.tenantId || existing.deletedAt) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'vendor_not_found', message: 'Поставщик не найден' },
      });
    }
    const data: Prisma.VendorUpdateInput = {};
    if (args.dto.name !== undefined) data.name = args.dto.name.trim();
    if (args.dto.inn !== undefined) data.inn = args.dto.inn?.trim() || null;
    if (args.dto.segment !== undefined) {
      data.segment = args.dto.segment ?? null;
    }
    if (args.dto.status !== undefined) data.status = args.dto.status;
    if (args.dto.responsibleUserId !== undefined) {
      data.responsibleUserId = args.dto.responsibleUserId;
    }
    const updated = await this.prisma.vendor.update({
      where: { id: args.id },
      data,
    });
    return this.toDetail(updated);
  }

  async softDelete(args: {
    tenantId: string;
    id: string;
    actorUserId: string;
  }): Promise<{ ok: true }> {
    const existing = await this.prisma.vendor.findUnique({
      where: { id: args.id },
      select: { id: true, tenantId: true, deletedAt: true },
    });
    if (!existing || existing.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'vendor_not_found', message: 'Поставщик не найден' },
      });
    }
    if (existing.deletedAt) {
      return { ok: true };
    }
    await this.prisma.vendor.update({
      where: { id: args.id },
      data: { deletedAt: new Date() },
    });
    return { ok: true };
  }

  private toListItem(v: {
    id: string;
    entityId: string;
    name: string;
    inn: string | null;
    segment: string | null;
    status: string;
    responsibleUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): VendorListItemDto {
    return {
      id: v.id,
      entityId: v.entityId,
      name: v.name,
      inn: v.inn,
      segment: (v.segment ?? null) as VendorSegmentDto | null,
      status: v.status as VendorStatusDto,
      responsibleUserId: v.responsibleUserId,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      deletedAt: v.deletedAt ? v.deletedAt.toISOString() : null,
    };
  }

  private toDetail(v: {
    id: string;
    entityId: string;
    name: string;
    inn: string | null;
    segment: string | null;
    status: string;
    responsibleUserId: string | null;
    contractIds: string[];
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): VendorDto {
    return {
      ...this.toListItem(v),
      contractIds: v.contractIds,
      metadata:
        v.metadata && typeof v.metadata === 'object' && !Array.isArray(v.metadata)
          ? (v.metadata as Record<string, unknown>)
          : null,
    };
  }
}
