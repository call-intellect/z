import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser, type CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../rbac/guards/tenant.guard';

import {
  ListThreadsQuerySchema,
  type ListThreadsQuery,
  type ListThreadsResponse,
  SearchMessagesQuerySchema,
  type SearchMessagesQuery,
  type SearchMessagesResponse,
  type UnreadCountResponse,
} from './dto/inbox.dto';
import { InboxService } from './services/inbox.service';

@ApiTags('messaging / inbox')
@ApiBearerAuth()
@Controller('api/v1')
@UseGuards(CookieAuthGuard, TenantGuard)
export class InboxController {
  constructor(@Inject(InboxService) private readonly inbox: InboxService) {}

  @Get('message-threads/unread-count')
  @ApiOperation({ summary: 'Единый бейдж непрочитанного по всем разговорам члена' })
  async unreadCount(
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<UnreadCountResponse> {
    const t = this.requireTenant(tenantId);
    const total = await this.inbox.unreadCount({ tenantId: t, userId: user.id });
    return { total };
  }

  @Get('message-threads')
  @ApiOperation({ summary: 'Единый список разговоров члена (агрегатор ленты, INV-A3)' })
  async listThreads(
    @Query(new ZodValidationPipe(ListThreadsQuerySchema)) query: ListThreadsQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<ListThreadsResponse> {
    const t = this.requireTenant(tenantId);
    return this.inbox.listThreads({
      tenantId: t,
      userId: user.id,
      type: query.type,
      sort: query.sort,
      q: query.q ?? null,
      cursor: query.cursor ?? null,
    });
  }

  @Get('message-search')
  @ApiOperation({ summary: 'Полнотекстовый поиск по телам сообщений члена (GIN)' })
  async searchMessages(
    @Query(new ZodValidationPipe(SearchMessagesQuerySchema)) query: SearchMessagesQuery,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SearchMessagesResponse> {
    const t = this.requireTenant(tenantId);
    return this.inbox.searchMessages({ tenantId: t, userId: user.id, q: query.q });
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
}
