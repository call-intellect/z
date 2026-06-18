import { Inject, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { buildNowContextLine } from '../../operations/utils/local-date';
import type { PageContextDto } from '../dto/concierge.dto';

/**
 * SBA γ-2 — ConciergeContextBuilderService.
 *
 * Формирует context-блок для system prompt LLM из:
 *   - pageContext (route, currentEntityId, extras);
 *   - короткий recent activity (последние действия пользователя — на MVP
 *     просто счётчики/имена);
 *   - identity (имя/email user, имя/slug Org).
 *
 * Возвращает строку, готовую к подмешиванию в system prompt. Кардинальность
 * data — ограничена ~2KB чтобы не съедать tool-use лимит токенов.
 */
@Injectable()
export class ConciergeContextBuilderService {
  private readonly logger = new Logger(ConciergeContextBuilderService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async build(args: {
    tenantId: string;
    userId: string;
    pageContext?: PageContextDto | null;
  }): Promise<string> {
    const parts: string[] = [];
    const now = new Date();

    // Identity + «Сейчас…» (дата/время/TZ — точка отсчёта для «сегодня/завтра»).
    let userTimezone: string | null = null;
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: args.userId },
        select: { name: true, email: true, timezone: true },
      });
      const org = await this.prisma.org.findUnique({
        where: { id: args.tenantId },
        select: { name: true, slug: true },
      });
      userTimezone = user?.timezone ?? null;
      if (user) {
        parts.push(`Пользователь: ${user.name} (${user.email})`);
      }
      if (org) {
        parts.push(`Организация: ${org.name} (${org.slug})`);
      }
    } catch (err) {
      this.logger.warn(
        `build: identity lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    // «Сейчас…» — первой строкой контекста (даже если identity упал → дефолтная TZ).
    parts.unshift(buildNowContextLine(now, userTimezone));

    // PageContext.
    if (args.pageContext) {
      const pc = args.pageContext;
      if (pc.clientPath) {
        parts.push(`Текущая страница: ${pc.clientPath}`);
      }
      if (pc.currentEntityKind && pc.currentEntityId) {
        parts.push(
          `Открыт ресурс: ${pc.currentEntityKind} (id=${pc.currentEntityId})`,
        );
        // Подмешиваем краткую информацию о сущности, если знаем тип.
        const detail = await this.tryFetchEntityDetail(
          args.tenantId,
          pc.currentEntityKind,
          pc.currentEntityId,
        );
        if (detail) parts.push(`Сводка ресурса: ${detail}`);
      }
      if (pc.extras && Object.keys(pc.extras).length > 0) {
        const flat = Object.entries(pc.extras)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        // обрезаем чтобы не раздувать prompt
        parts.push(`Контекст страницы: ${flat.slice(0, 500)}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Безопасно достать «1-строку» о ресурсе для prompt'а. На MVP — только
   * meeting/card; иначе null.
   */
  private async tryFetchEntityDetail(
    tenantId: string,
    kind: string,
    id: string,
  ): Promise<string | null> {
    try {
      if (kind === 'meeting') {
        const m = await this.prisma.meeting.findFirst({
          where: { id, tenantId },
          select: { title: true, type: true, status: true },
        });
        return m
          ? `«${m.title}», тип=${m.type}, статус=${m.status}`
          : null;
      }
      if (kind === 'card') {
        const c = await this.prisma.card.findFirst({
          where: { id, tenantId },
          select: { name: true, kind: true },
        });
        return c ? `«${c.name}», тип=${c.kind}` : null;
      }
      return null;
    } catch {
      return null;
    }
  }
}
