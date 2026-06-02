import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  SYSTEM_TABLES_CATALOG,
  type SystemTableTemplate,
} from '../templates/system-tables.catalog';

/**
 * Авто-провижининг системных Smart-таблиц при создании Org (Smart-tables Фаза 0).
 *
 * Создаёт 10 ПУСТЫХ (без строк) системных таблиц по каталогу
 * `SYSTEM_TABLES_CATALOG`. Вызывается из `OrgsService.createForOwner` в той же
 * транзакции, что и создание Org/Membership/Source.
 *
 * Идемпотентность: для каждого шаблона перед созданием делаем
 * `findFirst({ tenantId, systemKey })`. Повторный вызов на той же Org ничего
 * не создаёт (используется и backfill-скриптом для существующих Org).
 */
@Injectable()
export class TablesAutoProvisionService {
  private readonly logger = new Logger(TablesAutoProvisionService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  /**
   * Создать недостающие системные таблицы для Org.
   *
   * @returns счётчики `created` / `skipped` (skipped = уже существовали).
   */
  async provisionDefaults(
    tenantId: string,
    ownerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ created: number; skipped: number }> {
    const client = tx ?? this.prisma;
    let created = 0;
    let skipped = 0;

    for (const tpl of SYSTEM_TABLES_CATALOG) {
      const existing = await client.table.findFirst({
        where: { tenantId, systemKey: tpl.systemKey },
        select: { id: true },
      });
      if (existing) {
        skipped++;
        continue;
      }

      const table = await client.table.create({
        data: {
          tenantId,
          name: tpl.name,
          icon: tpl.icon,
          isSystem: true,
          systemKey: tpl.systemKey,
          entitySync: tpl.entitySync
            ? (tpl.entitySync as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          createdBy: ownerId,
        },
        select: { id: true },
      });

      await this.createProperties(client, table.id, tpl);
      created++;
    }

    this.logger.log(
      { tenantId, created, skipped },
      'tables.autoProvision: системные таблицы',
    );
    return { created, skipped };
  }

  private async createProperties(
    client: Prisma.TransactionClient | PrismaService,
    tableId: string,
    tpl: SystemTableTemplate,
  ): Promise<void> {
    for (let i = 0; i < tpl.properties.length; i++) {
      const p = tpl.properties[i]!;
      await client.tableProperty.create({
        data: {
          tableId,
          name: p.name,
          type: p.type,
          config: (p.config ?? {}) as Prisma.InputJsonValue,
          isPrimary: p.isPrimary ?? false,
          order: new Prisma.Decimal((i + 1) * 1000),
        },
      });
    }
  }
}
