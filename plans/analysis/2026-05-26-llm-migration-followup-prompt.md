---
status: prompt-for-agent
created: 2026-05-26
type: discovery-task
purpose: Промпт для нового агента — проанализировать 5 отложенных задач после миграции LLM на DeepSeek-V4-Pro и написать ТЗ
---

# Промпт для агента: discovery + ТЗ по 5 отложенным задачам после миграции LLM на DeepSeek-V4-Pro

> Этот файл — задание новому агенту в отдельной сессии. Он должен прочитать его целиком, изучить указанные источники, написать 5 ТЗ. Если что-то непонятно — задавать уточняющие вопросы пользователю до начала работы (а не делать предположения).

---

## Контекст: что произошло в сессии 2026-05-25/26

В одну сессию была применена ТЗ-копилка `plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md` — миграция всех LLM-агентов проекта Z на DeepSeek-V4-Pro. Сделано 8 коммитов (`5921a20`..`cad4aef` + docs `8de57ee`, `d608968`), ~9 700 строк кода + тестов.

**Все 8 коммитов уже в `origin/dev`. Push сделан.** Прод-инструкция в рефлексии: `second-brain/05_история/2026-05-26-llm-migration-deepseek-pro-wave.md`.

### Какие фазы закрыты:

- Фаза 0 — карта AI-агентов `second-brain/02_architecture/ai-agents-map.md`
- Фаза 1 — §4 фикс формата для thinking-моделей (helper `isThinkingModel`, автоконверт `json_schema → tools`)
- Фаза 2 — §6 operations (`CheckinSentimentBatchCron` batch 10) + §8 skill-trait-detect verify
- Фаза 3 — §10 Find 1 аудит `maxTokens` (executable-persona 8000, role-profile 16000, и т.д.)
- Фаза 4 — §2 chat-v2 + dialog-layer + 19 одиночек на DeepSeek-V4-Pro primary
- Фаза 5 — §1 meeting-report-fast verified (параллельная сессия закрыла раньше)
- Фаза 6 — §3 SpecialistsCombined (Б+, новый сервис под флагом `SPECIALISTS_COMBINED_ENABLED`)
- Фаза 7 — §9 clone-respond v2 (модель `CloneAccessGrant`, dialog-layer integration, factual/judgmental, под флагом `CLONE_V2_ENABLED`)
- Фаза 8 — §10 Find 2 вынос 5 embedded-промптов в `prompts/*.prompt.ts`

### Источники правды для контекста (читать первыми)

1. **Главный ТЗ-документ:** [plans/tz/2026-05-25-llm-architecture-changes-from-experiments.md](../tz/2026-05-25-llm-architecture-changes-from-experiments.md) — особенно §1, §3, §9 целиком
2. **Рефлексия сессии:** [second-brain/05_история/2026-05-26-llm-migration-deepseek-pro-wave.md](../../second-brain/05_история/2026-05-26-llm-migration-deepseek-pro-wave.md)
3. **Карта AI-агентов:** [second-brain/02_architecture/ai-agents-map.md](../../second-brain/02_architecture/ai-agents-map.md)
4. **CLAUDE.md в корне** — правила проекта
5. **Запустить:** `git log origin/dev --oneline -30` чтобы увидеть всю недавнюю историю

---

## Твоя задача: написать 5 ТЗ

Для каждой из 5 отложенных задач — написать ТЗ-документ в `plans/tz/YYYY-MM-DD-<название>.md`. Сначала **discovery** (изучение текущего состояния), потом написание ТЗ.

**Если по любой задаче что-то непонятно — ЗАДАЙ УТОЧНЯЮЩИЕ ВОПРОСЫ пользователю.** Лучше один раз спросить чем сделать неправильно. Не выдумывай решения — пользователь готов уточнить.

---

## Задача 1 — Фаза 9 §9.10: Исторические клоны должности

### Цель

Когда сотрудник увольняется или меняет должность — его клон-снимок должности **сохраняется** как версия для этой роли. В маркетплейсе помечается «Прошлый владелец роли». Это даёт преемственность знаний + институциональную память.

### Что уже есть (контекст)

- Клоны теперь **ролевые**, не персональные (рефакторинг Clones-Roles Ф1-Ф6 сделан раньше). Документ-источник: `plans/tz/2026-05-25-clones-role-based-rebrand.md`.
- В `ExecutablePersona` есть поля `roleVersion`, `currentBearerPersonId`, `publicName`, `succeedsPersonaId` — версионирование при смене bearer'а.
- `SkillProfile.status` enum уже существует (поле есть).
- Event `role.bearer_changed` — есть слушатель `RoleClonePersonaVersioningHandler` (создан параллельной сессией в Clones-Roles Ф2 `6a15b88`).
- Cron `ExecutablePersonaBuildCron` (`0 6 * * SUN`) — нужно проверить, фильтрует ли archived.

### Что изучить (discovery)

1. **`backend/prisma/schema.prisma`** — какие сейчас статусы у `Person`, `SkillProfile`, `ExecutablePersona`. Есть ли `Person.status`? Полное состояние перечислений (enum).
2. **`backend/src/modules/knowledge-core/services/role-clone-persona-versioning.handler.ts`** — текущая логика при `role.bearer_changed`. Что происходит с предыдущей persona?
3. **`backend/src/modules/knowledge-core/workers/executable-persona-build.cron.ts`** — фильтрует ли archived/inactive профили?
4. **`backend/src/modules/appointments/services/appointments.service.ts`** — где эмитится `role.bearer_changed`? Какие сценарии (увольнение vs трансфер vs выход на пенсию)?
5. **`second-brain/01_projects/skill-and-clone.md`** — где описана ролевая модель.
6. **§9.10 ТЗ-копилки** — целевая архитектура: маркетплейс с фильтром «active» / чекбокс «показать предыдущих», карточка архивного клона с тегом «Предыдущий владелец роли», UI сравнения split-view.

### Что должно быть в ТЗ

- **Schema изменения** — нужно ли добавить `Person.status` enum (active/archived/on_leave?)? Или достаточно `Person.terminationDate`?
- **Триггеры архивации** — какие сценарии увольнения / трансфера / парного назначения? Что делает RoleClonePersonaVersioningHandler сейчас, что нужно дополнить?
- **Cron-фильтрация** — какие cron'ы должны пропускать archived (executable-persona-build, role-profile-build, knowledge-clone-rebuild, skill-profile-recalibrate)?
- **API**: GET `/api/v1/clones?status=active|archived|all` фильтр; GET `/api/v1/roles/:id/clone/history` уже есть — расширить или ОК как есть?
- **Frontend** — маркетплейс должен поддерживать чекбокс «показать предыдущих владельцев»; UI сравнения split-view на странице роли.
- **RBAC** — кто видит archived (admin? owner? все?).
- **Юридический момент** — §9.10 утверждает что клон должности **НЕТ персональных данных**, 152-ФЗ не применяется. Проверить — это утверждение валидно в текущей архитектуре или есть PII-leak в `personaPrompt`?

### Открытые вопросы для пользователя

1. **`Person.status`** — нужен ли enum или достаточно `terminationDate IS NOT NULL`?
2. **Сценарии архивации** — что считать «увольнением»: только terminationDate? Или manual flag «архивировать клон»?
3. **На какой срок хранится archived** — бессрочно или с retention (например, 3 года)?
4. **Кто видит archived в `/clones`** — все members Org или только админ?
5. **Сравнение split-view** — это MVP сразу или отложенная фича после маркетплейса?
6. **Что в карточке архивного** — фото оригинала или просто инициалы? (PII-вопрос)

### Зависимости

- Marketplace UI должен быть готов раньше (задача 3 ниже) — без него нет места для чекбокса «показать archived».
- Зависимость можно решить либо **последовательно** (сначала маркетплейс, потом archived), либо **параллельно** в одном ТЗ (всё разом).

---

## Задача 2 — Unit-тесты для CheckinSentimentBatchCron + parser

### Цель

Закрыть gap из Фазы 2: написать unit-тесты на новый cron и парсер, добавленные в коммите `3cba11d`.

### Что уже есть

- `backend/src/modules/operations/workers/checkin-sentiment-batch.cron.ts` — `@Cron('*/5 * * * *')`, окно 60 минут, max 100 чек-инов/прогон, группировка по tenantId → батчи 10. Использует `LlmRouterService.call({ taskType: 'checkin-sentiment-batch', tools, maxTokens: 8000 })`.
- `backend/src/modules/operations/prompts/checkin-sentiment.prompt.ts` — функция `parseCheckinSentimentBatchToolInput` (чистая функция парсинга tool_call.input).
- Фикстуры: `backend/test/eval/operations-experiment/fixtures/checkins-week.json` — 25 чек-инов команды разработки.
- Уже есть pattern для тестов в `backend/src/modules/operations/**/*.spec.ts` — посмотреть как mock'ают `LlmRouterService`.

### Что изучить

- Существующие spec-файлы в `backend/src/modules/operations/workers/` — текущий стиль тестирования cron'ов.
- `backend/src/modules/operations/workers/checkin-sentiment-analyzer.worker.spec.ts` (если есть) — как тестируется legacy single-checkin worker.

### Что должно быть в ТЗ

Малое ТЗ (короткое). Не больше 1 страницы.

- **`checkin-sentiment-batch.cron.spec.ts`:**
  - Кейс: 25 чек-инов → 3 батча (10+10+5)
  - Кейс: `tool_calls` отсутствует → метрика `coo_sentiment_failed_total` ++ , best-effort продолжает
  - Кейс: один невалидный element в batch → классифицируется только валидный
  - Кейс: `cfg.operations.sentimentEnabled = false` → ранний return без LLM-вызовов
  - Кейс: окно 60 минут — чек-ины старше 1ч не подбираются
- **`checkin-sentiment.prompt.spec.ts`** (или дополнить существующий):
  - `parseCheckinSentimentBatchToolInput` — валидный input с 10 элементами
  - невалидный JSON → throw
  - невалидный sentiment-enum → throw
  - пустой массив → пустой массив на выходе
  - дубликат checkInId → последний выигрывает (или throw — уточнить)
- **Integration-тест** (опционально, с фикстурой):
  - Прогнать `processBatch` с mock LlmRouter возвращающим заранее построенный tool_call, проверить запись sentiment в БД.

### Открытые вопросы

1. **Дубликат checkInId в batch-результате** — last-wins, first-wins или throw?
2. **Integration vs unit** — нужен ли отдельный integration-тест с фикстурой, или достаточно unit?

---

## Задача 3 — Frontend Фазы 7: маркетплейс клонов

### Цель

Реализовать frontend для §9.4.7 (боковая панель диалогов + кнопка «Новый диалог») и §9.4.8 (маркетплейс `/clones` + `/admin/clones`).

### Что уже есть (backend)

- Endpoint'ы:
  - `GET /api/v1/clones` — список текущих ролевых клонов
  - `POST /api/v1/clones/persons/:personId/conversations` — новый диалог (Фаза 7 `f897d99`)
  - `POST /api/v1/clones/roles/:roleId/conversations` — новый диалог
  - `GET /api/v1/clones/:roleId` — детали клона (если есть, проверить)
  - `POST /api/v1/clones/persons/:personId/ask` — задать вопрос
  - `POST /api/v1/clones/roles/:roleId/ask`
  - Существующие endpoint'ы `/roles/[id]/clone/history` — версионная история
- Frontend уже есть:
  - `frontend/app/(authenticated)/clones/` — страница списка (создана Clones-Roles Ф4 `9379fd8`)
  - `frontend/app/(authenticated)/roles/[id]/clone/page.tsx` — детали роли
  - `frontend/app/(authenticated)/roles/[id]/clone/history/page.tsx` — история
  - `frontend/src/api/clones.api.ts` — API клиент

### Что изучить

1. **Существующий `/clones` UI** — что уже показывается? Что добавить (карточки в виде marketplace)?
2. **AppShell sidebar pattern** — `frontend/src/ui/components/layout/AppShell.tsx` — как добавить новую боковую панель для диалогов?
3. **ChatV2Client + AssistantClient** — как реализован UI с диалогами + history sidebar в существующих чатах. Можно ли переиспользовать?
4. **CloneAccessGrant видимость** — backend ещё не фильтрует list по grants для рядовых users (см. gap в Phase 7). UI должен показать карточки всем member'ам, но кнопку «Спросить» прятать без grant. **Уточнить с пользователем** — лучше backend-фильтрация или UI-disable?
5. **Mobile-first** — Concierge floating-кнопка mobile-first; новый /clones тоже mobile-first?
6. **Cmd+K интеграция** — добавить ли клонов в command palette поиск?

### Что должно быть в ТЗ

- **Маршруты**: `/clones` (рядовой user маркетплейс), `/admin/clones` (админ — управление + CloneAccessGrant CRUD), `/clones/[roleId]/chat/[conversationId]` (диалог с боковой панелью)
- **Компоненты**:
  - `CloneMarketplaceClient` — карточная сетка (mobile-first)
  - `CloneCard` — статус, аватар, кнопка «Спросить»/«Управлять доступом»
  - `CloneChatSidebar` — список диалогов в боковой панели + кнопка «+ Новый диалог»
  - `CloneChatClient` — главный чат с переключением между диалогами
  - `AdminCloneAccessGrantManager` — список грантов + кнопка add/remove (зависит от Задачи 4)
- **State**:
  - SWR ключи `useClones()`, `useCloneConversations(roleId)`, `useCloneConversationMessages(id)`
  - Context `CloneAccessContext` (опц.) для скрытия кнопок без grant
- **UX-карта** — что показывать на каждой странице, состояния loading/empty/error
- **Маршрутизация** — `/clones` редиректит на /clones/<recommended-role-id>?
- **Адаптивность** — mobile vs desktop

### Открытые вопросы

1. **Фильтрация в `/clones`** — backend фильтрует по `CloneAccessGrant` или показываем всем, а Forbidden при ask?
2. **Поиск/фильтры** — фильтры по отделу, статусу (active/собирается/нет данных), по упоминанию в встречах за период?
3. **Аватар клона** — фото оригинала или абстрактная иконка по роли?
4. **Кнопка «Сравнить»** — для Задачи 1 (исторические клоны) — на странице роли split-view; делаем разом или отдельной волной?
5. **`/admin/clones` vs `/clones`** — это две раздельные страницы или одна с админ-режимом по тоггл-у?

---

## Задача 4 — Admin endpoints CRUD CloneAccessGrant

### Цель

Реализовать API для админа Org — выдавать/отзывать гранты на клоны конкретным пользователям.

### Что уже есть

- Модель `CloneAccessGrant` в `backend/prisma/schema.prisma` (Phase 7 `f897d99`):
  ```
  CloneAccessGrant {
    id, tenantId, grantedToUserId, cloneType ('person'|'role'),
    cloneRefId, grantedById, grantedAt, [expiresAt?, revokedAt?]
  }
  ```
  Уникальный индекс `(tenantId, grantedToUserId, cloneType, cloneRefId)`.
- `backend/src/modules/clones/clones-admin.controller.ts` — существует (создан в Clones-Roles Ф2 `6a15b88` для `POST /admin/clones/:roleId/force-new-version`).
- `RbacService.canAccessPersonClone` / `canAccessRoleClone` — v2-ветка использует `CloneAccessGrant`.
- `backend/scripts/patch-migrate-clone-access.ts` — пока заглушка для миграции первичных грантов.

### Что изучить

1. **`backend/src/modules/clones/clones-admin.controller.ts`** — текущая структура контроллера, RBAC pattern.
2. **Другие admin-controllers** в `backend/src/modules/admin/**` — как реализованы стандартные CRUD + audit log + Zod DTO + Swagger.
3. **`AuditLog`** модель (если есть) — куда писать события grant/revoke.
4. **`PolicyService` / Casbin** — нужно ли добавить новый ресурс `clone_access_grant`?

### Что должно быть в ТЗ

- **5-6 endpoint'ов**:
  - `GET /api/v1/admin/clones/access-grants` — список (с фильтрами по user, role, status)
  - `POST /api/v1/admin/clones/access-grants` — выдать (cloneType, cloneRefId, grantedToUserId, optional expiresAt)
  - `DELETE /api/v1/admin/clones/access-grants/:id` — revoke
  - `PATCH /api/v1/admin/clones/access-grants/:id` — продление expiresAt
  - `GET /api/v1/admin/clones/:roleId/access-grants` — список грантов для конкретного клона
  - `GET /api/v1/me/clone-access` — что мне выдано (для пользователя)
- **DTO** — Zod + Swagger, FiltersDto для GET list
- **RBAC** — кто может выдавать (owner/admin Org?), кто видеть список (owner/admin)
- **Audit log** — обязательно для grant/revoke, с указанием grantedById
- **Notifications** — при выдаче гранта пользователю — отправлять ли уведомление? (Conversational channels)
- **Bulk endpoints** — нужны ли (выдать одному user'у несколько клонов за раз)?
- **Frontend** — admin UI в `/admin/clones` (часть Задачи 3)
- **Patch-script `patch-migrate-clone-access.ts`** — реальная миграция: что считать «первичным грантом» (всем кто уже использовал клон по логам? или по факту того что они носители смежных ролей?)

### Открытые вопросы

1. **Кто может выдавать гранты** — только owner Org, или owner + admin? Или новая роль `clone_admin`?
2. **expiresAt** — нужно ли поле? Default — без срока. Поле уже в schema, но логика expiration в коде есть?
3. **Notifications при выдаче** — нужно ли уведомлять пользователя что ему «дали доступ к клону X»?
4. **Bulk** — практический use case — есть ли реальный сценарий «выдать одному 10 клонов»?
5. **Миграция первичных грантов** — критерий: кто уже спрашивал клона за последние N дней? Или owner/admin Org автоматически получают все?

---

## Задача 5 — Smoke 28 агентов после правок

### Цель

Прогнать smoke по всем 28 LLM-агентам после Фаз 1-8 и убедиться что:
1. Ничего не сломалось (нет 400/500 ошибок)
2. Метрики `z_llm_thinking_model_guard_total{kind}` начали капать корректно
3. После применения seed'ов на dev — все агенты переключились на DeepSeek-V4-Pro как ожидалось

### Что уже есть

- `backend/test/eval/smoke-all-agents/SUMMARY-SMOKE.md` — отчёт первого smoke (до миграции, 2026-05-25)
- `backend/scripts/eval/smoke-all-agents-runner.ts` — универсальный runner
- `backend/scripts/eval/_smoke-shared.ts` — общий helper
- `backend/scripts/eval/smoke-<taskType>.ts` — 28 тонких обёрток (по одной на агент)

### Что нужно для запуска

- `DEEPSEEK_API_KEY` в окружении (есть у пользователя, не у меня в sandbox)
- Прогон 28 скриптов: `bun run scripts/eval/smoke-<taskType>.ts` (стоимость ~$0.04 на полный прогон)
- Применение seed'ов на dev-БД перед прогоном (см. прод-инструкцию в рефлексии)

### Что должно быть в ТЗ

Это **операционный чек-лист**, не код-задание. Может быть короткое.

- **Pre-flight**:
  - `DEEPSEEK_API_KEY` в `.env` или окружении
  - `bun run prisma:push` на dev (CloneAccessGrant)
  - Применить все seed-скрипты на dev (см. рефлексию)
- **Прогон smoke** (последовательно или параллельно):
  - Список из 28 taskType (из SUMMARY-SMOKE.md)
  - Скрипт-обёртка `run-all-smoke.sh` (опционально)
- **Сверка с предыдущим SUMMARY** — что изменилось:
  - Цена должна остаться примерно той же или ниже (DeepSeek-Pro дешевле gpt-5.4)
  - Время может уменьшиться (Pro быстрее)
  - 5 промптов перенесённых (block-distill, block-linker, theme-classify, reframing, entity-merge-arbiter) — побайтово равны, snapshot-тесты в Фазе 8 это гарантируют, но в smoke важна семантика
- **Метрики после прогона**:
  - `curl /metrics | grep z_llm_thinking_model_guard_total` — должны быть инкременты `schema-to-tool`, `strict-stripped`
  - `curl /metrics | grep core_llm_tokens_total` — токены по taskType
- **Откат-план**:
  - Если какой-то агент падает 400/500 — `--update-existing` на старую модель обратно
  - Скрипт `patch-rollback-to-deepseek-flash.ts` (создать на случай)
- **Обновить SUMMARY-SMOKE** новой версией (`SUMMARY-SMOKE-2.md` или append)

### Открытые вопросы

1. **Окружение прогона** — локальный backend подключён к dev-БД? Или прогонять прямо против prod-БД (рискованно)?
2. **Параллельность** — 28 прогонов параллельно (быстро, но риск rate-limit DeepSeek) или последовательно (медленно, но безопасно)?
3. **Откат-скрипт** — нужно ли заранее подготовить `patch-rollback-to-deepseek-flash.ts` или достаточно ручного редактирования seed'ов?

---

## Формат ТЗ

Для каждой из 5 задач — отдельный файл в `plans/tz/`:

- Имя: `YYYY-MM-DD-<short-name>.md`
  - `2026-MM-DD-historical-clones-of-role.md` (Задача 1)
  - `2026-MM-DD-checkin-batch-cron-tests.md` (Задача 2)
  - `2026-MM-DD-clones-marketplace-frontend.md` (Задача 3)
  - `2026-MM-DD-clone-access-grant-admin-api.md` (Задача 4)
  - `2026-MM-DD-llm-migration-smoke-checklist.md` (Задача 5)
- Frontmatter: `status: draft`, `created`, `type: tz`, `priority`, `effort`, `depends_on`.
- Стандартная структура ТЗ Z: §0 Контекст → §1 Цели → §2 Решения → §3 Затронутые файлы → §4 Тесты → §5 Roadmap → §6 Открытые вопросы (если остались после уточнений у пользователя).

После всех 5 ТЗ — обнови `second-brain/index.md` со ссылками в разделе «Активные ТЗ».

---

## Запреты

- **НЕ применяй ничего в БД** (никаких `prisma:push`, `seed`, `patch`). Только discovery + написание ТЗ.
- **НЕ пиши код** для самих задач — только ТЗ. Реализацию делает следующая сессия.
- **НЕ trogа feedback / admin-settings** — параллельная сессия может ещё там работать. Если в discovery видишь что эти файлы изменены в дереве (M) — игнорируй.
- **НЕ делай `git add .` или `-A`** — только явные пути.
- **НЕ пушь** — только commit, если решишь коммитить ТЗ (предварительно согласуй с пользователем).
- **НЕ выдумывай ответы** на открытые вопросы — спрашивай у пользователя ДО написания ТЗ.

---

## Алгоритм работы

1. Прочитай главный ТЗ-документ + рефлексию + карту AI-агентов.
2. Запусти `git log origin/dev --oneline -30` чтобы увидеть актуальное состояние.
3. По каждой задаче:
   - Прочитай указанные файлы (discovery).
   - Сформулируй открытые вопросы.
   - **Задай вопросы пользователю списком** (всё разом, не по одному).
4. После ответов пользователя — напиши 5 ТЗ.
5. Финальный отчёт: что написал, какие коммиты делать (пред-commit'нуть для review).

---

## Финальный отчёт (что вернуть пользователю)

1. Список ТЗ-файлов которые написал.
2. Краткое содержание каждого (1-2 строки).
3. Что НЕ написал (если оказалось избыточным или зависит от чего-то другого).
4. Команда для просмотра `git log` нового состояния.
5. Если есть открытые вопросы — выпиши их отдельно.

---

**Примерное время на discovery + 5 ТЗ:** 1-2 часа. Не торопись, лучше задать вопросы и сделать правильно.
