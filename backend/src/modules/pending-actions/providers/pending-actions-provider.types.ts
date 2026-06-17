/**
 * Контракт провайдеров Action Center B0 (2026-06-02).
 *
 * Каждый провайдер читает Prisma НАПРЯМУЮ (read-model, tenant-scoped) — без
 * импорта тяжёлых feature-сервисов. `PendingActionsService` оркеструет
 * провайдеры, резолвит роль пользователя и применяет snooze-фильтр.
 */

export interface PendingActionItem {
  source:
    | 'curation'
    | 'conflict'
    | 'intake'
    | 'probe'
    | 'task_closure'
    | 'task_review';
  resourceType: string;
  resourceId: string;
  /// Готовый к показу заголовок (RU) — РЕАЛЬНАЯ суть item'а, а не шаблон.
  title: string;
  severity: 'normal' | 'urgent';
  ageDays: number;
  /// Deep-link на страницу действия.
  actionUrl: string;
  /// true — можно подтвердить «в один клик» (lightweight curation light-item).
  canQuickConfirm: boolean;
  /// Редизайн Ф4 (2026-06-13) — структурный контекст для inline-карточки в
  /// очереди решений. Дискриминируется `kind` (= source). Опционально —
  /// обратная совместимость; недоступное поле остаётся `undefined`.
  detail?: PendingActionDetail;
}

/// Структурный detail item'а — дискриминированный union по `kind` (= source).
export type PendingActionDetail =
  | ProbePendingDetail
  | ConflictPendingDetail
  | IntakePendingDetail
  | CurationPendingDetail
  | TaskClosurePendingDetail
  | TaskReviewPendingDetail;

/// probe: сам вопрос + контекст для ответа.
export interface ProbePendingDetail {
  kind: 'probe';
  /// Текст уточняющего вопроса (Notification.payload.question).
  question: string;
  /// Контекст/повод вопроса (Notification.payload.context), если есть.
  context?: string;
  /// Название встречи-источника (если probe привязан к встрече).
  meetingTitle?: string;
  /// Короткая ссылка-цитата на источник (если есть).
  cite?: string;
  /// id Notification (для ответа через respond).
  notificationId: string;
}

/// conflict: суть конфликта + обе версии.
export interface ConflictPendingDetail {
  kind: 'conflict';
  /// Краткая суть конфликта (из evidence: explanation/reason).
  summary: string;
  oldVersion: { text: string; date?: string; cite?: string };
  newVersion: { text: string; date?: string; cite?: string };
}

/// intake: что за входящая задача.
export interface IntakePendingDetail {
  kind: 'intake';
  title: string;
  description?: string;
  /// Имя предлагаемого исполнителя (резолв userId → Person.name).
  assigneeName?: string;
  /// Человекочитаемый срок (ISO suggestedDueDate).
  dueLabel?: string;
  /// Уверенность извлечения (0..1), если посчитана.
  confidence?: number;
  cite?: string;
}

/// task_closure (TZ task-dedup, 2026-06-16, Ф2): задача-кандидат на закрытие
/// по сигналу из разговора. Обратимое предложение — человек подтверждает/отклоняет.
export interface TaskClosurePendingDetail {
  kind: 'task_closure';
  /// Заголовок задачи-кандидата на закрытие.
  taskTitle: string;
  /// «Почему считаем сделанным» — человеческим языком, +/- сигналы.
  rationale?: string;
  /// Цитата из разговора (объяснимость в стиле Gong).
  evidenceQuote?: string;
  /// Откалиброванная уверенность верификатора (0..1), если посчитана.
  confidence?: number;
}

/// task_review (TZ task-dedup, 2026-06-16, Ф4): задача «под вопросом» после
/// отмены/замены связанного решения (supersede). Человек проверяет актуальность
/// и снимает пометку — задача НЕ закрывается/не отменяется автоматически (R11/R13).
export interface TaskReviewPendingDetail {
  kind: 'task_review';
  /// Заголовок задачи «под вопросом».
  taskTitle: string;
  /// Человеческое объяснение «почему под вопросом».
  reason?: string;
}

/// curation: что за карточка требует проверки.
export interface CurationPendingDetail {
  kind: 'curation';
  /// Название карточки (из proposedPayload: name/title/statement).
  cardTitle: string;
  /// Короткий предпросмотр сути.
  preview?: string;
  cite?: string;
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
