import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { HmacService } from '../auth/services/hmac.service';

import { AdminAuditInterceptor } from './admin.audit.interceptor';

const CreateKeySchema = z.object({
  partner_name: z.string().trim().min(1).max(100),
});
type CreateKeyDto = z.infer<typeof CreateKeySchema>;

export interface IntegrationKeyListItem {
  id: string;
  partnerName: string;
  createdAt: string;
  revokedAt: string | null;
}

@ApiExcludeController()
@Controller('admin/api/v1/integration-keys')
@UseGuards(CookieAuthGuard, AdminGuard)
@UseInterceptors(AdminAuditInterceptor)
export class IntegrationKeysAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HmacService) private readonly hmac: HmacService,
  ) {}

  @Get()
  async list(): Promise<{ items: IntegrationKeyListItem[] }> {
    const rows = await this.prisma.integrationKey.findMany({
      select: {
        id: true,
        partnerName: true,
        createdAt: true,
        revokedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        partnerName: r.partnerName,
        createdAt: r.createdAt.toISOString(),
        revokedAt: r.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body(new ZodValidationPipe(CreateKeySchema)) dto: CreateKeyDto,
  ): Promise<{ id: string; key: string }> {
    const plainKey = this.hmac.generateKey();
    const keyHash = this.hmac.hashKey(plainKey);
    const created = await this.prisma.integrationKey.create({
      data: {
        partnerName: dto.partner_name,
        keyHash,
      },
      select: { id: true },
    });
    // Сырой ключ возвращается ОДИН раз. Хранится только хеш.
    return { id: created.id, key: plainKey };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async revoke(@Param('id') id: string): Promise<{ ok: true }> {
    await this.prisma.integrationKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }
}
