/**
 * Хелперы «гарантировать слово json во ВХОДЕ» для json_object/json_schema режимов.
 *
 * Зачем класс-хелпер (Ф2 retest3, #72/#56/#73):
 * DeepSeek / Ollama (OpenAI-compat) и прокси agent-lia требуют, чтобы слово
 * «json» присутствовало в сообщениях, иначе отдают 400. Раньше каждый провайдер
 * дописывал подсказку ПО-РАЗНОМУ и часто в SYSTEM (`messages[0]`), что ломало
 * prompt caching: стабильный SYSTEM-префикс кэшируется (экономия ≈99%), правка
 * SYSTEM сбрасывает кэш. Поэтому подсказку дописываем ТОЛЬКО в ХВОСТ последнего
 * USER-сообщения (оно и так переменное), и только если слова «json» нет нигде.
 *
 * ВАЖНО (agent-lia proxy, #72): прокси валидирует слово «json» именно в `input`
 * (USER), а не в `instructions` (SYSTEM) — поэтому SYSTEM-вариант ещё и не
 * проходил валидацию прокси. Единый helper закрывает оба провайдера разом.
 */

/** Стабильный константный суффикс-подсказка. Один на всю кодовую базу, чтобы
 *  идемпотентная проверка `/json/i` срабатывала одинаково везде. */
export const JSON_MODE_USER_SUFFIX = '\n\nОтвет верни строго в формате JSON.';

/** true, если слово «json» уже встречается в любом из переданных текстов. */
export function hasJsonWord(...texts: Array<string | undefined | null>): boolean {
  return texts.some((t) => typeof t === 'string' && /json/i.test(t));
}

/**
 * Чистая функция для провайдеров с раздельными system/user строками
 * (openai-proxy: `instructions` + `input`). Возвращает (возможно изменённый)
 * userText: дописывает JSON-подсказку в хвост, если слова «json» нет ни в
 * system, ни в user. SYSTEM не трогает.
 */
export function appendJsonWordToUser(
  systemText: string,
  userText: string,
): string {
  if (hasJsonWord(systemText, userText)) return userText;
  return `${userText}${JSON_MODE_USER_SUFFIX}`;
}

/**
 * Мутирует messages-массив (deepseek/ollama): дописывает JSON-подсказку в хвост
 * ПОСЛЕДНЕГО user-сообщения, если слова «json» нет ни в одном сообщении.
 * Идемпотентна (повторный вызов после первого — no-op, т.к. слово уже есть).
 * SYSTEM-сообщения не трогаются ради prompt caching.
 */
export function ensureJsonWordInUser(
  messages: Array<{ role: string; content: string }>,
): void {
  if (messages.some((m) => /json/i.test(m.content))) return;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      m.content += JSON_MODE_USER_SUFFIX;
      return;
    }
  }
}
