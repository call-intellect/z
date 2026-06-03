/**
 * Контракт провайдеров Action Center B0 (2026-06-02).
 *
 * Каждый провайдер читает Prisma НАПРЯМУЮ (read-model, tenant-scoped) — без
 * импорта тяжёлых feature-сервисов. `PendingActionsService` оркеструет
 * провайдеры, резолвит роль пользователя и применяет snooze-фильтр.
 */

export interface PendingActionItem {
  source: 'curation' | 'conflict' | 'intake' | 'probe';
  resourceType: string;
  resourceId: string;
  /// Готовый к показу заголовок (RU).
  title: string;
  severity: 'normal' | 'urgent';
  ageDays: number;
  /// Deep-link на страницу действия.
  actionUrl: string;
  /// true — можно подтвердить «в один клик» (lightweight curation light-item).
  canQuickConfirm: boolean;
}

export interface PendingActionsProviderArgs {
  tenantId: string;
  userId: string;
  /// Роль пользователя в tenant (owner/admin/... ) или null, если не член Org.
  role: string | null;
  /// resourceId'ы этого источника, отложенные пользователем (snooze ещё
  /// активен). Провайдер исключает их из count/list. Заполняет
  /// PendingActionsService из PendingActionSnooze.
  snoozedResourceIds: Set<string>;
}

export interface PendingActionsProvider {
  readonly source: PendingActionItem['source'];
  countForUser(a: PendingActionsProviderArgs): Promise<number>;
  listForUser(
    a: PendingActionsProviderArgs & { limit: number },
  ): Promise<PendingActionItem[]>;
}

/** owner/admin — «видят всё» по своим источникам. */
export function isPrivileged(role: string | null): boolean {
  return role === 'owner' || role === 'admin';
}

/** Полных суток с `createdAt` до now (floor, не отрицательное). */
export function ageDaysFrom(createdAt: Date, now: Date): number {
  const ms = now.getTime() - createdAt.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
