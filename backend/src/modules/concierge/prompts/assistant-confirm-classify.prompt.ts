/**
 * Ф6 assistant-channels (2026-06-11) — Assistant-Confirm-Classify.
 *
 * Текстовое подтверждение мутаций в каналах (zero-button, В6): когда помощник
 * отложил мутирующий инструмент без `undoableVia` (`confirm_required`), мост
 * (`AssistantChannelBridge`) спрашивает пользователя «Подтвердите действие: …
 * Ответьте «да» — выполню, «нет» — отменю.» Следующее сообщение пользователя
 * сначала прогоняется через дешёвую эвристику (точные «да»/«нет»-формы), а
 * если она не сработала — через этот LLM-классификатор.
 *
 * Контракт вывода: JSON `{"decision":"confirm|reject|unclear","confidence":0..1}`.
 *   - `confirm` (confidence ≥ 0.6) — исполнить отложенный инструмент;
 *   - `reject` — отменить;
 *   - `unclear` / невалидный JSON / провал LLM — переспросить (ключ ожидания
 *     в Redis остаётся жить до TTL).
 *
 * Совместимость с prompt caching:
 *   - SYSTEM стабилен (без переменных) → cache hit у DeepSeek / OpenAI-proxy
 *     с экономией ≈99%.
 *   - Все переменные данные (превью действия + ответ пользователя) — в конце
 *     USER. Префикс не меняется между вызовами — KV-cache переиспользуется.
 */

export const ASSISTANT_CONFIRM_CLASSIFY_SYSTEM_PROMPT = [
  'Ты — Кора. Классифицируй ответ пользователя на запрос подтверждения действия.',
  'Категории: confirm — пользователь согласен, действие надо выполнить; reject — пользователь отказывается или отменяет; unclear — ответ непонятен или про другое.',
  'Верни строго JSON {"decision":"confirm|reject|unclear","confidence":0..1} без пояснений и без другого текста.',
].join('\n');

export const ASSISTANT_CONFIRM_CLASSIFY_USER_TEMPLATE = (args: {
  actionPreview: string;
  reply: string;
}): string => {
  // Переменные данные — в самом конце user-сообщения (cache-friendly).
  return [
    `Действие, ожидающее подтверждения: ${args.actionPreview}`,
    `Ответ пользователя: ${args.reply}`,
  ].join('\n');
};
