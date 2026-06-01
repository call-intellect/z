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
 *  если добавляется новая верхнеуровневая модель в `resetDemoWorkspace`.
 *
 *  ВАЖНО: Pulse snapshot-таблицы (KnowledgeRiskSnapshot, RecurringTopic,
 *  PromiseNetworkSnapshot, PersonGoalContribution, KnowledgeVelocitySnapshot,
 *  PersonEngagementSnapshot, ForecastSnapshot, CrossFunctionalFrictionReport,
 *  HelpfulnessTrait, SocialContributionProfile, ContributionSnapshot,
 *  ProcessTemplate) — НЕ имеют колонки `externalSource`. Их чистка идёт в
 *  `resetDemoWorkspace` напрямую по tenantId / userId. */
const DEMO_TENANT_TABLES = [
  // ── Org-structure ──
  'department', 'role', 'person', 'appointment', 'companyProfile',
  'functionalDomain',

  // ── Tracker ──
  'project', 'projectDocument', 'issueState', 'cycle', 'sprintHint',

  // ── Knowledge graph ──
  // NB: ideaBlockLink / entityLink СЮДА НЕ входят — у них НЕТ колонки
  // externalSource (junction-таблицы). Чистятся в resetDemoWorkspace по tenantId
  // (ideaBlockLink дополнительно каскадно удаляется при удалении demo-IdeaBlock).
  'ideaBlock', 'entity', 'theme', 'goal', 'goalAlignmentSnapshot',

  // ── Processes / decisions / insights ──
  'process', 'processStep', 'decision', 'insight',

  // ── Notifications / chat ──
  'notification', 'chatV2Conversation',

  // ── Operations ──
  'dailyCheckIn', 'weeklyOperationsDigest', 'dailyOperationsDigest',

  // ── Skills / personas ──
  'skillProfile', 'executablePersona', 'cloneAccessGrant',

  // ── Polish ──
  'helpfulnessSpotlight', 'recognition', 'card',

  // ── Demo Content Expansion 2026-05-31 ──
  // ВАЖНО: модели НИЖЕ (regulation, idea, ideaCluster, document, event,
  // experiment, vendor, probeEvent, feedbackMessage/Topic/Item, referral*,
  // brandVoiceProfile) НЕ имеют колонки externalSource → их НЕЛЬЗЯ помечать
  // здесь (markAll падал бы на updateMany). Регрессия мержа #7 (985d802):
  // их по ошибке добавили в этот список, что ломало ВЕСЬ demo-seed. Чистка —
  // в resetDemoWorkspace напрямую по tenantId (DEMO-org → все такие записи
  // демо, реальные невозможны из-за SubscriptionGuard).
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
