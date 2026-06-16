import type { PrismaClient } from '@prisma/client';

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

export async function tableExists(db: PrismaClient, table: string): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ one: number }>>`
    SELECT 1 AS one FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${table}
    LIMIT 1
  `;
  return rows.length > 0;
}

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
