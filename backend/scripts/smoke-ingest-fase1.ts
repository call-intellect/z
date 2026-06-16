import { createHash, randomBytes } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

const prisma = createPrismaClient();

const QUEUE_NAME = 'core.raw-events';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

interface IngestArgs {
  tenantId: string;
  sourceId: string;
  sourceExternalId?: string | null;
  occurredAt: Date;
  payload: unknown;
}

interface IngestProbeResult {
  rawEventId: string;
  payloadChecksum: string;
  idempotencyKey: string;
  created: boolean;
}

async function ingestProbe(args: IngestArgs, queue: Queue): Promise<IngestProbeResult> {
  const source = await prisma.source.findUniqueOrThrow({ where: { id: args.sourceId } });
  if (source.tenantId !== args.tenantId) throw new Error('source.tenantId mismatch');
  if (!source.isActive) throw new Error('source inactive');

  const payloadJson = JSON.stringify(args.payload);
  const payloadChecksum = sha256Hex(payloadJson);
  const payloadSizeBytes = Buffer.byteLength(payloadJson, 'utf8');
  const occurredAtIso = args.occurredAt.toISOString();
  const dedupBasis = args.sourceExternalId ?? payloadChecksum;
  const idempotencyKey = sha256Hex(`${args.sourceId}:${dedupBasis}:${occurredAtIso}`);

  const existing = await prisma.rawEvent.findUnique({ where: { idempotencyKey } });
  if (existing) {
    return {
      rawEventId: existing.id,
      payloadChecksum: existing.payloadChecksum,
      idempotencyKey: existing.idempotencyKey,
      created: false,
    };
  }

  try {
    const created = await prisma.rawEvent.create({
      data: {
        tenantId: args.tenantId,
        sourceId: source.id,
        sourceType: source.type,
        sourceExternalId: args.sourceExternalId ?? null,
        idempotencyKey,
        occurredAt: args.occurredAt,
        payloadStorage: 'inline',
        payload: args.payload as Prisma.InputJsonValue,
        payloadS3Key: null,
        payloadChecksum,
        payloadSizeBytes,
        dataClass: source.dataClass,
        processingStatus: 'received',
      },
    });
    await queue.add('raw-received', { rawEventId: created.id }, { jobId: `raw_${created.id}` });
    return {
      rawEventId: created.id,
      payloadChecksum,
      idempotencyKey,
      created: true,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const exist = await prisma.rawEvent.findUnique({ where: { idempotencyKey } });
      if (exist) {
        return {
          rawEventId: exist.id,
          payloadChecksum: exist.payloadChecksum,
          idempotencyKey: exist.idempotencyKey,
          created: false,
        };
      }
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const tag = `smk-${randomBytes(3).toString('hex')}`;
  // eslint-disable-next-line no-console
  console.log(`=== smoke-ingest-fase1 START (tag=${tag}) ===`);

  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL не задан в env (нужен для BullMQ smoke)');
  }
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection: redis });

  const owner = await prisma.user.create({
    data: {
      email: `${tag}@smoke.test`,
      name: 'Smoke Ingest Owner',
      role: 'user',
      signupSource: 'standalone',
    },
  });
  const org = await prisma.org.create({
    data: {
      name: `Smoke Ingest Org ${tag}`,
      slug: `${tag}-smoke-org`,
      ownerId: owner.id,
      visibilityMode: 'open',
      tier: 'basic',
    },
  });
  await prisma.membership.create({
    data: { orgId: org.id, userId: owner.id, role: 'owner' },
  });
  const source = await prisma.source.create({
    data: {
      tenantId: org.id,
      type: 'meeting',
      name: `Smoke Source ${tag}`,
      dataClass: 'internal',
      isActive: true,
    },
  });
  // eslint-disable-next-line no-console
  console.log(`✓ Подготовлены: User=${owner.id}, Org=${org.id}, Source=${source.id}`);

  const occurredAt = new Date('2026-05-10T10:00:00.000Z');
  const meetingId1 = `smk-mtg-${tag}`;
  const payload1 = {
    meetingId: meetingId1,
    type: 'sales',
    title: 'Smoke meeting',
    transcript: { turns: [{ speaker: 'A', text: 'hi', startSec: 0, endSec: 1 }] },
  };
  const r1 = await ingestProbe(
    {
      tenantId: org.id,
      sourceId: source.id,
      sourceExternalId: meetingId1,
      occurredAt,
      payload: payload1,
    },
    queue,
  );
  if (!r1.created) throw new Error('Первый ingest должен создать RawEvent');
  const expectedChecksum = sha256Hex(JSON.stringify(payload1));
  if (r1.payloadChecksum !== expectedChecksum) {
    throw new Error(
      `payloadChecksum mismatch: expected=${expectedChecksum}, got=${r1.payloadChecksum}`,
    );
  }
  // eslint-disable-next-line no-console
  console.log(
    `✓ Первый ingest: rawEventId=${r1.rawEventId}, payloadChecksum совпадает (sha256(payload))`,
  );

  const r2 = await ingestProbe(
    {
      tenantId: org.id,
      sourceId: source.id,
      sourceExternalId: meetingId1,
      occurredAt,
      payload: payload1,
    },
    queue,
  );
  if (r2.created !== false) throw new Error('Повторный ingest должен быть idempotent');
  if (r2.rawEventId !== r1.rawEventId) {
    throw new Error(`Повторный ingest вернул другой id: ${r2.rawEventId} != ${r1.rawEventId}`);
  }
  // eslint-disable-next-line no-console
  console.log(`✓ Повторный ingest: idempotent, rawEventId=${r2.rawEventId} (тот же)`);

  const meetingId2 = `${meetingId1}-other`;
  const payload2 = { ...payload1, meetingId: meetingId2 };
  const r3 = await ingestProbe(
    {
      tenantId: org.id,
      sourceId: source.id,
      sourceExternalId: meetingId2,
      occurredAt,
      payload: payload2,
    },
    queue,
  );
  if (!r3.created) throw new Error('Другой externalId должен создать новый RawEvent');
  if (r3.rawEventId === r1.rawEventId) {
    throw new Error('Разные externalId → одинаковый id (баг idempotencyKey)');
  }
  if (r3.idempotencyKey === r1.idempotencyKey) {
    throw new Error('Разные externalId дают одинаковый idempotencyKey');
  }
  // eslint-disable-next-line no-console
  console.log(`✓ Другой externalId: новый rawEventId=${r3.rawEventId}`);

  await new Promise((r) => setTimeout(r, 200));
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
  // eslint-disable-next-line no-console
  console.log(`✓ Очередь ${QUEUE_NAME} counts:`, counts);
  const totalQueued = counts.waiting + counts.active + counts.completed + counts.delayed;
  if (totalQueued < 2) {
    throw new Error(`Ожидали >=2 job'а в core.raw-events, нашли ${totalQueued}`);
  }
  // eslint-disable-next-line no-console
  console.log(`✓ В очереди >=2 job'ов (jobId='raw_<rawEventId>')`);

  await prisma.rawEvent.deleteMany({ where: { tenantId: org.id } });
  await prisma.source.deleteMany({ where: { tenantId: org.id } });
  await prisma.membership.deleteMany({ where: { orgId: org.id } });
  await prisma.org.deleteMany({ where: { id: org.id } });
  await prisma.user.deleteMany({ where: { id: owner.id } });
  await queue.obliterate({ force: true }).catch(() => undefined);
  await queue.close();
  await redis.quit();
  // eslint-disable-next-line no-console
  console.log(`✓ Cleanup готов`);

  // eslint-disable-next-line no-console
  console.log('=== smoke-ingest-fase1 PASSED ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('smoke-ingest-fase1 FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
