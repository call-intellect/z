import { Queue } from 'bullmq';
import IORedis from 'ioredis';

import { createPrismaClient } from './_lib/prisma';

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;
const suffix = args.find((a) => a.startsWith('--suffix='))?.split('=')[1] ?? `rerun${Date.now()}`;
const resetFlag = args.includes('--reset');

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) throw new Error('REDIS_URL is not set');

  if (resetFlag) {
    const reset = await prisma.rawEvent.updateMany({
      where: { sourceType: 'chatbox' },
      data: { processingStatus: 'received', processingError: null },
    });
    console.log('reset to received:', reset.count);
  }

  const events = await prisma.rawEvent.findMany({
    where: { sourceType: 'chatbox', processingStatus: 'received' },
    select: { id: true },
    orderBy: { receivedAt: 'asc' },
    ...(limit ? { take: limit } : {}),
  });
  console.log('to enqueue:', events.length, 'suffix:', suffix);

  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const q = new Queue('core.raw-events', { connection });
  let added = 0;
  for (const ev of events) {
    await q.add(
      'raw-received',
      { rawEventId: ev.id },
      { jobId: `raw_${ev.id}_v2_${suffix}` },
    );
    added += 1;
  }
  console.log('enqueued:', added);

  await q.close();
  connection.disconnect();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
