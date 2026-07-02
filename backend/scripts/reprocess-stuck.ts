import { makeInfra, pollUntil, readConfig, assertNotProd, loadCounts, sleep } from './_lib/combat-harness';

async function main(): Promise<void> {
  const cfg = readConfig();
  assertNotProd(cfg);
  const orgId = process.env['STRELA_ORG'];
  if (!orgId) throw new Error('STRELA_ORG не задан');
  const infra = makeInfra(cfg);
  const { prisma, rawEventsQueue } = infra;
  try {
    const stuck = await prisma.rawEvent.findMany({
      where: {
        tenantId: orgId,
        processingStatus: 'received',
        sourceType: { not: 'tracker_event' as never },
        // Prod «stuck» (raw-event-recovery.cron + raw_event_stuck_gauge) TIME-based; здесь evidence-based — намеренно.
        evidence: { none: {} },
      },
      select: { id: true, sourceType: true, sourceExternalId: true },
    });
    // eslint-disable-next-line no-console
    console.log(`Застрявших content-событий: ${stuck.length}`);
    for (const e of stuck) {
      await rawEventsQueue.add(
        'raw-received',
        { rawEventId: e.id },
        { jobId: `raw_reproc_${e.id}_${Date.now()}` },
      );
      // eslint-disable-next-line no-console
      console.log(`  re-enqueue ${e.sourceType} ${e.sourceExternalId ?? e.id}`);
    }
    // eslint-disable-next-line no-console
    console.log('— Поллинг обработки стрелков…');
    const before = await loadCounts(prisma, orgId);
    const target = before.rawEventProcessed + Math.max(1, Math.floor(stuck.length * 0.7));
    await pollUntil(prisma, orgId, (c) => c.rawEventProcessed >= target, 300_000, 5000);
    await sleep(15_000);
    const after = await loadCounts(prisma, orgId);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(after, null, 2));
  } finally {
    await infra.close();
  }
}

void main();
