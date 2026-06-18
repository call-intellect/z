import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

const BATCH_SIZE = 500;

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

type StrongField = 'inn' | 'ogrn' | 'email' | 'phone' | 'domain';

function readMetaField(meta: Record<string, unknown>, key: StrongField): string | null {
  const direct = meta[key];
  if (typeof direct === 'string' && direct.trim().length > 0) return direct;
  if (typeof direct === 'number' && Number.isFinite(direct)) {
    return String(direct);
  }
  const lowerKey = key.toLowerCase();
  for (const [k, v] of Object.entries(meta)) {
    if (k.toLowerCase() === lowerKey) {
      if (typeof v === 'string' && v.trim().length > 0) return v;
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
  }
  return null;
}

function normalize(field: StrongField, raw: string): string | null {
  if (field === 'inn') {
    const cleaned = raw.replace(/\D/g, '');
    return cleaned.length === 10 || cleaned.length === 12 ? cleaned : null;
  }
  if (field === 'ogrn') {
    const cleaned = raw.replace(/\D/g, '');
    return cleaned.length === 13 || cleaned.length === 15 ? cleaned : null;
  }
  if (field === 'email') {
    const e = raw.trim().toLowerCase();
    return e.includes('@') && e.length >= 5 ? e : null;
  }
  if (field === 'phone') {
    const p = raw.trim().replace(/[^\d+]/g, '');
    return p.length >= 7 ? p : null;
  }
  if (field === 'domain') {
    let d = raw.trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
    d = d.split('/')[0] ?? '';
    return d.includes('.') && d.length >= 3 ? d : null;
  }
  return null;
}

interface EntityRow {
  id: string;
  metadata: unknown;
  inn: string | null;
  ogrn: string | null;
  email: string | null;
  phone: string | null;
  domain: string | null;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  console.log(
    `=== patch-extract-strong-ids START (dry-run=${opts.dryRun}, limit=${opts.limit ?? 'none'}) ===`,
  );

  const totalRow = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `
    SELECT COUNT(*)::bigint AS count
    FROM "Entity"
    WHERE "metadata" IS NOT NULL
      AND (
        "metadata" ?| ARRAY['inn','ogrn','email','phone','domain',
                            'INN','OGRN','Email','Phone','Domain',
                            'Inn','Ogrn']
      )
      AND ("inn" IS NULL OR "ogrn" IS NULL OR "email" IS NULL
           OR "phone" IS NULL OR "domain" IS NULL)
    `,
  );
  const total = Number(totalRow[0]?.count ?? 0n);
  console.log(`Кандидатов с metadata + пустыми strong-полями: ${total}`);
  if (total === 0) {
    console.log('Нечего обновлять — skip.');
    return;
  }

  let processed = 0;
  let updated = 0;
  let skipped = 0;
  let conflicts = 0;
  let lastId = '';

  while (true) {
    if (opts.limit !== null && processed >= opts.limit) {
      console.log(`Достигнут --limit=${opts.limit} — стоп`);
      break;
    }
    const remaining = opts.limit !== null ? opts.limit - processed : BATCH_SIZE;
    const take = Math.min(BATCH_SIZE, remaining);

    const rows = await prisma.$queryRawUnsafe<EntityRow[]>(
      `
      SELECT id, metadata, inn, ogrn, email, phone, domain
      FROM "Entity"
      WHERE "metadata" IS NOT NULL
        AND (
          "metadata" ?| ARRAY['inn','ogrn','email','phone','domain',
                              'INN','OGRN','Email','Phone','Domain',
                              'Inn','Ogrn']
        )
        AND ("inn" IS NULL OR "ogrn" IS NULL OR "email" IS NULL
             OR "phone" IS NULL OR "domain" IS NULL)
        AND id > $1
      ORDER BY id ASC
      LIMIT $2
      `,
      lastId,
      take,
    );
    if (rows.length === 0) break;
    lastId = rows[rows.length - 1]?.id ?? lastId;

    for (const row of rows) {
      processed += 1;
      if (!row.metadata || typeof row.metadata !== 'object') {
        skipped += 1;
        continue;
      }
      const meta = row.metadata as Record<string, unknown>;

      const patch: Partial<Record<StrongField, string>> = {};
      for (const field of ['inn', 'ogrn', 'email', 'phone', 'domain'] as StrongField[]) {
        if (row[field] !== null) continue;
        const raw = readMetaField(meta, field);
        if (!raw) continue;
        const norm = normalize(field, raw);
        if (!norm) continue;
        patch[field] = norm;
      }
      if (Object.keys(patch).length === 0) {
        skipped += 1;
        continue;
      }

      if (opts.dryRun) {
        if (updated < 5) {
          console.log(`[dry-run] Entity ${row.id} ← ${JSON.stringify(patch)}`);
        }
        updated += 1;
        continue;
      }

      try {
        await prisma.entity.update({
          where: { id: row.id },
          data: {
            ...(patch.inn !== undefined ? { inn: patch.inn } : {}),
            ...(patch.ogrn !== undefined ? { ogrn: patch.ogrn } : {}),
            ...(patch.email !== undefined ? { email: patch.email } : {}),
            ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
            ...(patch.domain !== undefined ? { domain: patch.domain } : {}),
          },
        });
        updated += 1;
      } catch (err) {
        conflicts += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[conflict] Entity ${row.id}: ${msg.slice(0, 200)}`);
      }
    }

    console.log(
      `Прогресс: processed=${processed}/${total}, updated=${updated}, skipped=${skipped}, conflicts=${conflicts}`,
    );
    if (rows.length < take) break;
  }

  console.log(
    `=== patch-extract-strong-ids DONE: processed=${processed}, updated=${updated}, skipped=${skipped}, conflicts=${conflicts} ===`,
  );
  if (conflicts > 0) {
    console.log(
      'ℹ️  conflicts > 0 — есть Entity с дублирующими strong-IDs в одном tenant. ' +
        'Это разрешается entity-merge (см. entity-resolver.worker / GraphService).',
    );
  }
}

main()
  .catch((err) => {
    console.error('patch-extract-strong-ids FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
