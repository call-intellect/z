import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';
import { RbacService } from '../rbac/rbac.service';

import {
  ListEventsQuerySchema,
  type EventDto,
  type ListEventsQuery,
  type ListEventsResponse,
} from './dto/events.dto';
import { EventsService } from './services/events.service';

/**
 * REST API событий графа знаний (SBA α-3).
 *
 *   GET /api/v1/events?kind=&from=&to=&q=&page=&limit=
 *   GET /api/v1/events/:id
 *
 * RBAC: `event_card` — owner/admin: read/write/delete; manager: read.
 * На α-3 — read-only.
 */
@ApiTags('events')
@Controller('api/v1/events')
@UseGuards(CookieAuthGuard, TenantGuard)
export class EventsController {
  constructor(
    @Inject(EventsService) private readonly events: EventsService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Список событий Org (с фильтрами по kind/from/to)' })
  async list(
    @Query(new ZodValidationPipe(ListEventsQuerySchema)) q: ListEventsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListEventsResponse> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.events.list({ tenantId: t, query: q });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Получить событие по id' })
  async byId(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<EventDto> {
    const t = this.requireTenant(tenantId);
    await this.requireRead(user.id, t);
    return this.events.getById({ tenantId: t, id });
  }

  // ─────────────────────────── helpers ──────────────────────────────

  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId) {
      throw new BadRequestException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    return tenantId;
  }

  private async requireRead(userId: string, tenantId: string): Promise<void> {
    const ok = await this.rbac.canRead(userId, tenantId, 'event_card');
    if (!ok) {
      throw new ForbiddenException({
        ok: false,
        error: {
          code: 'forbidden',
          message: 'Недостаточно прав для чтения событий',
        },
      });
    }
  }
}
