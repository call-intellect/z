import type { Prisma } from '@prisma/client';

/**
 * ТЗ редизайн Ф7б (Б-3 «Кто держит слово» / «Надёжность %») — единый предикат
 * ПОЛНОТЫ обязательства (commitment).
 *
 * Обещание считается «полным» и учитывается в метриках надёжности ТОЛЬКО при
 * полной связке «кто + что + кому/срок»:
 *
 *   complete ⟺ commitmentAuthorPersonId != null
 *              И (commitmentRecipientPersonId != null ИЛИ commitmentDueDate != null)
 *
 * «что» = текст блока (criticalQuestion/trustedAnswer) — есть всегда, поэтому в
 * предикат не входит. Неполный commitment — это по сути «открытый вопрос»: он
 * НЕ участвует в расчёте надёжности и показывается отдельно.
 *
 * БЕЗ потери данных: `signalType` НЕ реклассифицируется, схема НЕ меняется —
 * гейт применяется только на ЧТЕНИИ/в метриках. Источник правды — этот файл;
 * и Prisma-`where`-фрагмент, и in-memory предикат должны оставаться синхронными.
 */

/** Минимальная проекция блока-обещания для проверки полноты в памяти. */
export interface CommitmentCompletenessFields {
  commitmentAuthorPersonId: string | null;
  commitmentRecipientPersonId: string | null;
  commitmentDueDate: Date | null;
}

/**
 * Prisma-`where`-фрагмент полноты commitment. Подмешивается через spread в
 * базовый `where` (рядом с `tenantId`/`signalType`/`commitmentDueDate`-окном).
 *
 * Применяется на ВСЕХ scope (company/team/person) расчёта надёжности — иначе
 * 1/1=100% по неполному обещанию врёт, а адресат видит «чужое» обещание без
 * назначенного ответственного/срока.
 */
export function completeCommitmentWhere(): Prisma.IdeaBlockWhereInput {
  return {
    commitmentAuthorPersonId: { not: null },
    OR: [
      { commitmentRecipientPersonId: { not: null } },
      { commitmentDueDate: { not: null } },
    ],
  };
}

/**
 * In-memory предикат полноты. Та же формула, что `completeCommitmentWhere`, для
 * случаев, когда блоки уже выбраны и фильтруются/раскладываются в JS.
 */
export function isCompleteCommitment(
  block: CommitmentCompletenessFields,
): boolean {
  if (block.commitmentAuthorPersonId == null) return false;
  return (
    block.commitmentRecipientPersonId != null ||
    block.commitmentDueDate != null
  );
}

/**
 * Причина, по которой неполный commitment попал в «открытые вопросы» — для UI.
 * Возвращается ТОЛЬКО для неполных блоков (для полных — null).
 *
 *   - 'no_author'    — не определён автор (кто дал слово);
 *   - 'no_recipient_and_due' — есть автор, но нет ни адресата, ни срока.
 *
 * Если автор есть и есть либо адресат, либо срок — блок полный (null).
 */
export function incompleteCommitmentReason(
  block: CommitmentCompletenessFields,
): 'no_author' | 'no_recipient_and_due' | null {
  if (block.commitmentAuthorPersonId == null) return 'no_author';
  if (
    block.commitmentRecipientPersonId == null &&
    block.commitmentDueDate == null
  ) {
    return 'no_recipient_and_due';
  }
  return null;
}

/** Человекочитаемое (RU) пояснение причины неполноты для UI/DTO. */
export function incompleteCommitmentReasonText(
  reason: 'no_author' | 'no_recipient_and_due',
): string {
  switch (reason) {
    case 'no_author':
      return 'не определён автор обещания';
    case 'no_recipient_and_due':
      return 'не назначен ответственный и нет срока';
  }
}
