import type { ParticipantRole, RawEvent, SourceType } from '@prisma/client';

import { createPrismaClient } from './_lib/prisma';
import { silenceRedisShutdownNoise } from './_lib/silence-redis-shutdown';

const BATCH_SIZE = 200;

export const SOURCE_LAYER_KIND_BY_TYPE: Partial<
  Record<SourceType, 'meeting' | 'document' | 'chat'>
> = {
  meeting: 'meeting',
  meeting_report: 'meeting',
  external: 'document',
  chat: 'chat',
  chatbox: 'chat',
  bitrix: 'chat',
};

export interface BackfillOptions {
  tenantId?: string;
  limit?: number;
  dryRun: boolean;
}

export interface BackfillStats {
  scanned: number;
  episodes: number;
  participants: number;
  entities: number;
  skipped: number;
}

type PrismaLike = ReturnType<typeof createPrismaClient>;

function parseArgs(argv: string[]): BackfillOptions {
  const tenantArg = argv.find((a) => a.startsWith('--tenant='));
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const opts: BackfillOptions = { dryRun: argv.includes('--dry-run') };
  if (tenantArg) {
    const v = tenantArg.split('=')[1];
    if (v) opts.tenantId = v;
  }
  if (limitArg) {
    const v = limitArg.split('=')[1];
    if (v) {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`Invalid --limit value: "${v}" (expected positive integer)`);
      }
      opts.limit = Math.floor(n);
    }
  }
  return opts;
}

export function resolveKind(sourceType: SourceType): 'meeting' | 'document' | 'chat' | null {
  return SOURCE_LAYER_KIND_BY_TYPE[sourceType] ?? null;
}

function tryGetPayloadMeetingId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as { meetingId?: unknown }).meetingId;
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export function resolveMeetingId(
  event: Pick<RawEvent, 'sourceType' | 'sourceExternalId'>,
  payload: unknown,
): string | null {
  if (event.sourceType === 'meeting') return event.sourceExternalId ?? null;
  if (event.sourceType === 'meeting_report') {
    const fromPayload = tryGetPayloadMeetingId(payload);
    if (fromPayload) return fromPayload;
    const ext = event.sourceExternalId ?? '';
    return ext.startsWith('report_') ? ext.slice('report_'.length) : null;
  }
  return null;
}

export function resolveTitle(
  event: Pick<RawEvent, 'sourceTitle' | 'sourceExternalId' | 'sourceType' | 'id'>,
): string {
  const fromEvent = event.sourceTitle?.trim();
  if (fromEvent && fromEvent.length > 0) return fromEvent.slice(0, 500);
  return event.sourceExternalId?.trim() || `${event.sourceType}:${event.id}`;
}

function mapParticipantRole(role: ParticipantRole): string {
  return role === 'host' ? 'host' : 'guest';
}

function tryGetChatAuthorPersonId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const resp = p['responsible'];
  if (resp && typeof resp === 'object') {
    const pid = (resp as { personId?: unknown }).personId;
    if (typeof pid === 'string' && pid.trim().length > 0) return pid.trim();
  }
  const uploaderId = p['uploaderId'];
  if (typeof uploaderId === 'string' && uploaderId.trim().length > 0) return uploaderId.trim();
  return null;
}

export async function backfillSourceLayer(
  prisma: PrismaLike,
  opts: BackfillOptions,
): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    episodes: 0,
    participants: 0,
    entities: 0,
    skipped: 0,
  };

  const eventWhere = {
    processingStatus: 'ingested' as const,
    sourceType: { in: Object.keys(SOURCE_LAYER_KIND_BY_TYPE) as SourceType[] },
    sourceEpisodes: { none: {} },
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
  };

  const pending = await prisma.rawEvent.count({ where: eventWhere });
  if (pending === 0) {
    console.log(
      'backfill-source-layer: все источники уже материализованы — backfill не требуется (already-present).',
    );
    return stats;
  }

  console.log(`backfill-source-layer: RawEvent без SourceEpisode — ${pending}`);

  let cursorId: string | undefined = undefined;
  let processed = 0;
  while (true) {
    if (opts.limit && processed >= opts.limit) break;
    const take = opts.limit ? Math.min(BATCH_SIZE, opts.limit - processed) : BATCH_SIZE;

    const batch = await prisma.rawEvent.findMany({
      where: eventWhere,
      select: {
        id: true,
        tenantId: true,
        sourceType: true,
        sourceExternalId: true,
        sourceTitle: true,
        occurredAt: true,
        payloadStorage: true,
        payload: true,
      },
      orderBy: { id: 'asc' },
      take,
      ...(cursorId ? { skip: 1, cursor: { id: cursorId } } : {}),
    });
    if (batch.length === 0) break;

    for (const event of batch) {
      stats.scanned++;
      processed++;
      const kind = resolveKind(event.sourceType);
      if (!kind) {
        stats.skipped++;
        continue;
      }

      try {
        const tenantId = event.tenantId;
        const rawEventId = event.id;
        const title = resolveTitle(event);
        const payload = event.payloadStorage === 's3' ? null : event.payload;

        if (opts.dryRun) {
          console.log(
            `[DRY-RUN] SourceEpisode rawEventId=${rawEventId} kind=${kind} title="${title.slice(0, 60)}"`,
          );
        } else {
          await prisma.sourceEpisode.upsert({
            where: { rawEventId_tenantId: { rawEventId, tenantId } },
            create: { tenantId, rawEventId, kind, title, occurredAt: event.occurredAt },
            update: { kind, title, occurredAt: event.occurredAt },
          });
        }
        stats.episodes++;

        if (kind === 'meeting') {
          const meetingId = resolveMeetingId(event, payload);
          if (meetingId) {
            const participants = await prisma.participant.findMany({
              where: { meetingId, personId: { not: null } },
              select: { personId: true, role: true },
            });
            const seen = new Set<string>();
            for (const p of participants) {
              const personId = p.personId;
              if (!personId || seen.has(personId)) continue;
              seen.add(personId);
              if (!opts.dryRun) {
                await prisma.sourceParticipant.upsert({
                  where: { rawEventId_personId: { rawEventId, personId } },
                  create: { rawEventId, personId, tenantId, role: mapParticipantRole(p.role) },
                  update: { tenantId, role: mapParticipantRole(p.role) },
                });
              }
              stats.participants++;
            }
          }
        } else if (kind === 'chat') {
          const authorPersonId = tryGetChatAuthorPersonId(payload);
          if (authorPersonId) {
            if (!opts.dryRun) {
              await prisma.sourceParticipant.upsert({
                where: { rawEventId_personId: { rawEventId, personId: authorPersonId } },
                create: { rawEventId, personId: authorPersonId, tenantId, role: 'author' },
                update: { tenantId, role: 'author' },
              });
            }
            stats.participants++;
          }
        }

        const blocks = await prisma.ideaBlockEvidence.findMany({
          where: { rawEventId, tenantId },
          select: { blockId: true },
        });
        const blockIds = [...new Set(blocks.map((b) => b.blockId))];
        if (blockIds.length > 0) {
          const grouped = await prisma.ideaBlockEntity.groupBy({
            by: ['entityId'],
            where: { blockId: { in: blockIds }, tenantId },
            _count: { entityId: true },
          });
          for (const row of grouped) {
            if (!opts.dryRun) {
              await prisma.sourceEntity.upsert({
                where: { rawEventId_entityId: { rawEventId, entityId: row.entityId } },
                create: {
                  rawEventId,
                  entityId: row.entityId,
                  tenantId,
                  mentionsCount: row._count.entityId,
                },
                update: { tenantId, mentionsCount: row._count.entityId },
              });
            }
            stats.entities++;
          }
        }
      } catch (err) {
        stats.skipped++;

        console.warn(
          `[error] rawEventId=${event.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    cursorId = batch[batch.length - 1]?.id;
    if (batch.length < take) break;
  }

  return stats;
}

async function main(opts: BackfillOptions): Promise<void> {
  console.log(
    `=== backfill-source-layer START ` +
      `(dryRun=${opts.dryRun}, tenant=${opts.tenantId ?? '<all>'}, limit=${opts.limit ?? '<none>'}) ===`,
  );
  const prisma = createPrismaClient();
  try {
    const stats = await backfillSourceLayer(prisma, opts);

    console.log('=== Итоги backfill-source-layer ===');

    console.log(`  scanned      : ${stats.scanned}`);

    console.log(`  episodes     : ${stats.episodes}`);

    console.log(`  participants : ${stats.participants}`);

    console.log(`  entities     : ${stats.entities}`);

    console.log(`  skipped      : ${stats.skipped}`);

    console.log(`  mode         : ${opts.dryRun ? 'DRY-RUN' : 'APPLY'}`);
  } finally {
    await prisma.$disconnect();
  }
}

const isEntry =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  /backfill-source-layer\.ts$/.test(process.argv[1] ?? '');

if (isEntry) {
  const opts = parseArgs(process.argv.slice(2));
  silenceRedisShutdownNoise();
  main(opts)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('backfill-source-layer FAILED:', err);
      process.exit(1);
    });
}
