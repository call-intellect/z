---
type: reflection
date: 2026-05-30
feature: telegram-self-initiated-checkins
commits:
  - 463260d (Phases 1-7)
---

# Рефлексия — Telegram self-initiated checkins

## Что было поставлено

ТЗ `plans/tz/2026-05-29-telegram-self-initiated-checkins.md` (rev3) — 7 фаз.
Сотрудник пишет боту план дня или итоги дня в свободной форме → запись попадает
в тот же `DailyCheckIn` и тот же дашборд руководителя, что и ответ на cron-prompt.

## Как решал

- **Phase 1 — LLM-классификатор.** Расширил `DialogIntent` enum на 3 категории
  (`daily_plan_morning/daily_report_evening/note`). Скопировал SYSTEM-промпт и
  JSON Schema из Приложения А ТЗ дословно (важно для prompt cache). Добавил
  `skipHeuristicFirstPass` параметр + alias-маппинг для коротких форм LLM
  (`plan` → `daily_plan_morning`). Fallback-эвристика `checkinFallbackHeuristic`
  ловит 5+5 триггеров в первых 30 символах.

- **Phase 2 — Адаптер бота.** Confidence-gate ≥0.7 для plan/report; ниже — fall
  through в free_note. Голос (ASR) автоматически работает — `handleVoice` уже
  звал тот же `classifyIntent`.

- **Phase 3 — Prisma.** Поле `source DailyCheckInSource @default(cron_prompted)`
  на `DailyCheckIn`, `bun run prisma:push` без `--accept-data-loss`. Прокинул
  через `upsertFromParser/upsertInternal/createOrUpsertManual/createPromptPlaceholder`.
  Patch-скрипт `patch-daily-checkin-backfill-source.ts` через
  `createPrismaClient()`.

- **Phase 4 — Handler.** Новый метод `processSelfInitiated()` симметричен
  cron-handler'у: парсит, upsert'ит (всегда, lowConfidence → curatorReview=true),
  закрывает pending notification через `markAsAnsweredByCheckin` (БЕЗ эмиссии
  `notification.responded` — иначе зациклит cron-handler). Подписка на inbound
  через `onModuleInit → conversational.subscribeInbound`.

- **Phase 5 — checkin.ack.** Payload schema + 4 шаблона `formatCheckinAck` с
  корректной русской pluralize (1 пункт / 2 пункта / 5 пунктов). Default policy
  `['telegram_bot', 'max_bot', 'in_app']`; caller перебивает через
  `preferredChannelKinds=[originChannelKind]`.

- **Phase 6 — Frontend.** Значок 🌅/✋/🖊 в `/me/check-ins`. ApiDto +source.

- **Phase 7 — Docs.** SMOKE.md 8 сценариев + verify prompt cache SQL.
  Обновлены telegram-user-flows.md, conversational-channels.md, prod-deploy-log.md.

## Что вышло

- **Build/typecheck/lint зелёные** в backend и frontend (одна pre-existing
  baseline-ошибка в `referrals/attribution.service.spec.ts` — не моя).
- **304 теста pass** (41 файл) в dialog-layer/conversational/operations.
  Из них 18 новых.
- **Commit 463260d**, push в origin/dev успешен.

## Чему научился

1. **Параллельные агенты на одном репозитории — git stash хуже,
   чем последовательная работа.** Запустил два агента на Phase 2 и Phase 3
   параллельно; они каждый сделали `git stash` для проверки baseline'а и в
   процессе перетёрли друг другу промежуточные правки и спецы. Phase 2 агент
   честно об этом написал и восстановил. Phase 3 агент тоже отметил
   «системный rollback». **Урок:** для следующих задач — последовательно, или
   агенты должны работать в worktree (isolation='worktree'). Сэкономленное на
   параллели время не стоит ручной возни с восстановлением spec'ов.

2. **ТЗ-рекомендация по путям файлов — не догма.** ТЗ предписал
   `checkin-fallback-triggers.ts` положить в `conversational/adapters/telegram-bot/`.
   Это вводит circular import (dialog-layer импортит conversational, который
   импортит dialog-layer). Перенёс файл в `dialog-layer/services/` и в
   header'е оставил пояснение причины. **Урок:** проверять граф зависимостей
   ДО создания файла.

3. **Golden-accuracy тест с реальным LLM в CI — нерационально.** 120 фикстур
   × LLM-вызов = $0.10 и flaky. Сделал сплит: structure-validation тест
   (always-on, валидирует JSON-фикстуру) + accuracy gate (ENV-флаг
   `CLASSIFY_ACCURACY_EVAL=1`, запускается руками перед релизом).
   В отчёте это явно отмечено как открытый вопрос.

4. **`narrowToChatIntent` helper решает мост между расширенным enum и
   legacy-consumer'ами.** Расширение `DialogIntent` сломало 2 call-site
   (chat-v2, clones). Минимальная инвазивная правка — helper, который
   маппит 3 новых intent'а в 'factual' (безопасный дефолт, никогда не
   доходит до chat-v2 в реальности — bot-adapter перехватывает раньше).

## Открытое

- **Accuracy gate** на 120 фикстурах надо реально прогнать перед прод-релизом.
  Раннер `CLASSIFY_ACCURACY_EVAL=1` пока stub (TODO: вызывает классификатор
  через nest test context). Не вошёл в первую итерацию.
- **Prompt cache verification** — SQL в SMOKE.md, надо смотреть через 10+
  вызовов на проде.
