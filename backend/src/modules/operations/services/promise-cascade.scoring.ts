/**
 * TZ-1 Фаза 3.C (daily-value-engine) — чистая логика каскада обещаний.
 * Без зависимостей от Prisma/NestJS (unit-тестируется без БД).
 */

/** Минимальный срез обещания для детекции каскада. */
export interface CommitmentForCascade {
  id: string;
  /** Автор обещания (кто дал слово). NULL → не каскадим (нет адресности). */
  authorPersonId: string | null;
  /** Адресат обещания (кто ждёт). */
  recipientPersonId: string | null;
  /** Срок исполнения. */
  dueDate: Date | null;
  /** Статус: open|asked|fulfilled|missed|cancelled|superseded. */
  status: string | null;
  /**
   * Есть ли исходящая зависимость: обещание держит чужую работу
   * (задачу/цель адресата или другого человека). Резолвится сервисом.
   */
  hasOutgoingDependency: boolean;
}

/**
 * Просрочено ли обещание на момент `now`. Чистая функция.
 *   - dueDate < now,
 *   - статус ещё «висит» (open|asked) — не fulfilled/cancelled/superseded.
 */
export function isCommitmentOverdue(
  c: Pick<CommitmentForCascade, 'dueDate' | 'status'>,
  now: Date,
): boolean {
  if (!c.dueDate) return false;
  if (c.dueDate.getTime() >= now.getTime()) return false;
  const status = (c.status ?? 'open').toLowerCase();
  return status === 'open' || status === 'asked';
}

/**
 * Является ли обещание критическим каскадом: просрочено, есть автор И есть
 * исходящая зависимость (держит чужую работу). Чистая функция.
 */
export function isCascadeCritical(c: CommitmentForCascade, now: Date): boolean {
  if (!c.authorPersonId) return false;
  if (!c.hasOutgoingDependency) return false;
  return isCommitmentOverdue(c, now);
}

/**
 * Отфильтровать критические каскады из списка обещаний. Чистая функция.
 */
export function selectCascadeCritical(
  commitments: CommitmentForCascade[],
  now: Date,
): CommitmentForCascade[] {
  return commitments.filter((c) => isCascadeCritical(c, now));
}
