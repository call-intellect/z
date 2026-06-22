import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { RequireEntitlement } from '../../../entitlements/require-entitlement.decorator';
import { CurrentOrg } from '../../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../../rbac/guards/tenant.guard';

import { DumpService } from './dump.service';

const DumpCreateSchema = z.object({
  text: z.string().trim().min(1).max(50_000),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  dataClass: z.nativeEnum(DataClass).optional(),
  nonce: z.string().min(8).max(64).optional(),
  asIdea: z.boolean().optional(),
});
type DumpCreateDto = z.infer<typeof DumpCreateSchema>;

@ApiTags('ingest')
@Controller('api/v1/ingest/dump')
@UseGuards(CookieAuthGuard, TenantGuard)
@RequireEntitlement('feature.adapter_web_form')
export class WebFormDumpController {
  constructor(@Inject(DumpService) private readonly dump: DumpService) {}

  @Get('config')
  @ApiOperation({
    summary:
      'Параметры формы текстовой заметки (порог, при котором короткий текст предлагается отправить в «Идеи»).',
  })
  async config(): Promise<{ shortTextToIdeaThreshold: number }> {
    return {
      shortTextToIdeaThreshold: await this.dump.shortTextToIdeaThreshold(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Создать текстовую заметку (вставить текст). asIdea=true — отправить короткий текст в «Идеи» без создания документа.',
  })
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
      asIdea: body.asIdea,
    });
  }
}
