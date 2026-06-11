---
title: Хелперы-обёртки (не SYSTEM-промпты — описание контракта + усиление)
date: 2026-06-10
index: 00-INDEX.md
covers: glossary (withGlossary) · participant-context (PARTICIPANT_IDENTIFICATION_RULES) · sanitize-custom-prompt (FORBIDDEN_PATTERNS)
---

# Хелперы-обёртки: батч 90

> Три файла не являются SYSTEM-промптами в привычном смысле — они **строительные кирпичи**,
> которые вставляются в чужие system-строки или работают на call-site. Поэтому формат «БЫЛО → СТАЛО»
> здесь означает: текущий текст вставки/логика → усиленный текст вставки/логика.
>
> Общие правила (E1/E2 — обёрткой на call-site, cache-friendly, контракт не ломать) —
> в [00-INDEX.md](00-INDEX.md) §0.

---

### `glossary` / `withGlossary` — словарь бизнес-терминов, вставляемый в чужой SYSTEM

- **Файл:** `backend/src/modules/ai/services/prompts/glossary.ts`
- **Контракт:** helper — функция `withGlossary(systemBody, terms)` дописывает блок
  «Глоссарий бизнес-терминов:» в конец переданного system-промпта. Не формирует
  самостоятельный SYSTEM; не влияет на схему вывода промпта-каллера.
- **Применимые измерения:** A1 (I4: норма/повторяемое ≠ разовое действие — добавить
  ключ `process_discriminator`); F1 (cache-friendly — стабильный текст в конце SYSTEM уже
  обеспечивается функцией; список терминов передаётся снаружи → не трогаем).
- **Код-сверка:**
  - `withGlossary` дописывает блок **в конец** system через `\n\nГлоссарий бизнес-терминов:\n`.
    Это уже cache-friendly — переменная часть не меняет начало стабильного SYSTEM.
  - Неизвестные ключи пропускаются silently — защита от опечаток.
  - Текущие 7 ключей: `pain · churn_risk · commitment · mentoring · proactive_hint · decision · regulation`.
  - Ни одной инъекционной обёртки нет и не нужна — это SYSTEM-хелпер, не оборачивающий
    пользовательский ввод.
  - Обёртки ASR/guard на call-site: **не применимы** (это SYSTEM-side helper, не user-side).
  - Ключа `process` нет в GLOSSARY — между тем `regulation` уже содержит разграничение
    «regulation vs process vs policy», но ключ `process_discriminator` (A1: норма≠разовое)
    отсутствует. Это пробел — добавить.

#### БЫЛО (содержимое словаря — 7 ключей)

```
pain: 'Pain — реальная проблема клиента/пользователя, которую он озвучивает.
  ОТЛИЧАТЬ от objection (возражение на цену/продавца) и concern (опасение, не подкреплённое опытом).'

churn_risk: 'Churn risk — риск ухода клиента/пользователя.
  ОТЛИЧАТЬ от disengagement (временное снижение активности без намерения уйти).'

commitment: 'Commitment — публичное обязательство сделать X к сроку Y.
  ОТЛИЧАТЬ от intention (внутреннее намерение без публичной фиксации).'

mentoring: 'Mentoring — передача знаний/опыта с целью развития получателя.
  ОТЛИЧАТЬ от explaining (просто объяснение факта/процесса).'

proactive_hint: 'Proactive hint — подсказка/предупреждение, которое не было запрошено
  получателем, но полезно ему. ОТЛИЧАТЬ от unsolicited advice (нежелательный совет, который
  не помогает).'

decision: 'Decision — выбор из нескольких опций, зафиксированный с обоснованием.
  ОТЛИЧАТЬ от preference (личное предпочтение без обоснования).'

regulation: 'Regulation — формальное правило компании (что/нельзя).
  ОТЛИЧАТЬ от process (последовательность шагов как делать) и policy (общий принцип).'
```

Итого: 7 ключей. Ключ `process_discriminator` (A1: норма+повторяемое ≠ разовое) — отсутствует.

#### СТАЛО (усиление словаря — 8 ключей)

```ts
// glossary.ts — GLOSSARY (усиленная версия, добавлен ключ process_discriminator)
const GLOSSARY: Record<string, string> = {
  pain: 'Pain — реальная проблема клиента/пользователя, которую он озвучивает. ОТЛИЧАТЬ от objection (возражение на цену/продавца) и concern (опасение, не подкреплённое опытом).',
  churn_risk:
    'Churn risk — риск ухода клиента/пользователя. ОТЛИЧАТЬ от disengagement (временное снижение активности без намерения уйти).',
  commitment:
    'Commitment — публичное обязательство сделать X к сроку Y. ОТЛИЧАТЬ от intention (внутреннее намерение без публичной фиксации).',
  mentoring:
    'Mentoring — передача знаний/опыта с целью развития получателя. ОТЛИЧАТЬ от explaining (просто объяснение факта/процесса).',
  proactive_hint:
    'Proactive hint — подсказка/предупреждение, которое не было запрошено получателем, но полезно ему. ОТЛИЧАТЬ от unsolicited advice (нежелательный совет, который не помогает).',
  decision:
    'Decision — выбор из нескольких опций, зафиксированный с обоснованием. ОТЛИЧАТЬ от preference (личное предпочтение без обоснования).',
  regulation:
    'Regulation — формальное правило компании (что/нельзя). ОТЛИЧАТЬ от process (последовательность шагов как делать) и policy (общий принцип).',
  // НОВЫЙ КЛЮЧ — A1: норма+повторяемое ≠ разовое действие
  process_discriminator:
    'Норма/регламент/процесс — то, КАК делается ВООБЩЕ: повторяемый порядок, «так у нас принято всегда». ОТЛИЧАТЬ от разовой задачи («сейчас Никита настраивает сервер» — это задача, а не регламент). Признак разовости: конкретный исполнитель + момент времени + нет указания на повторяемость.',
};
```

Текст, который вставляется в конец SYSTEM каллера при `withGlossary(system, ['process_discriminator'])`:

```
Глоссарий бизнес-терминов:
- Норма/регламент/процесс — то, КАК делается ВООБЩЕ: повторяемый порядок, «так у нас принято
  всегда». ОТЛИЧАТЬ от разовой задачи («сейчас Никита настраивает сервер» — это задача, а не
  регламент). Признак разовости: конкретный исполнитель + момент времени + нет указания на
  повторяемость.
```

*(Все прочие ключи остаются неизменными. Новый ключ подключают только промпты, явно работающие
с различением нормы и разовых задач — прежде всего `regulation-extract` и `specialists-combined`.)*

#### USER — не применимо (helper на SYSTEM-side)

#### ИЗМЕНЕНИЕ КОНТРАКТА

Нет — `withGlossary` по-прежнему возвращает `string` (расширенный SYSTEM). Тип `GlossaryTerm`
расширяется на `'process_discriminator'`, но это additive — старые вызовы не ломаются.

```ts
// glossary.ts — тип GlossaryTerm автоматически расширяется через keyof typeof GLOSSARY
export type GlossaryTerm = keyof typeof GLOSSARY;
// После добавления 'process_discriminator': тип включает новый ключ, все старые остаются
```

#### Что изменили

Добавлен новый ключ `process_discriminator` (A1/I4): точное определение разницы между
нормативным/повторяемым (= регламент/процесс) и разовым действием (= задача). Ключ подключается
явно только в промптах, различающих эти понятия — `regulation-extract`, `specialists-combined`.
Все 7 прежних ключей не изменились.

---

### `participant-context` / `PARTICIPANT_IDENTIFICATION_RULES` — правила жёсткой идентификации исполнителя

- **Файл:** `backend/src/modules/ai/services/prompts/participant-context.ts`
- **Контракт:** helper — экспортирует константу `PARTICIPANT_IDENTIFICATION_RULES` (строка,
  вставляется в SYSTEM через конкатенацию) и функции `formatParticipantsForPrompt`
  (форматирует список участников для вставки) и интерфейс `AiParticipantContext`.
  Сам файл не является SYSTEM-промптом. Список участников подмешивается **в user-блок** промпта
  (через `formatParticipantsForPrompt`) — это уже правильная практика с точки зрения F1.
- **Применимые измерения:** A4 (нота «не угадывай userId по созвучию ASR» — усилить явно);
  F1 (список участников — в user, это уже реализовано; текст `PARTICIPANT_IDENTIFICATION_RULES` —
  в SYSTEM, стабилен, cache-friendly).
- **Код-сверка:**
  - `PARTICIPANT_IDENTIFICATION_RULES` — текстовая константа, вставляется в SYSTEM каллерами
    (`tasks-v2`, `tasks-unified`, `tasks-structured`).
  - `formatParticipantsForPrompt` возвращает строку вида
    `- "Анна Иванова" (userId=user_abc, role=host)` — идёт в **user**, не SYSTEM. ✓ cache-friendly.
  - Текущий текст уже содержит правило «не выдумывай чужие userId», но ASR-угрозу
    («Серёжа» → «Сергей») называет только в комментарии к `fullName`, а в runtime-тексте —
    нет явной фразы про ASR-созвучие. Добавим.
  - Нет обёрток guard/ASR на call-site в самом файле — они добавляются воркерами-каллерами
    (`analyze.worker`, `TaskExtractionService`, `MeetingExtractActionsService`).
  - Замечание о гостях и vNext-плане матчинга по email зафиксировано только в JSDoc.

#### БЫЛО (`PARTICIPANT_IDENTIFICATION_RULES` — текущий текст)

```
Правила идентификации исполнителя:
- Если в речи прозвучало имя, точно совпадающее с участником из списка с непустым userId,
  в поле "assigneeUserId" верни ИМЕННО этот userId (не выдумывай чужие).
- Если совпадений >1 (например, два «Сергея» в списке) или имя — это роль/команда
  («маркетинг», «продажи») — assigneeUserId = null.
- Если исполнитель — гость (userId=null в списке) — assigneeUserId = null,
  оставляй только assigneeRaw.
- assigneeRaw возвращай ВСЕГДА — это исходная фраза из транскрипта
  (для UI fallback и аудита).
```

#### СТАЛО (`PARTICIPANT_IDENTIFICATION_RULES` — усиленный текст)

```
Правила идентификации исполнителя:
- Сопоставляй имя исполнителя СТРОГО по списку участников ниже. Используй точное
  совпадение или однозначное созвучие полного имени (displayName/fullName). Не угадывай
  userId по созвучию в распознавании речи (ASR): «Серёж» ≠ «Сергей Петров», если в
  списке есть «Сергей Петров» и «Сергей Иванов» одновременно — assigneeUserId = null.
- Если имя точно совпадает с участником из списка, у которого непустой userId — верни
  ИМЕННО этот userId в поле "assigneeUserId". Не выдумывай и не переиспользуй чужие userId.
- Если совпадений >1 (например, два «Сергея» в списке), имя неоднозначно или это
  роль/команда («маркетинг», «продажи», «разработка») — assigneeUserId = null.
- Если исполнитель — гость (userId=null в списке) — assigneeUserId = null,
  оставляй только assigneeRaw.
- assigneeRaw возвращай ВСЕГДА — это исходная фраза из транскрипта, как прозвучало
  (для UI fallback и аудита). Не нормализуй и не «улучшай» эту фразу.
- Список участников — в конце user-сообщения (блок «Участники встречи»).
```

#### USER — не меняется

Форматирование списка через `formatParticipantsForPrompt` уже правильное и cache-friendly
(список идёт в user, а не в SYSTEM). Рекомендация: убедиться, что во всех каллерах список
подаётся явным блоком в **конце** user-сообщения (после транскрипта), — это уже так по коду.

#### ИЗМЕНЕНИЕ КОНТРАКТА

Нет — `PARTICIPANT_IDENTIFICATION_RULES` остаётся строковой константой, `AiParticipantContext`
и `formatParticipantsForPrompt` не меняются.

#### Что изменили

Добавлена явная нота про ASR-угрозу (A4): «не угадывай userId по созвучию распознавания речи»
с примером «Серёж» ≠ «Сергей Петров». Уточнено: `assigneeRaw` не нормализуется. Добавлена
ссылка на расположение списка («в конце user-сообщения»), чтобы у LLM не было неоднозначности.

---

### `sanitize-custom-prompt` / `FORBIDDEN_PATTERNS` — E2-слой санитайз пользовательского промпта

- **Файл:** `backend/src/modules/ai/services/prompts/sanitize-custom-prompt.ts`
- **Контракт:** helper — чистая функция `sanitizeCustomPrompt(raw): SanitizeResult`.
  Возвращает `{ cleaned: string; rejected: false; reasons: string[] }`. Не является SYSTEM-промптом.
  Метрику `z_prompt_injection_attempt_total` инкрементирует caller.
- **Применимые измерения:** I2 (расширить шаблоны: рус. «действуй как» / «новая инструкция» /
  «сыграй роль» / code-fence-инъекции / XML role-маркеры).
- **Код-сверка:**
  - Текущие 6 паттернов: `ignore_prev` (en) · `ignore_prev_ru` (рус. «игнорируй») ·
    `forget_prev_ru` (рус. «забудь») · `system_prefix` (`system:`) · `chatml_tokens` (`<|im_start|>`) ·
    `bracket_system` (`[[system]]`).
  - **Пробелы:**
    1. Нет паттернов на «действуй как» / «ты теперь» / «притворись» — типовые рус./en role-jacking.
    2. Нет паттернов на «новая инструкция» / «следующая инструкция» / «важное обновление» —
       типовые русские prompt-injection фразы.
    3. Нет паттернов на code-fence-инъекции (` ```system `) — скрытие инструкций в блоке кода.
    4. Нет паттернов на XML role-маркеры (`<system>`, `<|system|>`, `<SYSTEM>`) — нестандартные,
       но реальные векторы.
  - `rejected: false` — зарезервировано; не меняем.
  - Идентификаторы паттернов — стабильные ключи Grafana-алёрта; новые добавляются с уникальными id.
  - Структурный слой (`wrapUserData` / `INJECTION_GUARD_NOTE`) — основная защита; данная функция
    является дополнительным наблюдательным слоем (observability).

#### БЫЛО (6 паттернов)

```
ignore_prev   — /ignore\s+(?:all\s+)?(?:previous|prior|above)/i
ignore_prev_ru — /игнорируй(?:те)?\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние|инструкции|правила)/i
forget_prev_ru — /забудь\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние)/i
system_prefix  — /(?:^|\n)\s*system\s*:/i
chatml_tokens  — /<\|im_start\|>|<\|im_end\|>/
bracket_system — /\[\[\s*system\s*\]\]/i
```

#### СТАЛО (10 паттернов — добавлено 4)

```ts
export const FORBIDDEN_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly regex: RegExp;
}> = [
  // --- существующие 6 паттернов (не изменяются) ---
  { id: 'ignore_prev',     regex: /ignore\s+(?:all\s+)?(?:previous|prior|above)/i },
  { id: 'ignore_prev_ru',  regex: /игнорируй(?:те)?\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние|инструкции|правила)/i },
  { id: 'forget_prev_ru',  regex: /забудь\s+(?:все\s+|всё\s+)?(?:предыдущие|прошлые|прежние)/i },
  { id: 'system_prefix',   regex: /(?:^|\n)\s*system\s*:/i },
  { id: 'chatml_tokens',   regex: /<\|im_start\|>|<\|im_end\|>/ },
  { id: 'bracket_system',  regex: /\[\[\s*system\s*\]\]/i },

  // --- НОВЫЕ паттерны (I2: role-jacking, новые инструкции, code-fence, XML) ---

  // Role-jacking: «ты теперь», «действуй как», «притворись», «сыграй роль» (рус.)
  // и «you are now», «act as», «pretend to be», «roleplay as» (en)
  {
    id: 'role_jacking',
    regex: /(?:ты\s+теперь|действуй\s+как|притворись|сыграй\s+роль|you\s+are\s+now|act\s+as\s+(?:a|an|the)\s+\w|pretend\s+to\s+be|roleplay\s+as)/i,
  },

  // Новая инструкция: «новая инструкция», «следующая инструкция», «важное обновление системы» (рус.)
  {
    id: 'new_instruction_ru',
    regex: /(?:новая\s+инструкция|следующая\s+инструкция|важное\s+(?:системное\s+)?обновление|системная\s+(?:команда|инструкция))/i,
  },

  // Code-fence-инъекция: открывающий тик-блок с ключевым словом system/prompt/instruction
  // Скрывает инструкции внутри блока кода: ```system\n...```
  {
    id: 'code_fence_inject',
    regex: /```\s*(?:system|prompt|instruction|role)/i,
  },

  // XML role-маркеры: <system>, <|system|>, <SYSTEM>, </system>, <role>, </role>
  {
    id: 'xml_role_tag',
    regex: /<\/?\s*(?:system|role)\s*>|<\|system\|>/i,
  },
];
```

**Итого: 10 паттернов.** Новые id (`role_jacking`, `new_instruction_ru`, `code_fence_inject`,
`xml_role_tag`) — уникальны и стабильны для Grafana-метрики.

#### USER — не применимо (runtime-функция, не SYSTEM-промпт)

#### ИЗМЕНЕНИЕ КОНТРАКТА

Нет — сигнатура `sanitizeCustomPrompt(raw): SanitizeResult` и структура `SanitizeResult`
не меняются. Поле `reasons: string[]` будет возвращать до 4 новых id помимо существующих 6.
Тип `SanitizeResult.reasons` — `string[]`, новые id автоматически входят в массив.

Если Grafana-дашборд использует `FORBIDDEN_PATTERNS.map(p => p.id)` для инициализации label-set —
добавить туда 4 новых id: `role_jacking`, `new_instruction_ru`, `code_fence_inject`, `xml_role_tag`.

#### Что изменили

Добавлены 4 паттерна (I2):
1. **`role_jacking`** — рус./en role-jacking («ты теперь», «действуй как», «act as»,
   «pretend to be») — наиболее распространённый вектор смены роли.
2. **`new_instruction_ru`** — рус. фразы «новая инструкция» / «системная команда» /
   «важное обновление» — типовые «доверенные обновления» через инжектированный текст.
3. **`code_fence_inject`** — скрытие инструкций в code-fence (` ```system `):
   LLM иногда выполняет блок как привилегированный контекст.
4. **`xml_role_tag`** — XML role-маркеры (`<system>`, `<role>`, `<|system|>`):
   используются в нестандартных форматах ряда моделей.

Все новые паттерны — аддитивны; `rejected: false` сохранён; идентификаторы стабильны для алёртинга.

---

## Итог батча 90

| # | Helper | Тип | Изменение контракта | Ключевые измерения |
|---|---|---|---|---|
| 1 | `glossary` / `withGlossary` | SYSTEM-helper (конкатенация) | нет (`GlossaryTerm` расширяется, additive) | A1/I4: новый ключ `process_discriminator` |
| 2 | `participant-context` / `PARTICIPANT_IDENTIFICATION_RULES` | SYSTEM-константа | нет | A4: явная ASR-нота + «assigneeRaw не нормализовать» |
| 3 | `sanitize-custom-prompt` / `FORBIDDEN_PATTERNS` | runtime-функция (observability) | нет (reasons additive) | I2: +4 паттерна (role-jacking, новые инструкции, code-fence, XML) |

**Все три хелпера — аддитивные изменения.** Ни один существующий вызов не ломается.
