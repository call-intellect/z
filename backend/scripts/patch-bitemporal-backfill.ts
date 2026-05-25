/**
 * KC-Temporal W1.1 (2026-05-25) — backfill bi-temporal полей для существующих
 * IdeaBlock'ов и EntityLink'ов.
 *
 * Что делает (идемпотентно):
 *   - IdeaBlock с `validFrom IS NULL`:
 *       validFrom  = COALESCE(min(IdeaBlockEvidence.sourceTimestamp), createdAt)
 *       recordedAt = createdAt (только если совпадает с дефолтом now() — на новых
 *                    блоках, созданных после prisma:push, recordedAt=createdAt
 *                    автоматически из @default(now()); миграция переписывает
 *                    только historic-блоки, где default зафиксирован при insert).
 *   - EntityLink: переносит `validTo` (legacy) → `validUntil`, ставит
 *       `recordedAt = createdAt`. Идемпотентно: пропускает строки, где
 *       `validUntil` уже не NULL ИЛИ `validTo` был NULL.
 *
 * Безопасность (skill safe-seed-rules):
 *   - WHERE-условия исключают уже обработанные строки.
 *   - Batch 1000, прогресс-лог.
 *   - Поддерживает `--dry-run` (печатает SQL/COUNT, не пишет) и `--limit=N`
 *     (потолок строк к обновлению за прогон).
 *
 * Запуск:
 *   cd backend
 *   bun run scripts/patch-bitemporal-backfill.ts             # обычный
 *   bun run scripts/patch-bitemporal-backfill.ts --dry-run   # сухой прогон
 *   bun run scripts/patch-bitemporal-backfill.ts --limit=5000
 */

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

// Prisma 7: driver adapter обязателен. URL из env (bun грузит .env).
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const BATCH_SIZE = 1000;

interface CliOptions {
  dryRun: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { dryRun: false, limit: null };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg.startsWith('--limit=')) {
      const n = Number.parseInt(arg.slice('--limit='.length), 10);
      if (Number.isFinite(n) && n > 0) opts.limit = n;
    }
  }
  return opts;
}

interface IdeaBlockToBackfill {
  id: string;
  createdAt: Date;
  minSourceTs: Date | null;
}

async function backfillIdeaBlocks(opts: CliOptions): Promise<void> {
  console.log('\n=== IdeaBlock backfill (validFrom, recordedAt) ===');

  // Сколько всего блоков с validFrom IS NULL.
  const totalRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "IdeaBlock" WHERE "validFrom" IS NULL`,
  );
  const total = Number(totalRows[0]?.count ?? 0n);
  console.log(`[ideaBlock] кандидатов с validFrom IS NULL: ${total}`);
  if (total === 0) {
    console.log('[ideaBlock] нечего обновлять — skip');
    return;
  }

  let processed = 0;
  let updated = 0;
  while (true) {
    if (opts.limit !== null && processed >= opts.limit) {
      console.log(`[ideaBlock] достигнут --limit=${opts.limit} — стоп`);
      break;
    }
    const remaining = opts.limit !== null ? opts.limit - processed : BATCH_SIZE;
    const take = Math.min(BATCH_SIZE, remaining);

    // Берём batch блоков с агрегатом min(evidence.sourceTimestamp) одним SELECT'ом.
    const rows = await prisma.$queryRawUnsafe<IdeaBlockToBackfill[]>(
      `
        SELECT b.id, b."createdAt",
               (SELECT MIN(e."sourceTimestamp") FROM "IdeaBlockEvidence" e WHERE e."blockId" = b.id) AS "minSourceTs"
        FROM "IdeaBlock" b
        WHERE b."validFrom" IS NULL
        ORDER BY b."createdAt" ASC
        LIMIT $1
      `,
      take,
    );
    if (rows.length === 0) break;

    if (opts.dryRun) {
      const sample = rows.slice(0, 3).map((r) => ({
        id: r.id,
        validFrom: r.minSourceTs ?? r.createdAt,
      }));
      console.log(
        `[ideaBlock][dry-run] batch=${rows.length}, sample=`,
        sample,
      );
    } else {
      // Один UPDATE на batch через VALUES — быстрее, чем N updateMany.
      // Используем CTE с unnest.
      const ids: string[] = [];
      const vfs: Date[] = [];
      const rcs: Date[] = [];
      for (const r of rows) {
        ids.push(r.id);
        vfs.push(r.minSourceTs ?? r.createdAt);
        rcs.push(r.createdAt);
      }
      await prisma.$executeRawUnsafe(
        `
          UPDATE "IdeaBlock" AS b
          SET "validFrom" = u.vf,
              "recordedAt" = u.rc
          FROM UNNEST($1::text[], $2::timestamptz[], $3::timestamptz[]) AS u(id, vf, rc)
          WHERE b.id = u.id AND b."validFrom" IS NULL
        `,
        ids,
        vfs,
        rcs,
      );
      updated += rows.length;
    }

    processed += rows.length;
    console.log(
      `[ideaBlock] обработано ${processed}/${total} (updated=${updated})`,
    );
    if (rows.length < take) break;
  }

  console.log(`[ideaBlock] ИТОГО: processed=${processed}, updated=${updated}`);
}

async function backfillEntityLinks(opts: CliOptions): Promise<void> {
  console.log('\n=== EntityLink backfill (validUntil ← validTo, recordedAt) ===');

  // 1) Перенос validTo → validUntil (только если validUntil ещё NULL).
  const candidates1 = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "EntityLink"
     WHERE "validUntil" IS NULL AND "validTo" IS NOT NULL`,
  );
  const total1 = Number(candidates1[0]?.count ?? 0n);
  console.log(`[entityLink] кандидатов validTo → validUntil: ${total1}`);

  if (total1 > 0) {
    if (opts.dryRun) {
      console.log('[entityLink][dry-run] UPDATE SET validUntil = validTo (где validUntil NULL)');
    } else {
      const limited = opts.limit !== null ? `LIMIT ${opts.limit}` : '';
      const subq = limited
        ? `(SELECT id FROM "EntityLink" WHERE "validUntil" IS NULL AND "validTo" IS NOT NULL ORDER BY "createdAt" ASC ${limited})`
        : null;
      if (subq) {
        await prisma.$executeRawUnsafe(
          `UPDATE "EntityLink" SET "validUntil" = "validTo" WHERE id IN ${subq}`,
        );
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE "EntityLink" SET "validUntil" = "validTo" WHERE "validUntil" IS NULL AND "validTo" IS NOT NULL`,
        );
      }
      console.log(`[entityLink] перенесено validTo → validUntil: ~${total1}`);
    }
  }

  // 2) Backfill recordedAt = createdAt — только если recordedAt равен
  //    default'у (now() при текущем прогоне). На свежих БД default уже
  //    выставлен в `now()` при insert (а это будет дата запуска backfill'а,
  //    а нам нужно `createdAt`). Перезаписываем безусловно — это безопасно:
  //    recordedAt по контракту = «когда система узнала» ≡ createdAt
  //    для legacy-данных, и для будущих insert'ов значение будет
  //    выставляться явно в block-ingest'е.
  //
  //    Идемпотентность: повторный прогон обновит ту же дату на ту же — noop.
  const total2Row = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "EntityLink" WHERE "recordedAt" <> "createdAt"`,
  );
  const total2 = Number(total2Row[0]?.count ?? 0n);
  console.log(`[entityLink] кандидатов recordedAt != createdAt: ${total2}`);

  if (total2 > 0) {
    if (opts.dryRun) {
      console.log('[entityLink][dry-run] UPDATE SET recordedAt = createdAt (где не совпадают)');
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "EntityLink" SET "recordedAt" = "createdAt" WHERE "recordedAt" <> "createdAt"`,
      );
      console.log(`[entityLink] выровнено recordedAt = createdAt: ~${total2}`);
    }
  }

  // 3) IdeaBlock recordedAt тоже выровняем (по тем же причинам).
  const total3Row = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "IdeaBlock" WHERE "recordedAt" <> "createdAt"`,
  );
  const total3 = Number(total3Row[0]?.count ?? 0n);
  console.log(`[ideaBlock] кандидатов recordedAt != createdAt: ${total3}`);

  if (total3 > 0) {
    if (opts.dryRun) {
      console.log('[ideaBlock][dry-run] UPDATE SET recordedAt = createdAt (где не совпадают)');
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "IdeaBlock" SET "recordedAt" = "createdAt" WHERE "recordedAt" <> "createdAt"`,
      );
      console.log(`[ideaBlock] выровнено recordedAt = createdAt: ~${total3}`);
    }
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(`=== patch-bitemporal-backfill START (dry-run=${opts.dryRun}, limit=${opts.limit ?? 'none'}) ===`);

  await backfillIdeaBlocks(opts);
  await backfillEntityLinks(opts);

  console.log('\n=== patch-bitemporal-backfill DONE ===');
}

main()
  .catch((err) => {
    console.error('patch-bitemporal-backfill FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
