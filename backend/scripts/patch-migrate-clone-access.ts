/**
 * ТЗ 2026-05-25 §9.4.2 (clone-respond эволюция, Фаза 7) — миграция
 * первичных грантов доступа к клонам при включении `CLONE_V2_ENABLED`.
 *
 * При первом включении V2 пользователи без галочек теряют доступ
 * (см. §9.8 «Риск 1 (доступ)»). Этот скрипт выдаёт первичные гранты
 * по факту использования, чтобы переход прошёл без визибл-регрессии:
 *
 *   1. Для каждой ChatV2Conversation с scope='card' и связанной
 *      assistant-message {mode='clone_style'} за последние N дней —
 *      выдать CloneAccessGrant паре (userId, scopeRefId) с
 *      cloneType, выводимым по существованию SkillProfile/Role.
 *   2. Для super_admin / owner Org — выдать гранты на все клоны Org.
 *      (Главный админ может выдавать галочку самому себе.)
 *   3. Для прежних носителей (Person.userId) — НЕ выдавать (по §9.3
 *      решение 1: носитель свой клон по умолчанию не видит).
 *
 * ⚠ ЭТО ЗАГЛУШКА. Сейчас скрипт ничего не делает в БД, только логирует
 * план. Реальная имплементация будет волной 2 (после frontend-маркетплейса
 * и admin-эндпоинтов CloneAccessGrant). До этого момента production
 * включает V2 только в тестовых тенантах, где грантовые галочки админ
 * выставляет руками через будущий admin UI.
 *
 * Запуск:
 *   bun run scripts/patch-migrate-clone-access.ts --tenant <orgId>
 *   bun run scripts/patch-migrate-clone-access.ts --tenant <orgId> --dry-run
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function parseArgs(): { tenantId: string | null; dryRun: boolean } {
  const args = process.argv.slice(2);
  let tenantId: string | null = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--tenant' && args[i + 1]) {
      tenantId = args[i + 1] ?? null;
      i++;
    } else if (a === '--dry-run') {
      dryRun = true;
    }
  }
  return { tenantId, dryRun };
}

async function main(): Promise<void> {
  const { tenantId, dryRun } = parseArgs();
  // eslint-disable-next-line no-console
  console.log(
    `=== patch-migrate-clone-access START (tenantId=${tenantId ?? 'ALL'}, dryRun=${dryRun}) ===`,
  );
  // eslint-disable-next-line no-console
  console.log(
    'TODO: реальная миграция грантов будет реализована волной 2 (после admin UI / маркетплейса).',
  );
  // eslint-disable-next-line no-console
  console.log(
    'Сейчас включайте V2 ТОЛЬКО на тестовых тенантах и выставляйте гранты вручную через будущий admin UI / БД.',
  );

  // План (для журналирования):
  if (tenantId) {
    const conversationsCount = await prisma.chatV2Conversation.count({
      where: { tenantId, scope: 'card' },
    });
    const grantsCount = await prisma.cloneAccessGrant.count({
      where: { tenantId },
    });
    // eslint-disable-next-line no-console
    console.log(
      `Tenant ${tenantId}: clone_style диалогов (примерно) ${conversationsCount}, существующих грантов ${grantsCount}.`,
    );
  }
  // eslint-disable-next-line no-console
  console.log('=== patch-migrate-clone-access DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('patch-migrate-clone-access FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
