import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  CurrentUser,
  type CurrentUserPayload,
} from '../auth/decorators/current-user.decorator';
import { CookieAuthGuard } from '../auth/guards/cookie-auth.guard';

import { SearchService, type SearchTypeKey } from './search.service';

const ALLOWED_TYPES: SearchTypeKey[] = ['cards', 'meetings', 'tasks'];

const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
  types: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v): SearchTypeKey[] => {
      if (!v) return ALLOWED_TYPES;
      const arr = Array.isArray(v) ? v : v.split(',');
      const cleaned = arr
        .map((s) => s.trim())
        .filter((s): s is SearchTypeKey =>
          (ALLOWED_TYPES as string[]).includes(s),
        );
      return cleaned.length > 0 ? cleaned : ALLOWED_TYPES;
    }),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

type SearchQueryDto = z.infer<typeof SearchQuerySchema>;

/**
 * Глобальный поиск: `GET /api/v1/search?q=...&types=cards,meetings,tasks`.
 * Используется `⌘K` командной палитрой во фронтенде.
 */
@ApiTags('search')
@Controller('api/v1')
@UseGuards(CookieAuthGuard)
export class SearchController {
  constructor(@Inject(SearchService) private readonly svc: SearchService) {}

  @Get('search')
  @ApiOperation({ summary: 'Глобальный поиск (cards/meetings/tasks)' })
  search(
    @Query(new ZodValidationPipe(SearchQuerySchema)) query: SearchQueryDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return this.svc.search({
      userId: user.id,
      query: query.q,
      types: query.types,
      limit: query.limit,
    });
  }
}
