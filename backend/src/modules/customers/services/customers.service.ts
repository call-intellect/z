import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  type CustomerDto,
  type CustomerListItemDto,
  type CustomerStatusDto,
  type ListCustomersQuery,
  type ListCustomersResponse,
} from '../dto/customers.dto';

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(args: { tenantId: string; query: ListCustomersQuery }): Promise<ListCustomersResponse> {
    const { tenantId, query } = args;
    const where: Prisma.CustomerWhereInput = { tenantId };

    if (!query.includeDeleted) {
      where.deletedAt = null;
    }
    if (query.status) where.status = query.status;
    if (query.q) {
      where.OR = [
        { name: { contains: query.q, mode: 'insensitive' } },
        { inn: { contains: query.q, mode: 'insensitive' } },
        { email: { contains: query.q, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.customer.count({ where }),
    ]);

    return {
      items: items.map((c) => this.toListItem(c)),
      total,
      page: query.page,
      limit: query.limit,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async getById(args: { tenantId: string; id: string }): Promise<CustomerDto> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: args.id },
    });
    if (!customer || customer.tenantId !== args.tenantId) {
      throw new NotFoundException({
        ok: false,
        error: { code: 'customer_not_found', message: 'Клиент не найден' },
      });
    }
    return this.toDetail(customer);
  }

  private toListItem(c: {
    id: string;
    entityId: string;
    name: string;
    inn: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    source: string | null;
    externalCrmId: string | null;
    responsiblePersonId: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): CustomerListItemDto {
    return {
      id: c.id,
      entityId: c.entityId,
      name: c.name,
      inn: c.inn,
      email: c.email,
      phone: c.phone,
      status: c.status as CustomerStatusDto,
      source: c.source,
      externalCrmId: c.externalCrmId,
      responsiblePersonId: c.responsiblePersonId,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
    };
  }

  private toDetail(c: {
    id: string;
    entityId: string;
    name: string;
    inn: string | null;
    email: string | null;
    phone: string | null;
    status: string;
    source: string | null;
    externalCrmId: string | null;
    responsiblePersonId: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  }): CustomerDto {
    return {
      ...this.toListItem(c),
      metadata:
        c.metadata && typeof c.metadata === 'object' && !Array.isArray(c.metadata)
          ? (c.metadata as Record<string, unknown>)
          : null,
    };
  }
}
