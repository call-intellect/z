/**
 * Ф8 (knowledge-access-groups-and-provenance) — Patch: проставить
 * `MeetingTypeConfig.defaultClosedGroupKind = 'personal'` для типа встречи
 * `interview` (найм), если он ещё не задан (NULL).
 *
 * Зачем: решение владельца В6 — встречи-собеседования (interview) по умолчанию
 * закрываются в «личный сейф» (personal). При первом GET /admin/.../meeting-types
 * bootstrap-sync уже создаёт interview с этим дефолтом (см.
 * meeting-types-admin.service.ts `ensureBootstrap`), но на проде, где bootstrap
 * мог пройти ДО этой фичи, строка interview существует с
 * defaultClosedGroupKind=NULL. Этот патч добивает её.
 *
 * Запуск:
 *   docker compose exec backend bun run scripts/patch-meeting-type-closed-defaults.ts
 *   docker compose exec backend bun run scripts/patch-meeting-type-closed-defaults.ts --dry-run
 *
 * Идемпотентность: повторный запуск — no-op (WHERE defaultClosedGroupKind IS NULL).
 *
 * Safe-seed-rules: НЕ перезаписываем уже выставленный admin'ом
 * defaultClosedGroupKind — только NULL → 'personal'. Остальные типы не трогаем.
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const INTERVIEW_ID = 'interview';
const PERSONAL = 'personal';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  // eslint-disable-next-line no-console
  console.log(`=== patch-meeting-type-closed-defaults START (dryRun=${dryRun}) ===`);

  const row = await prisma.meetingTypeConfig.findUnique({
    where: { id: INTERVIEW_ID },
    select: { id: true, defaultClosedGroupKind: true, sortOrder: true },
  });

  // Строки interview ещё нет — bootstrap не запускался. Создадим минимальную
  // с нужным дефолтом, чтобы патч был самодостаточным (а не зависел от первого GET).
  if (!row) {
    if (dryRun) {
      // eslint-disable-next-line no-console
      console.log(
        `[dry-run] Строки MeetingTypeConfig id='${INTERVIEW_ID}' нет — была бы создана с ` +
          `defaultClosedGroupKind='${PERSONAL}'.`,
      );
      return;
    }
    await prisma.meetingTypeConfig.create({
      data: {
        id: INTERVIEW_ID,
        displayName: INTERVIEW_ID,
        isActive: true,
        sortOrder: 7,
        defaultClosedGroupKind: PERSONAL,
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[create] Создана минимальная строка interview с defaultClosedGroupKind='${PERSONAL}' ` +
        `(bootstrap при первом GET пересоздавать не будет — count>0).`,
    );
    // eslint-disable-next-line no-console
    console.log('=== patch-meeting-type-closed-defaults DONE ===');
    return;
  }

  if (row.defaultClosedGroupKind !== null) {
    // eslint-disable-next-line no-console
    console.log(
      `[skip] interview.defaultClosedGroupKind уже задан ('${row.defaultClosedGroupKind}') — ` +
        `не перезаписываем (safe-seed).`,
    );
    // eslint-disable-next-line no-console
    console.log('=== patch-meeting-type-closed-defaults DONE ===');
    return;
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log(
      `[dry-run] interview.defaultClosedGroupKind IS NULL → было бы выставлено '${PERSONAL}'.`,
    );
    return;
  }

  const result = await prisma.meetingTypeConfig.updateMany({
    where: { id: INTERVIEW_ID, defaultClosedGroupKind: null },
    data: { defaultClosedGroupKind: PERSONAL },
  });
  // eslint-disable-next-line no-console
  console.log(
    `[update] Обновлено строк MeetingTypeConfig: ${result.count} ` +
      `(interview → defaultClosedGroupKind='${PERSONAL}')`,
  );

  // eslint-disable-next-line no-console
  console.log('=== patch-meeting-type-closed-defaults DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-meeting-type-closed-defaults FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    void prisma.$disconnect();
  });
