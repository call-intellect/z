import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CurationLevel, Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * CuratorRoutingService — выбирает кандидатов-кураторов для CurationItem.
 *
 * Алгоритм (sub-TZ §3.6, §6.6):
 *   1. Точное совпадение `(tenantId, resourceType, level)`.
 *   2. Если ничего — `(tenantId, resourceType, level=null)`.
 *   3. Если ничего — wildcard `(tenantId, '*', ...)`.
 *   4. Если ничего — fallback на owner/admin Org через Membership.
 *
 * `criteria` (опц.) — при совпадении тегов/полей пересечение усиливает
 * приоритет. На α-4 — простая проверка совпадения по верхним полям (см.
 * `matchesCriteria` ниже).
 */
@Injectable()
export class CuratorRoutingService {
  private readonly logger = new Logger(CuratorRoutingService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async resolveCurators(args: {
    tenantId: string;
    resourceType: string;
    level?: CurationLevel;
    criteria?: Record<string, unknown>;
  }): Promise<string[]> {
    const { tenantId, resourceType, level, criteria } = args;

    // 1. Точное resourceType + level.
    const exact = await this.findAssignments({
      tenantId,
      resourceType,
      levelExact: level ?? null,
    });
    const exactMatched = exact.filter((a) => this.matchesCriteria(a.criteria, criteria));
    if (exactMatched.length > 0) {
      return uniq(exactMatched.flatMap((a) => a.curatorUserIds));
    }

    // 2. resourceType + level=null (универсальный).
    if (level !== undefined) {
      const universal = await this.findAssignments({
        tenantId,
        resourceType,
        levelExact: null,
      });
      const universalMatched = universal.filter((a) =>
        this.matchesCriteria(a.criteria, criteria),
      );
      if (universalMatched.length > 0) {
        return uniq(universalMatched.flatMap((a) => a.curatorUserIds));
      }
    }

    // 3. Wildcard '*' (с тем же level или без).
    const wildcard = await this.findAssignments({
      tenantId,
      resourceType: '*',
      levelExact: 'any',
    });
    const wildcardMatched = wildcard.filter((a) =>
      this.matchesCriteria(a.criteria, criteria),
    );
    if (wildcardMatched.length > 0) {
      return uniq(wildcardMatched.flatMap((a) => a.curatorUserIds));
    }

    // 4. Fallback — owner / admin Org.
    return this.fallbackOwnersAdmins(tenantId);
  }

  /**
   * Гарантирует не-пустой массив кандидатов: если ни ассайнментов, ни owner/admin
   * не нашлось — возвращает [], а сервис-вызыватель решает что делать (по умолчанию
   * — выкидывает в логи).
   */
  private async findAssignments(args: {
    tenantId: string;
    resourceType: string;
    /** 'any' — игнорировать level фильтр; null — взять level=null; CurationLevel — точное совпадение. */
    levelExact: CurationLevel | null | 'any';
  }): Promise<
    Array<{
      curatorUserIds: string[];
      criteria: Prisma.JsonValue | null;
    }>
  > {
    const where: Prisma.CuratorAssignmentWhereInput = {
      tenantId: args.tenantId,
      resourceType: args.resourceType,
    };
    if (args.levelExact === null) {
      where.level = null;
    } else if (args.levelExact !== 'any') {
      where.level = args.levelExact;
    }
    return this.prisma.curatorAssignment.findMany({
      where,
      select: { curatorUserIds: true, criteria: true },
    });
  }

  private async fallbackOwnersAdmins(tenantId: string): Promise<string[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { orgId: tenantId, role: { in: ['owner', 'admin'] } },
      select: { userId: true },
    });
    const ids = memberships.map((m) => m.userId);
    if (ids.length === 0) {
      this.logger.warn(
        { tenantId },
        'curator-routing: ни ассайнментов, ни owner/admin для Org — кандидатов 0',
      );
    }
    return uniq(ids);
  }

  /**
   * Проверка `assignment.criteria ⊆ input.criteria`. На α-4 — простая
   * проверка совпадения по верхним полям. Если в assignment нет criteria
   * (null) — assignment всегда подходит.
   */
  private matchesCriteria(
    assignmentCriteria: Prisma.JsonValue | null,
    inputCriteria: Record<string, unknown> | undefined,
  ): boolean {
    if (!assignmentCriteria) return true;
    if (typeof assignmentCriteria !== 'object' || Array.isArray(assignmentCriteria)) {
      return true;
    }
    if (!inputCriteria) return false;
    const obj = assignmentCriteria as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (v === '*') continue; // wildcard для конкретного поля
      if (inputCriteria[k] !== v) return false;
    }
    return true;
  }
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.filter((s) => typeof s === 'string' && s.length > 0)));
}
