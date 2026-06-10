# Telegram-вход: согласованный интент-классификатор обходится «ботом для задач»

> Дата: 2026-06-10. Аналитика (код + ТЗ), без правок кода. Триггер — владелец: «голос „сегодня в планах…“ стал одной задачей; я согласовывал большой промпт-классификатор — где он?».

## Вывод одной строкой

Большой интент-классификатор **существует, корректен и подключён**, но на входе Telegram **не получает управление**: более ранняя ветка «бот для задач» (`taskHandler.tryHandle`) превращает ЛЮБОЙ непустой голос/текст в `IntakeIssue` и выходит из `ingestUpdate` **до** вызова классификатора. Плюс в самом промпте классификатора **нет категории «задача»**.

## Факты по коду

### Классификатор (есть, полный)
- Сервис: [`dialog-layer/services/query-classifier.service.ts`](../../backend/src/modules/dialog-layer/services/query-classifier.service.ts) — `QueryClassifierService.classify()`.
- Промпт (~120 строк, «большой согласованный»): [`dialog-layer/prompts/classify.prompt.ts`](../../backend/src/modules/dialog-layer/prompts/classify.prompt.ts) → `DIALOG_CLASSIFY_SYSTEM_PROMPT`.
- **7 категорий:** `factual` / `exploratory` / `analytical` / `clone_roleplay` (вопросы к AI-чату) · `daily_plan_morning` (план/чек-ин утро) · `daily_report_evening` (отчёт/чек-ин вечер) · `note` (заметка). Есть блок «ВАЖНЫЕ ЛОВУШКИ — НЕ ПУТАЙ» + confidence-gate (план/отчёт <0.7 → note).
- taskType `dialog-classify` зарегистрирован (`llm-router.service.ts` union + `ALL_LLM_TASK_TYPES`), strict JSON Schema. Точка вызова: `telegram-bot.adapter.ts:537` `classifyIntent(...)`, флаг `BOT_INTENT_CLASSIFIER_ENABLED` (default ON).
- ⚠️ Категории «задача/поручение/IntakeIssue» в промпте **НЕТ** — классификатор её распознавать не умеет.

### Обход (task-handler раньше классификатора)
- Текст: [`telegram-bot.adapter.ts:526-534`](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot.adapter.ts#L526) — `taskHandler.tryHandle(...)` → `if (handled) return null;` (до `classifyIntent` на :537).
- Голос: `telegram-bot.adapter.ts:377-385` — то же перед `handleVoice` (ASR → classify).
- `tryHandle` ([`telegram-bot-message.handler.ts:127-161`](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-bot-message.handler.ts#L127)): voice (`:127-150`) и text (`:152-161`) → `parseCreateTask` → `return true`. Гейта «это задача?» внутри нет; `false` только для reply-без-issue / reply `unknown` / пустого сообщения.
- Гейт: task-handler только через `@Optional()` DI — в проде всегда зарегистрирован; voice-ветка дополнительно требует `cfg.bot.voiceEnabled`. Отдельного «бот задач вкл/выкл» флага нет.
- Комментарии в коде (`handler:32-44`, `adapter:525`) обещают fall-through к classify «если не задача» — фактически для голоса/текста он недостижим.

## Корень

Конфликт двух фич, не состыкованных:
- Классификатор — ТЗ [`plans/tz/2026-05-29-telegram-self-initiated-checkins.md`](../../plans/tz/2026-05-29-telegram-self-initiated-checkins.md) (rev3, согласован владельцем 2026-05-29): «классификация „план/отчёт/вопрос/заметка“ через LLM», расширили `QueryClassifierService`.
- Бот для задач — ТЗ [`plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md`](../../plans/tz/2026-05-23-tracker-phase-4-rf-musthave.md) (Wave 3, 2026-05-24): «фраза/голос в личке → задача», БЕЗ гейта намерения. Реализован буквально «всё → задача» и вызывается раньше.

## Что доделать (для ТЗ; без кода здесь)

1. **Единый гейт намерения ПЕРЕД созданием задачи.** Вызывать классификатор первым; в задачу пускать только при intent=«задача».
2. **Добавить категорию «задача/поручение»** в `DIALOG_CLASSIFY_SYSTEM_PROMPT` (8-я категория) + в JSON Schema + маппинг. Тогда: задача → task-handler (`parseCreateTask`), план/отчёт → чек-ин (`daily_checkin_self`), вопрос → AI-чат (`chat_query`), заметка → `free_note`.
3. `tryHandle` оставить исполнителем для уже распознанного intent=task + спецслучаи reply/forward.
4. При «планах» из нескольких дел — решить: разбивать на несколько задач или класть как чек-ин (продуктовая развилка владельца).
5. Поправить вводящие в заблуждение комментарии.

> Совместимость с prompt caching: добавление категории меняет SYSTEM `dialog-classify` — это ломает кэш один раз (приемлемо, разовое). Держать новый SYSTEM стабильным далее.
