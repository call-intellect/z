import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';
import { MyMentionsService } from '../services/my-mentions.service';

const ListMentionsQuerySchema = z
  .object({
    status: z.enum(['unread', 'all']).default('unread'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().max(80).nullable().optional(),
  })
  .strict();
type ListMentionsQuery = z.infer<typeof ListMentionsQuerySchema>;

/**
 * REST `/api/v1/me/mentions` — мои @-упоминания в задачах трекера.
 *
 * T8 (2026-05-24). Источник истины — модель IssueMention; статус прочитанности
 * — производный из Notification(eventType='issue.mention') (см.
 * MyMentionsService). MarkRead делается через существующий
 * `POST /api/v1/me/notifications/:id/mark-read` (ConversationalController),
 * чтобы был один источник истины для всех каналов и нотификаций.
 */
@ApiTags('tracker / me')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class MyMentionsController {
  constructor(
    @Inject(MyMentionsService) private readonly svc: MyMentionsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get('me/mentions')
  @ApiOperation({ summary: 'Мои @-упоминания (по умолчанию — непрочитанные)' })
  async list(
    @Query(new ZodValidationPipe(ListMentionsQuerySchema))
    query: ListMentionsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.list({
      userId: user.id,
      tenantId: t,
      status: query.status,
      limit: query.limit,
      cursor: query.cursor ?? null,
    });
  }

  @Get('me/mentions/count')
  @ApiOperation({ summary: 'Счётчик непрочитанных упоминаний' })
  async count(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ) {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.svc.unreadCount({ userId: user.id, tenantId: t });
  }

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Организация не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'issue');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав на чтение задач' },
      });
    }
  }
}
