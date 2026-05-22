import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type ListVendorsQuery,
  type ListVendorsResponse,
  type VendorDto,
  type VendorListItemDto,
  type VendorSegmentDto,
  type VendorStatusDto,
} from '../dto/vendors.dto';

/**
 * VendorsService (SBA α-3). Read-only на α-3: только list + get.
 * POST/PATCH/DELETE появятся в α-6 (vendor management UI).
 */
@Injectable()
export class VendorsService {
  private readonly logger = new Logger(VendorsService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: {
    tenantId: string;
    query: ListVendorsQuery;
  }): Promise<ListVendorsResponse> {
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

  // ─────────────────────────── mappers ─────────────────────────────────

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
