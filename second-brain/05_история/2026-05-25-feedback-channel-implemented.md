---
title: Канал «Ваши предложения» — реализация end-to-end за одну сессию
date: 2026-05-25
distilled: false
---

# Канал обратной связи с AI-кластеризацией — реализован и проверен e2e

## Что было поставлено

Сделать новый канал «Ваши предложения»:
- пользовательская вкладка в сайдбаре с формой и историей (лимит 5 в сутки),
- ночной AI-агент (cron 01:00 UTC), который кластеризует сырые сообщения в смысловые блоки (новый блок если ни один существующий не подходит),
- super-admin дашборд `/admin/feedback` с фильтрами 30/90/all, drill-down по items с автором/датой, действиями rename/merge/archive/unarchive + ручной запуск обработки,
- prom-метрики + second-brain + e2e на реальном LLM.

Источник правды: [plans/tz/2026-05-25-user-feedback-with-ai-clustering.md](../../plans/tz/2026-05-25-user-feedback-with-ai-clustering.md).

## Как решал

В роли оркестратора, спавнил sub-агентов параллельно по фазам, каждый раз верифицируя их работу Grep'ом до коммита.

**Коммиты:**
- `181f1b2` Фаза 1 — каркас модуля + Prisma-модели.
- `5931406` Фазы 2 + 4 — пользовательские эндпоинты + промпт + LLM-router.
- `cc9b666` Фазы 3 + 6 — frontend пользовательский + admin backend.
- `1eda169` Фазы 5 + 7 — digest worker (cron 01:00 UTC) + admin dashboard.
- Фазы 8 + 9 захватила параллельная сессия в свой `c2772b6` — диалоги rename/merge/archive + prom-метрики + 9 файлов second-brain. Код корректен, атрибуция в логе спутана.
- `b2d0611` финальный — e2e скрипт + sanity-check fix + 4 чужих бага, блокировавших бутстрап.

**E2E на DeepSeek V4 Pro:** [backend/scripts/e2e-feedback-clustering.ts](../../backend/scripts/e2e-feedback-clustering.ts) — 10 юзеров, 2 итерации. Итерация 1 (18 сообщений на пустой БД) → 11 блоков + 1 discard. Итерация 2 (+14) → 5 новых блоков, 9 сообщений правильно отнесены в существующие. Конкретные блоки см. в коммите `b2d0611`.

## Что вышло

- Backend: 80 unit-тестов, 5 spec-файлов.
- Frontend: 39 unit-тестов (8 пользовательских мапперов + 22 админских + 9 диалогов).
- `bunx tsc --noEmit` чисто на backend и frontend.
- E2E на реальном DeepSeek V4 Pro: оба прогона succeed, агент корректно группировал темы (тёмная тема, экспорт, благодарности дашборду, Telegram, мобилка, PDF...), discard'ы для мусора, на 2-й итерации переиспользовал существующие блоки.

## Чему научился

1. **Параллельные сессии Claude Code пушат `git add -A` и захватывают чужие незакоммиченные правки.** За сессию это произошло трижды: схема Prisma (мои feedback-модели попали в коммит kc-temporal), `llm-router.service.ts`, прометей-метрики + диалоги + 9 second-brain файлов. Решения:
   - перед каждой волной — `git log --since=N` для понимания фронта (это уже было в [feedback_parallel_sessions_git_check](../../C:\Users\USER\.claude\projects\c--work-z\memory\feedback_parallel_sessions_git_check.md));
   - **новое правило:** если в работе чужой файл (особенно `schema.prisma`, `business-metrics.service.ts`, `llm-router.service.ts`), стейджить только свои хунки через filtered patch — иначе чужие правки в индексе уйдут в твой коммит, или твои уйдут в чужой. Сохранять как memory-правило не буду, потому что это уже фиксировалось — но в `02_architecture/code-pitfalls.md` стоит закрепить.
2. **Sanity-check «слишком много новых блоков» нужно отключать на холодном старте.** Когда `existingTopics` пуст, агент по определению создаёт блок под каждую тему — это не аномалия, а единственно правильное поведение. Порог `topics.length >= 5` решил. Это всплыло только на e2e — никаким unit-тестом такое не ловится.
3. **`bunx tsc --noEmit` зелёный ≠ бутстрап работает.** Параллельная сессия закоммитила код с двумя пропущенными DI-регистрациями (`MaxApiClient` в exports `ConversationalModule`, `SimilarIssuesService` в providers `TrackerModule`) — tsc этого не видит (типы есть, импорты правильные), а Nest падает в рантайме при `NestFactory.createApplicationContext(AppModule)`. Без e2e-прогона эти баги дошли бы до прода. Урок: на любую крупную фичу — обязателен e2e-бутстрап AppModule, не только unit-тесты модуля.
4. **Seed-скрипты в репо до Prisma 7 апгрейда — потенциально все сломаны.** Я нашёл два (`seed-default-llm-providers-and-models`, `seed-llm-task-routes-feedback-cluster`) с `new PrismaClient()` без `@prisma/adapter-pg`. Скрипт молча падает с диким стек-трейсом про «non-empty options». Стоит сделать массовый patch на все `backend/scripts/seed-*.ts` — но в этой сессии не делал, чтобы не лезть в чужие.
5. **Sub-агенты иногда лгут про правки.** Phase 3 агент уверенно отчитался про добавление пункта в sidebar — `Grep` показал, что правки не было. Сам добавил. Подтверждает memory-правило [feedback_agents_can_lie_about_edits](../../C:\Users\USER\.claude\projects\c--work-z\memory\feedback_agents_can_lie_about_edits.md) — после каждого агента грепать ключевые маркеры в файлах до commit.
6. **DeepSeek V4 Pro иногда возвращает обрезанный JSON** даже при `max_tokens=8000` и `response_format=json_object`. На первой попытке в первой итерации был JSON parse error «Expected ']'» (модель упёрлась в лимит токенов с 6307 output на 2252 input). Retry с приписанным «верни строго JSON по схеме» помог + DeepSeek кэшировал prompt (cachedTokens=2176). Логика двух попыток оказалась оправданной.
