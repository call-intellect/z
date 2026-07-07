/**
 * Считает записи с embedding по всем vector-колонкам в public-схеме.
 * Полезен для оценки объёма backfill перед миграцией размерности
 * (например vector(1536) → vector(768) при переходе с text-embedding-3-small
 * на embeddinggemma).
 *
 * Запуск:
 *   bun run scripts/count-embeddings.ts
 *   bun run scripts/count-embeddings.ts --only-non-null   # только embedding IS NOT NULL
 *
 * Вывод: таблица `table | column | total | non_null` плюс итоги.
 * Без сетевых вызовов, без миграций — только SELECT.
 */

import { createPrismaClient } from './_lib/prisma';

interface VecCol {
  table: string;
  column: string;
}

interface CountRow {
  total: number;
  non_null: number;
}

async function main(): Promise<void> {
  const onlyNonNull = process.argv.includes('--only-non-null');
  const prisma = createPrismaClient();
  try {
    const cols = await prisma.$queryRawUnsafe<VecCol[]>(`
      SELECT c.relname AS table, a.attname AS column
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      WHERE n.nspname = 'public'
        AND t.typname = 'vector'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND c.relkind = 'r'
      ORDER BY 1, 2
    `);

    if (cols.length === 0) {
      console.log('[count-embeddings] vector-колонок в public не найдено');
      return;
    }

    console.log(
      `[count-embeddings] найдено vector-колонок: ${cols.length}; режим: ${onlyNonNull ? 'non-null only' : 'total+non-null'}`,
    );
    console.log('table'.padEnd(36) + 'column'.padEnd(24) + 'total'.padStart(12) + 'non_null'.padStart(12));
    console.log('-'.repeat(84));

    let grandTotal = 0;
    let grandNonNull = 0;

    for (const { table, column } of cols) {
      const sql = onlyNonNull
        ? `SELECT COUNT(*)::int AS total, COUNT("${column}")::int AS non_null FROM "${table}"`
        : `SELECT COUNT(*)::int AS total, COUNT("${column}")::int AS non_null FROM "${table}"`;
      const rows = await prisma.$queryRawUnsafe<CountRow[]>(sql);
      const row = rows[0] ?? { total: 0, non_null: 0 };
      console.log(
        table.padEnd(36) +
          column.padEnd(24) +
          String(row.total).padStart(12) +
          String(row.non_null).padStart(12),
      );
      grandTotal += row.total;
      grandNonNull += row.non_null;
    }

    console.log('-'.repeat(84));
    console.log('GRAND TOTAL'.padEnd(60) + String(grandTotal).padStart(12) + String(grandNonNull).padStart(12));
    console.log(`[count-embeddings] done — нужно переэмбеддить: ${grandNonNull} записей`);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].includes('count-embeddings')) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[count-embeddings] fatal', err);
      process.exit(1);
    });
}