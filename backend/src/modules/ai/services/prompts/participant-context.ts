/**
 * Контекст участника встречи для AI-промптов жёсткой идентификации.
 *
 * ТЗ 2026-05-25 `hard-participant-identification` (§4.1).
 *
 * Используется промптами извлечения задач (`tasks-structured`,
 * `tasks-unified`), чтобы LLM мог вернуть не только строку `assigneeRaw`
 * («Иван», «маркетинг»), но и точный `User.id` (`assigneeUserId`) для
 * зарегистрированных сотрудников, упомянутых в этой встрече.
 *
 * Эталон жёсткой идентификации — `behavior-metrics-calculator.ts:253-268`:
 *   1) сначала пробуем сопоставить по `livekitIdentity` (точный ключ);
 *   2) затем — по `displayName` (мягкий матч, case-insensitive).
 *
 * Гость (`role='guest'`) — `userId=null`, в task'е остаётся только
 * `assigneeRaw`. Матчинг гостей по email/календарю — отдельный план vNext.
 */
export interface AiParticipantContext {
  /**
   * Стабильный ключ из LiveKit. Формат:
   *   - `"host:<userId>"` для зарегистрированных сотрудников
   *     (см. `participants.service.ts:joinAsHost`);
   *   - `"guest:<nanoid>"` для гостей.
   */
  livekitIdentity: string;
  /**
   * Display name как ввёл пользователь (host — его имя в User, guest —
   * введённое в форме). Совпадает со speaker в транскрипте.
   */
  displayName: string;
  /**
   * Заполнено для любого зарегистрированного участника
   * (`isRegisteredUser=true`), независимо от `role` — host ИЛИ
   * приглашённый сотрудник-гость. Для анонимных гостей — null.
   */
  userId: string | null;
  /**
   * Полное имя из `User.name`, если зарегистрирован. Используется как
   * подсказка LLM, когда display name отличается от канонического имени
   * (например, «Серёжа» в display vs «Сергей Иванов» в User).
   */
  fullName: string | null;
  /** Роль в текущей встрече. */
  role: 'host' | 'guest';
}

/**
 * Формирует компактный текстовый блок СПИСКА УЧАСТНИКОВ.
 *
 * F1 cache-friendly (контракт закреплён 2026-06-10, Кластер 7-B/A8): список
 * участников — это ПЕРЕМЕННЫЕ данные на каждую встречу, поэтому он ОБЯЗАН
 * идти в USER-сообщении (рядом с транскриптом), а НЕ в SYSTEM. В SYSTEM —
 * только стабильные `PARTICIPANT_IDENTIFICATION_RULES` (правила, без списка).
 * Так SYSTEM-префикс остаётся стабильным и кэшируется провайдером ≈99%
 * (см. feedback `LLM-промпты — обязательно cache-friendly`). НЕ переносить
 * этот блок в SYSTEM.
 *
 * Один участник = одна строка. Пустой список → пустая строка.
 *
 * Формат (пример):
 *   - "Анна Иванова" (userId=user_abc, role=host)
 *   - "Сергей" (userId=user_def, role=host)
 *   - "Иван" (userId=null, role=guest)
 *
 * Используется в `tasks-unified`, `tasks-structured` (в USER-блоке).
 */
export function formatParticipantsForPrompt(
  participants: readonly AiParticipantContext[],
): string {
  if (participants.length === 0) return '';
  return participants
    .map((p) => {
      const name =
        p.fullName && p.fullName !== p.displayName
          ? `${p.displayName} (${p.fullName})`
          : p.displayName;
      const userIdRepr = p.userId ?? 'null';
      return `- "${name}" (userId=${userIdRepr}, role=${p.role})`;
    })
    .join('\n');
}

/**
 * Текст ПРАВИЛ жёсткой идентификации для СИСТЕМНОГО промпта.
 *
 * F1 cache-friendly (контракт закреплён 2026-06-10): это СТАБИЛЬНАЯ строка без
 * переменных данных — её можно держать в SYSTEM. Сам список участников НЕ
 * дублируется здесь: он переменный и ставится отдельным блоком в USER (см.
 * `formatParticipantsForPrompt`). Не вшивать в этот текст конкретных имён/userId.
 */
export const PARTICIPANT_IDENTIFICATION_RULES = `Правила идентификации исполнителя:
- Если в речи прозвучало имя, точно совпадающее с участником из списка с непустым userId, в поле "assigneeUserId" верни ИМЕННО этот userId (не выдумывай чужие).
- Если совпадений >1 (например, два «Сергея» в списке) или имя — это роль/команда («маркетинг», «продажи») — assigneeUserId = null.
- Если исполнитель — гость (userId=null в списке) — assigneeUserId = null, оставляй только assigneeRaw.
- assigneeRaw возвращай ВСЕГДА — это исходная фраза из транскрипта (для UI fallback и аудита).`;
