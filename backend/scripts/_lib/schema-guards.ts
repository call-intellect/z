/**
 * Переиспользуемые schema-guard'ы для prod-скриптов (apply-prod-deploy).
 *
 * Зачем: миграционные/backfill-скрипты гоняются на проде через
 * `apply-prod-deploy.ts --mode update`. Если данные УЖЕ в целевом
 * состоянии (миграция применена в прошлый выкат) или нужного состояния
 * вообще нет, типизированные Prisma-запросы вида `where: { col: null }`
 * по ставшей NOT NULL колонке падают валидацией Prisma 7, а raw-cast'ы по
 * удалённому enum-значению — ошибкой Postgres. Эти guard'ы позволяют
 * скрипту выйти ЧИСТО (exit 0) с человекочитаемой причиной ДО краша.
 *
 * Эталон вдохновлён `backfill-orgs-fase0.ts` (локальный `isColumnNullable`)
 * и `tighten-meeting-tenant-not-null.ts`. Здесь — общий набор.
 *
 * Все функции принимают `PrismaClient` (из `createPrismaClient()` или
 * собранный с driver adapter вручную), читают `information_schema` / `pg_*`
 * и НЕ пишут.
 */

import type { PrismaClient } from '@prisma/client';

/**
 * true, если колонка существует И всё ещё nullable (`is_nullable = 'YES'`).
 * false, если колонки нет ИЛИ она стала NOT NULL.
 *
 * Используй перед `where: { <col>: null }` по полю, которое планово
 * ужесточается до NOT NULL.
 */
export async function isColumnNullable(
  db: PrismaClient,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
  `;
  return rows[0]?.is_nullable === 'YES';
}

/** true, если колонка `table.column` существует в схеме `public`. */
export async function columnExists(
  db: PrismaClient,
  table: string,
  column: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
    LIMIT 1
  `;
  return rows.length > 0;
}

/** true, если таблица `table` существует в схеме `public` (base table). */
export async function tableExists(db: PrismaClient, table: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
    LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * true, если enum-тип `enumName` всё ещё содержит значение `value`.
 * false, если значение удалено (DROP VALUE через cleanup-миграцию) или
 * самого enum-типа нет.
 *
 * Используй перед raw-cast'ами вида `WHERE col = 'client'::"EntityType"`.
 */
export async function enumHasValue(
  db: PrismaClient,
  enumName: string,
  value: string,
): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = ${enumName} AND e.enumlabel = ${value}
    LIMIT 1
  `;
  return rows.length > 0;
}
