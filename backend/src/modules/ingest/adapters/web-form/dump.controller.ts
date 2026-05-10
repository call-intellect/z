import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataClass } from '@prisma/client';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../../rbac/guards/tenant.guard';

import { DumpService } from './dump.service';

/**
 * Web-form адаптер (Фаза 10 knowledge-core, Шаг 7).
 *
 *   - `POST /api/v1/ingest/dump` — приём короткой «мысли» от пользователя
 *     (страница `/dump`). Под `CookieAuthGuard + TenantGuard` (НЕ shared-secret,
 *     НЕ ApiKey). Квота `dump_per_day_per_user` (default 30/день) — 429.
 *
 *   - body: `{ text: string, occurredAt?: ISO, dataClass?: DataClass, nonce?: string }`.
 *
 * FIXME knowledge-core Фаза 12: добавить @RequireEntitlement('feature.adapter_web_form').
 */
const DumpCreateSchema = z.object({
  text: z.string().trim().min(1).max(50_000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  dataClass: z.nativeEnum(DataClass).optional(),
  /** UUID, генерируемый фронтом для идемпотентности повторных submit'ов. */
  nonce: z.string().min(8).max(64).optional(),
});
type DumpCreateDto = z.infer<typeof DumpCreateSchema>;

@ApiTags('ingest')
@Controller('api/v1/ingest/dump')
@UseGuards(CookieAuthGuard, TenantGuard)
export class WebFormDumpController {
  constructor(@Inject(DumpService) private readonly dump: DumpService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Создать дамп мысли (web-form адаптер)' })
  async create(
    @Body(new ZodValidationPipe(DumpCreateSchema)) body: DumpCreateDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<{ rawEventId: string; idempotent: boolean }> {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return this.dump.createDump({
      tenantId,
      userId: user.id,
      userName: user.name ?? user.email,
      text: body.text,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
      dataClass: body.dataClass,
      nonce: body.nonce,
    });
  }
}
