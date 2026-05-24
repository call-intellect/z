import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type IssueState } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import type { ListStatesQuery } from '../dto/states/list-states-query.dto';
import type {
  ListStatesResponse,
  StateResponseDto,
} from '../dto/states/state-response.dto';

/**
 * StatesService — read-only сервис справочника `IssueState` для трекера.
 *
 * Write/manage статусов идёт через `ProjectsService` (default states
 * проставляются при создании проекта в seed/sync скриптах). Этот сервис
 * нужен только для list-API: фронту нужен справочник статусов, чтобы
 * рисовать board-колонки и фильтр.
 *
 * Tenant-scope обязателен на всех методах.
 */
@Injectable()
export class StatesService {
  private readonly logger = new Logger(StatesService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Список IssueState текущего tenant'а. Опциональные фильтры:
   *   - projectId: только статусы конкретного проекта.
   *   - category: только конкретная категория (например `started`).
   *
   * Сортировка: projectId asc, sequence asc — стабильно для одного
   * проекта (sequence 0..N), и предсказуемо для глобального списка.
   */
  async findAll(
    tenantId: string,
    query: ListStatesQuery,
  ): Promise<ListStatesResponse> {
    const where: Prisma.IssueStateWhereInput = { tenantId };
    if (query.projectId) where.projectId = query.projectId;
    if (query.category) where.category = query.category;

    const items = await this.prisma.issueState.findMany({
      where,
      orderBy: [{ projectId: 'asc' }, { sequence: 'asc' }],
    });
    return {
      items: items.map((s) => this.toResponse(s)),
      total: items.length,
    };
  }

  private toResponse(s: IssueState): StateResponseDto {
    return {
      id: s.id,
      tenantId: s.tenantId,
      projectId: s.projectId,
      name: s.name,
      color: s.color,
      category: s.category,
      sequence: s.sequence,
      isDefault: s.isDefault,
    };
  }
}
