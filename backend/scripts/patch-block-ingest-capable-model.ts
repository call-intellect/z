import { createPrismaClient } from './_lib/prisma';

interface TierTarget {
  tier: 'primary' | 'secondary';
  providerName: string;
  model: string;
}

const BLOCK_INGEST_TARGETS: TierTarget[] = [
  { tier: 'primary', providerName: 'deepseek', model: 'deepseek-v4-pro' },
  { tier: 'secondary', providerName: 'openai-via-proxy', model: 'gpt-5.4' },
];

const DEGRADED_MODELS = new Set<string>([
  'deepseek-v4-flash',
  'gpt-5.4-mini',
  'gpt-5.4-nano',
  'qwen3:30b-a3b-instruct-2507',
  'qwen3.5:9b',
]);

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const force = process.argv.includes('--force');
  const prisma = createPrismaClient();
  let updated = 0;
  let unchanged = 0;
  let skippedEdited = 0;
  let missing = 0;
  let deactivated = 0;

  console.log(
    `=== patch-block-ingest-capable-model START (dryRun=${dryRun}, force=${force}) ===`,
  );

  try {
    for (const t of BLOCK_INGEST_TARGETS) {
      const row = await prisma.llmTaskRoute.findFirst({
        where: {
          taskType: 'block-ingest',
          tenantId: null,
          tier: t.tier,
          providerName: t.providerName,
        },
      });
      if (!row) {
        missing++;
        console.log(
          `[missing] block-ingest ${t.tier} ${t.providerName} — нет tier-записи (legacy-only инсталляция?)`,
        );
        continue;
      }
      if (row.editedByAdmin && !force) {
        skippedEdited++;
        console.log(
          `[skip:edited] block-ingest ${t.tier} id=${row.id} ${row.providerName}:${row.model} (нужен --force)`,
        );
        continue;
      }
      if (row.model === t.model && row.isActive && row.providers == null) {
        unchanged++;
        console.log(`[unchanged] block-ingest ${t.tier} = ${t.providerName}:${t.model}`);
        continue;
      }
      if (dryRun) {
        updated++;
        console.log(
          `[dry:update] block-ingest ${t.tier} id=${row.id} ${row.model ?? '∅'} → ${t.model}`,
        );
        continue;
      }
      await prisma.llmTaskRoute.update({
        where: { id: row.id },
        data: { model: t.model, isActive: true, providers: null },
      });
      updated++;
      console.log(`[update] block-ingest ${t.tier} → ${t.providerName}:${t.model}`);
    }

    const all = await prisma.llmTaskRoute.findMany({
      where: { taskType: 'block-ingest', tenantId: null, tier: { in: ['primary', 'secondary'] } },
    });
    for (const r of all) {
      if (!r.isActive) continue;
      if (r.editedByAdmin && !force) continue;
      const keep = BLOCK_INGEST_TARGETS.some(
        (t) => t.tier === r.tier && t.providerName === r.providerName,
      );
      if (keep) continue;
      if (!r.model || !DEGRADED_MODELS.has(r.model)) continue;
      if (dryRun) {
        deactivated++;
        console.log(
          `[dry:deactivate] block-ingest ${r.tier} id=${r.id} ${r.providerName}:${r.model} (деградация развилки)`,
        );
        continue;
      }
      await prisma.llmTaskRoute.update({ where: { id: r.id }, data: { isActive: false } });
      deactivated++;
      console.log(
        `[deactivate] block-ingest ${r.tier} id=${r.id} ${r.providerName}:${r.model} (деградация развилки idea↔decision)`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `ИТОГО block-ingest capable-model: updated=${updated}, unchanged=${unchanged}, ` +
      `deactivated=${deactivated}, skippedEdited=${skippedEdited}, missing=${missing}` +
      `${dryRun ? ' (DRY-RUN — ничего не записано)' : ''}`,
  );
  console.log('=== patch-block-ingest-capable-model DONE ===');
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('patch-block-ingest-capable-model FAILED:', err);
    process.exit(1);
  });
}
