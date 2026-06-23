---
date: 2026-06-23
type: рефлексия
feature: unified-task-extraction
branch: feature/unified-task-extraction
---

# Рефлексия — унификация извлечения задач на общий спайн (оркестрация ТЗ)

## Что было поставлено

Реализовать ТЗ `plans/tz/2026-06-23-unified-task-extraction.md` (strangler-fig, 4 фазы) силами оркестратора+суб-агентов. По ходу владелец добавил два требования: (1) обязательно «прям хорошие» сквозные тесты изменённой цепочки; (2) вкатить сюда же фикс из ТЗ `2026-06-23-chatbox-analysis-no-stuck-sessions.md` (ночью chatbox-анализ не отработал → задачи/решения из чатов не извлеклись). Финал — коммит и push в новую ветку.

## Как решал (фазы и коммиты)

- `chore(tests)` `122d2655` — синхронизация 3 предсуществующих stale-снапшотов промптов (goal-hierarchy-link/goal-task-link/insight-link-to-decisions) + мок `specialistsCombined` в router-fallback spec. Доказанно предсуществующий дрейф на dev, вынесен отдельно от фичи.
- **Ф1** `72249ebe` — `SignalType=action_item` (миграция) + спайн-специалист `3-15-tasks` (`Specialist315TasksWorker`+`Service`, клон 3-14-goals): не-meeting IdeaBlock(action_item) → LLM `task-extract` → `IntakeIssue` → auto-triage → `Issue`. RouterService case + PRIORITY 3.9 (не в COMBINED_COVERED). Kill-switch `tracker.taskExtractionMode` (spine|legacy). Bypass legacy chatbox-task-extraction при spine. Гард meeting/meeting_report (встречи — отдельный зрелый экстрактор, Б-1).
- **Ф2** `ee6ef1fa` — единый резолвер: substring-резолверы telegram-task-parser + intake-auto-triage удалены → `tracker/AssigneeResolverService.resolve(tenantId, name)` (4-tier + склонения + память + collective). Встречи оставлены на participant-identity матчере `TaskAssigneeResolverService` (не дубль fuzzy — ограниченный набор участников; решение проектировщика против регресса).
- **Ф3** `658b3194` — единый дедуп: общая cosine+judgeSame вынесена в DI-free util `task-dedup-matcher.util.ts`; GRAY_BAND→AdminSetting. Спайн LINK-семантика: дедуп против открытых Issue (LLM вне локов), на 'same' линк через `TaskSource{issueId}` без дубля; race guard `pg_advisory_xact_lock(tenant+normTitle)` + in-lock exact-title/pending-IntakeIssue re-check. Миграция `TaskSource.issueId` (+ taskId nullable). autoAccept пишет провенанс-TaskSource.
- **Ф4** `3dbd2627` — `Task` как явный пред-слой (не дропаем, Р-1); промоут Task→Issue в `triageChatboxTask` теперь пишет `TaskSource{issueId}`; однонаправленный, идемпотентный.
- **chatbox-no-stuck** `e17a3cf6` — incrementalSync зовёт `enqueuePendingAnalysisIfEnabled` (гарантия A); sweep → `EVERY_10_MINUTES` + подбор зависших `analyzing` (гарантия C); AdminSetting `chatbox.analyze.stuckAnalyzingMin` + gauge `z_chatbox_stuck_analyzing_sessions`.
- **chain-test** `764bd39c` — `test/integration/task-extraction-chain.spec.ts`: 8 сценариев на stateful in-memory Prisma + реальные спайн-сервисы.

## Что вышло (верификация)

- typecheck (вкл .spec) 0 ошибок; build 0 ошибок; финальная регрессия — **783 теста зелёные** в 87 spec-файлах.
- Единственный красный — предсуществующий `telegram-webhooks.controller.spec.ts > update_id=42`: доказано (git stash + checkout dev), что он падает идентично на чистом dev. НЕ моя регрессия. Вынесен в `04_не-сделано`.
- Тулчейн поднимался с нуля (bun отсутствовал, node_modules не было, prisma client не сгенерирован).

## Чему научился (для code-pitfalls / будущих сессий)

1. **Локальный тулчейн на этой машине надо ставить руками:** `npm i -g bun` → `bun install` (в `backend/`), `bun run prisma:generate`. `tsc` (typecheck/build) **падает OOM (SIGABRT/exit 134) при дефолтном heap** — обязателен `NODE_OPTIONS=--max-old-space-size=8192`. Базовый typecheck dev был зелёным с 8 ГБ.
2. **Нет локальных Postgres/Redis и `.env`** → миграции писать руками (`ALTER TYPE ... ADD VALUE`, raw SQL), тесты только детерминированные с моками Prisma/LLM/Redis. `prisma migrate dev` недоступен.
3. **vexp-хук «нейтрализует» grep/awk** (вывод заменяется на `ln`/пустоту), из-за чего ранняя картография ошибочно сочла инъекцию `TaskAssigneeResolverService` в `meeting-extract-actions` «мёртвой». Перепроверка через `Read` показала реальный вызов на строке 326 — едва не снёс рабочий код. **Урок: факты из grep при живом vexp-хуке перепроверять Read'ом.**
4. **Спайн-режим (default) bypass'ит `cross-source-task-dedupe`** — он живёт в legacy chatbox-пути. Поэтому «единый дедуп» для чат-задач должен жить на пути создания Issue (спайн-специалист/autoAccept), а не в legacy-сервисе. ТЗ писалось в модели legacy-Task; реальность спайна сместила точку дедупа.
5. **Advisory-lock нельзя держать через LLM-вызов** (embed+арбитр = секунды → starvation пула). Паттерн: семантический дедуп вне лока, в локе только быстрый exact-title/pending re-check + create.
6. **Предсуществующие красные тесты на dev** (3 stale-снапшота + router-fallback мок + telegram update_id=42) — отделять от своей работы (отдельный chore-коммит / строка в 04_не-сделано), не «закрашивать» и не приписывать своей фиче.
7. **Не плодить unused-крутилки:** `sweepIntervalMin` не вводил — в кодовой базе нет динамического крона (единственный `tracker.progressAutoDraftCron` — defined-but-unused), это «склад забытого» по Ship-On. Кадэнс фиксированный 10 мин.

## Решения проектировщика (зафиксированы в §12 ТЗ)

- `TaskAssigneeResolverService` оставлен как participant-резолвер встреч (не «4 резолвера → 1 буквально», а «1 fuzzy для текста + 1 identity для ограниченных наборов»; удалены два кустарных substring).
- chatbox-резолв (responsibleExternalId) не трогаем — это identity-канал.
- `sweepIntervalMin` сознательно не добавлен (см. урок 7).
- Полное слияние meeting-extract-actions в спайн, дроп `Task`, динамический крон, 2 LOW-остатка дедупа — vNext (строки в `04_не-сделано`).
