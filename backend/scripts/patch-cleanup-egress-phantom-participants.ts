/**
 * Patch: удалить фантомных Participant'ов, созданных egress-рекордерами LiveKit.
 *
 * Зачем: до фикса в `webhooks/livekit-events.handler.ts` обработчик
 * `participant_joined` создавал Participant на ЛЮБОЙ identity, включая
 * egress-рекордеры (composite + per-track), которые заходят в комнату как
 * участники с identity вида `EG_...` и пустым именем → `name='Participant'`,
 * `role='guest'`. Это плодило фантомных гостей (по одному на egress),
 * раздувало `participantsCount` в behavior-metrics и засоряло список
 * «Участники» в отчёте.
 *
 * Признак фантома: `livekitIdentity` НЕ начинается с `host:` и НЕ с `guest:`.
 * Реальные участники всегда имеют один из этих префиксов (см.
 * `ParticipantsService` + генерацию LiveKit-токенов). По этому же признаку
 * теперь фильтрует вебхук — скрипт чистит уже накопленное.
 *
 * Что делает:
 *   1. Находит Participant'ов с «чужим» identity-префиксом.
 *   2. Удаляет их `MeetingParticipantBehavior`-записи (FK onDelete=SetNull
 *      оставил бы строки с participantId=null — а они всё ещё видны в таблице
 *      «Поведение участников», поэтому удаляем явно).
 *   3. Удаляет самих Participant'ов.
 *
 * НЕ пересчитывает агрегаты `MeetingBehaviorMetrics` (silence% и пр.) — у
 * фантомов нулевое время речи, поэтому на агрегаты они почти не влияли;
 * исправляется только список участников. Полный пересчёт прошлых встреч —
 * вне рамок патча.
 *
 * Запуск:
 *   bun run scripts/patch-cleanup-egress-phantom-participants.ts --dry-run
 *   bun run scripts/patch-cleanup-egress-phantom-participants.ts
 *
 * Идемпотентность: повторный запуск — no-op (фантомов уже нет).
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

/** Реальные участники всегда имеют один из этих префиксов identity. */
const REAL_IDENTITY_PREFIXES = ['host:', 'guest:'];

const PHANTOM_WHERE = {
  AND: REAL_IDENTITY_PREFIXES.map((prefix) => ({
    NOT: { livekitIdentity: { startsWith: prefix } },
  })),
} as const;

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-cleanup-egress-phantom-participants START (dryRun=${dryRun}) ===`,
  );

  const phantoms = await prisma.participant.findMany({
    where: PHANTOM_WHERE,
    select: { id: true, meetingId: true, livekitIdentity: true, name: true },
  });

  // eslint-disable-next-line no-console
  console.log(`[count] фантомных Participant'ов: ${phantoms.length}`);

  if (phantoms.length === 0) {
    // eslint-disable-next-line no-console
    console.log('[skip] Нечего чистить — выходим');
    return;
  }

  // Превью первых нескольких — чтобы убедиться, что цепляем только egress.
  for (const p of phantoms.slice(0, 10)) {
    // eslint-disable-next-line no-console
    console.log(
      `  - ${p.id} meeting=${p.meetingId} identity="${p.livekitIdentity}" name="${p.name}"`,
    );
  }
  if (phantoms.length > 10) {
    // eslint-disable-next-line no-console
    console.log(`  … и ещё ${phantoms.length - 10}`);
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] Было бы удалено ${phantoms.length} Participant'ов + их behavior-записи`,
    );
    return;
  }

  const ids = phantoms.map((p) => p.id);

  const behaviorDeleted = await prisma.meetingParticipantBehavior.deleteMany({
    where: { participantId: { in: ids } },
  });
  // eslint-disable-next-line no-console
  console.log(`[delete] MeetingParticipantBehavior: ${behaviorDeleted.count}`);

  const participantsDeleted = await prisma.participant.deleteMany({
    where: { id: { in: ids } },
  });
  // eslint-disable-next-line no-console
  console.log(`[delete] Participant: ${participantsDeleted.count}`);

  // eslint-disable-next-line no-console
  console.log('=== patch-cleanup-egress-phantom-participants DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-cleanup-egress-phantom-participants FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
