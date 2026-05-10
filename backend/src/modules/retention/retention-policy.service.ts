import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OrgRetentionPolicy } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * RetentionPolicyService — единый getter для `OrgRetentionPolicy`.
 *
 * Фаза 11 knowledge-core: каждая Org имеет свою конфигурацию ретеншена
 * (см. модель `OrgRetentionPolicy`). Дефолты задаются в schema.prisma —
 * при отсутствии записи мы её ленится-создаём (`getOrInit`), чтобы
 * RetentionService и RetentionPolicyController могли работать одинаково
 * вне зависимости от того, прошёл ли seed.
 *
 * `update` — для PATCH /api/v1/settings/retention (Шаг 11).
 */
@Injectable()
export class RetentionPolicyService {
  private readonly logger = new Logger(RetentionPolicyService.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Возвращает политику Org. Если записи нет — создаёт её с дефолтами
   * из `schema.prisma` (lazy upsert). Идемпотентно: повторный вызов
   * вернёт уже-созданную запись.
   */
  async getOrInit(tenantId: string): Promise<OrgRetentionPolicy> {
    const existing = await this.prisma.orgRetentionPolicy.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;

    try {
      const created = await this.prisma.orgRetentionPolicy.create({
        data: { tenantId },
      });
      this.logger.log(
        { tenantId },
        'OrgRetentionPolicy: lazy-init с дефолтами',
      );
      return created;
    } catch (err) {
      // Race: параллельный getOrInit мог успеть создать. Перечитываем.
      const second = await this.prisma.orgRetentionPolicy.findUnique({
        where: { tenantId },
      });
      if (second) return second;
      throw err;
    }
  }

  /**
   * Прямое обновление полей. Используется RetentionPolicyController после
   * валидации payload'а. Возвращает обновлённую запись.
   */
  async update(
    tenantId: string,
    patch: {
      rawEventDays?: number;
      archivedBlockDays?: number;
      chatMessageDays?: number;
      auditLogDays?: number;
      archivedBlockAction?: string;
    },
  ): Promise<OrgRetentionPolicy> {
    // Гарантируем существование записи перед update.
    await this.getOrInit(tenantId);
    return this.prisma.orgRetentionPolicy.update({
      where: { tenantId },
      data: patch,
    });
  }

  /** Помечает «когда последний раз прошёл sweep». Вызывается из RetentionService. */
  async markSwept(tenantId: string): Promise<void> {
    await this.prisma.orgRetentionPolicy.update({
      where: { tenantId },
      data: { lastSweepAt: new Date() },
    });
  }
}
