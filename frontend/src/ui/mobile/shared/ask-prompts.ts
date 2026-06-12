/**
 * Промпт-подсказки для мобильного экрана «Спросить» по роли (B4/Ф5
 * `2026-06-11-remaining-handoff-finishable-now.md`; полный контракт —
 * `2026-06-11-mobile-cora-exec-manager.md` §Ф5).
 *
 * Чистый модуль (без JSX/хуков) — выбор набора по роли тестируется
 * детерминированно (`ask-prompts.test.ts`), без рендера и сети.
 *
 * Наборы:
 *   - exec (owner/admin): «Сводка за неделю», «Риски по проекту»,
 *     «Кому помочь с обещаниями».
 *   - manager/coo/прочее: «Как у нас оформляют…», «Что решили по…»,
 *     «Спросить клон должности».
 *
 * Многоточие «…» в части шаблонов — это намеренный «хвост»: тап подставляет
 * текст в поле, пользователь дописывает конкретику и отправляет сам.
 */

import type { CurrentOrgRole } from '@/domain/account';

/** Руководитель (owner/admin) — глядит на компанию сверху. */
export const EXEC_ASK_PROMPTS: readonly string[] = [
  'Сводка за неделю',
  'Риски по проекту',
  'Кому помочь с обещаниями',
] as const;

/** Менеджер/coo/прочие — «как у нас принято» и решения. */
export const MANAGER_ASK_PROMPTS: readonly string[] = [
  'Как у нас оформляют…',
  'Что решили по…',
  'Спросить клон должности',
] as const;

/** owner/admin → exec-набор; manager/coo/null → manager-набор. */
export function askPromptsForRole(role: CurrentOrgRole): readonly string[] {
  if (role === 'owner' || role === 'admin') return EXEC_ASK_PROMPTS;
  return MANAGER_ASK_PROMPTS;
}
