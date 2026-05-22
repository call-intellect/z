import type { Metadata } from 'next';

import { MyCloneClient } from './MyCloneClient';

export const metadata: Metadata = {
  title: 'Попробовать своего клона — Кора',
};

/**
 * `/me/clone` (SBA γ-1) — обязательная страница «Попробовать своего клона».
 *
 * Диалоговое окно, где пользователь общается со своим AI-клоном
 * (на основе observed behavior в reasoning-блоках). Ответы — mode='clone_style'.
 *
 * Зонтичный §3.3 правило C5: запрет выпуска γ-1 без этой страницы.
 *
 * Что **НЕ** показывается:
 *   - Кнопка «отключить наблюдение» (§3.4 — никаких прав скрытия от руководителя).
 *
 * Что показывается:
 *   - Объяснение: «AI на основе моего наблюдаемого поведения на встречах».
 *   - Chat input для вопросов.
 *   - Ответы с badge «clone-style» + кнопка «помечу как неверно».
 */
export default function MyClonePage() {
  return <MyCloneClient />;
}
