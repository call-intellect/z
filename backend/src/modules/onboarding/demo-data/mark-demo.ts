/**
 * audit Б3 (2026-05-29) — после seed демо-кабинета пробегаемся по всем
 * tenant-scoped моделям, у которых есть колонка `externalSource`, и
 * проставляем 'demo' для записей с `externalSource = null`.
 *
 * Это альтернатива добавлению `externalSource: 'demo'` в КАЖДУЮ
 * seed-функцию (35+ мест). Один helper — одна точка обслуживания.
 * `resetDemoWorkspace` потом удаляет ТОЛЬКО `externalSource = 'demo'`,
 * не задевая боевые записи (`externalSource = null`).
 *
 * ВАЖНО: должен вызываться ПОСЛЕ всех seedXxx() и ДО `Org.demoWorkspaceSeededAt`,
 * чтобы единый «момент истины» был зафиксирован.
 *
 * Используется в `OnboardingService.seedDemoWorkspace` и в backfill-скрипте
 * `patch-mark-demo-data.ts` (для legacy-demo Org).
 */
import type { PrismaClient } from '@prisma/client';

/**
 * Маркер 'demo'. Не выносим в config — это намеренно строковая константа,
 * единая для seed-flow и reset-flow.
 */
export const DEMO_EXTERNAL_SOURCE = 'demo';

/** Список таблиц, у которых есть `tenantId` + `externalSource`. Обновлять,
 *  если добавляется новая верхнеуровневая модель в `resetDemoWorkspace`. */
const DEMO_TENANT_TABLES = [
  'cloneAccessGrant',
  'ideaBlock',
  'entity',
  'theme',
  'goal',
  'goalAlignmentSnapshot',
  'department',
  'role',
  'person',
  'appointment',
  'companyProfile',
  'functionalDomain',
  'process',
  'processStep',
  'decision',
  'insight',
  'notification',
  'dailyCheckIn',
  'weeklyOperationsDigest',
  'dailyOperationsDigest',
  'chatV2Conversation',
  'skillProfile',
  'executablePersona',
  'project',
  'projectDocument',
  'issueState',
  'cycle',
  'sprintHint',
  'helpfulnessSpotlight',
  'recognition',
  'card',
] as const;

export async function markAllDemoEntitiesForTenant(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ updated: number }> {
  let updated = 0;
  for (const table of DEMO_TENANT_TABLES) {
    // PrismaClient типизирует delegates, но cross-table iteration
    // требует unknown-cast. Безопасно: имена таблиц захардкожены выше.
    const delegate = (prisma as unknown as Record<string, {
      updateMany(args: {
        where: { tenantId: string; externalSource: null };
        data: { externalSource: string };
      }): Promise<{ count: number }>;
    }>)[table];
    if (!delegate || typeof delegate.updateMany !== 'function') continue;
    const res = await delegate.updateMany({
      where: { tenantId, externalSource: null },
      data: { externalSource: DEMO_EXTERNAL_SOURCE },
    });
    updated += res.count;
  }
  return { updated };
}
