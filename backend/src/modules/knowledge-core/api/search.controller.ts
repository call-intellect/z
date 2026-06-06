import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../../auth/guards/cookie-auth.guard';
import { CurrentOrg } from '../../rbac/decorators/current-org.decorator';
import { TenantGuard } from '../../rbac/guards/tenant.guard';
import { RbacService } from '../../rbac/rbac.service';

import {
  SearchRequestSchema,
  type SearchRequestDto,
  type SearchResultsDto,
} from './dto/search.dto';
import { SearchService } from './search.service';

/**
 * `POST /api/v1/knowledge/search` — гибридный поиск knowledge-core.
 *
 * Префикс `knowledge/` отделяет от существующего `/api/v1/search` (cards /
 * meetings / tasks глобальный поиск). RBAC: `block` `read`.
 */
@ApiTags('knowledge-core')
@Controller('api/v1/knowledge')
@UseGuards(CookieAuthGuard, TenantGuard)
export class KnowledgeSearchController {
  constructor(
    @Inject(SearchService) private readonly svc: SearchService,
    @Inject(RbacService) private readonly rbac: RbacService,
  ) {}

  @Post('search')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Гибридный поиск IdeaBlock (cosine + BM25)' })
  async search(
    @Body(new ZodValidationPipe(SearchRequestSchema)) body: SearchRequestDto,
    @CurrentUser() user: CurrentUserPayload,
    @CurrentOrg() tenantId: string | undefined,
  ): Promise<SearchResultsDto> {
    if (!tenantId) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'tenant_required', message: 'Org не определена' },
      });
    }
    const allowed = await this.rbac.canRead(user.id, tenantId, 'block');
    if (!allowed) {
      throw new ForbiddenException({
        ok: false,
        error: { code: 'forbidden', message: 'Недостаточно прав' },
      });
    }
    return this.svc.search({ ...body, tenantId, userId: user.id });
  }
}
