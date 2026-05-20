# Z — AI-встречи на LiveKit

Этот документ — карта проекта. Читай его в начале каждой сессии.

**Что это:** собственный модуль AI-видеовстреч внутри SaaS. LiveKit — медиа-движок (аудио/видео/screen share), бизнес-логика на нашем бэке. См. [second-brain/02_architecture/project-overview.md](second-brain/02_architecture/project-overview.md).

**MVP:** до 10 участников, 9 типов встреч, гость без регистрации, запись (общая + отдельные аудиодорожки), AI-отчёт под тип встречи.

## Ключевые принципы

1. **Second Brain как источник правды о фактическом состоянии** — любое изменение бизнес-логики или архитектуры должно отражаться в `second-brain/`. Если через месяц будет непонятно ПОЧЕМУ так сделано — фиксируй сразу.
2. **Один план — одна функция** — любая новая фича оформляется планом в `plans/` до начала работы. См. [plans/README.md](plans/README.md).
3. **LiveKit — только медиа.** Никакой бизнес-логики в LiveKit Server. Все токены генерирует только backend. Гость не получает секреты LiveKit.
4. **Аудио — отдельными дорожками на каждого участника.** Не полагаться на общий микс — он разрушает качество AI-анализа.
5. **AI-отчёт зависит от типа встречи** — главное продуктовое отличие. Шаблоны см. [second-brain/01_projects/ai-analysis-by-type.md](second-brain/01_projects/ai-analysis-by-type.md).
6. **В prod ничего не на одной ноде** — SFU / Egress / TURN / Backend / DB / Storage разделять.

## КРИТИЧЕСКОЕ РАЗДЕЛЕНИЕ: second-brain vs plans

| Содержимое | Куда |
|---|---|
| Что сейчас работает по факту, архитектура, сущности, связи | `second-brain/` |
| История сессий, рефлексия | `second-brain/05_история/` |
| Бизнес-контекст, гипотезы, фидбек | `second-brain/01_projects/` |
| **Анализ фичи / UX-аудит / разбор «как улучшить» / backlog** | `plans/analysis/` |
| **ТЗ на реализацию** | `plans/tz/` |
| Завершённые/отменённые планы | `plans/archive/` |

Правило: **это уже работает или это идея?** Работает → second-brain. Идея → plans.

## Стек

- **Frontend:** React / Next.js, LiveKit React Components.
- **Backend:** NestJS, PostgreSQL, Redis, LiveKit Server SDK, S3 SDK.
- **Медиа:** LiveKit Server (SFU), LiveKit Egress, отдельный TURN.
- **Storage:** S3-compatible (Yandex / Selectel / SberCloud / MinIO).
- **AI:** транскрибация → разделение по спикерам → шаблон по типу встречи (конкретные провайдеры TBD, см. `plans/analysis/`).

Подробно: [second-brain/02_architecture/tech-stack.md](second-brain/02_architecture/tech-stack.md).

## Команды разработки

Рантайм — **Bun** для dev/build, **Node 20** для prod-runner. Команды запускаются из `backend/` или `frontend/`. Полная таблица — в [backend/README.md](backend/README.md).

**Локальные зависимости** (из корня): `docker compose -f docker-compose.dev.yml up -d` (Postgres+pgvector :55435, Redis :56381, MinIO :59000/:59001). LiveKit для dev — `bun run livekit` (Linux-only, `network_mode: host`). Прод-деплой — единый корневой `docker-compose.yml` (`docker compose up -d --build backend`, порты через `.env`); медиа-стек отдельно — `infra/livekit/docker-compose.yml`.

**Backend** (`cd backend`, слушает :3000, Swagger `/api/docs`, health `/health`, метрики `/metrics`):
- Первый запуск: `bun install && bun run prisma:push && bun run prisma:generate` (+ опц. `bun run prisma:seed`)
- Dev: `bun run dev` (HTTP) и `bun run worker:dev` (BullMQ-воркеры — **отдельный процесс**, `src/workers/main.ts`)
- Проверка: `bun run typecheck` · `bun run lint` · `bun run build`
- Тесты (vitest): `bun run test:unit` / `test:integration` / `test:e2e`. Один файл: `bunx vitest run src/путь/файл.spec.ts`; по имени: `bunx vitest run -t "имя теста"`
- pgvector-индексы (HNSW + GIN, не в schema.prisma): `bun run apply-postgres-init`

**Frontend** (`cd frontend`, :3001): `bun run dev` · `bun run typecheck` · `bun run lint` · `bun run build` · `bun run test:unit`

**Prisma:** только `bun run prisma:push`, **никогда** `prisma migrate*` (см. skill `prisma-db-push-rules`). После любой правки моделей — `bun run prisma:generate`. ENV — только через `TypedConfigService` / `env.schema.ts`, никаких `process.env.*` в коде.

## Архитектура кода

Корень: `backend/` (NestJS) + `frontend/` (Next.js 14 App Router) + `infra/` (LiveKit/Grafana/Prometheus/loadtest) + `second-brain/` (источник правды) + `plans/` (ТЗ и анализ) + `docs/`.

**Backend** (`backend/src/`):
- `main.ts` — HTTP-приложение; глобальный префикс API `/api/v1`. `workers/main.ts` — отдельный процесс воркеров/кронов BullMQ (поверх Redis).
- `modules/*` — ~45 feature-модулей (meetings, livekit, recordings, ai, knowledge-core, orgs, rbac, admin, dashboard, goals, entitlements, …). Каждый эндпоинт — Zod-DTO (`nestjs-zod`) + Swagger.
- `common/*` — cross-cutting: `config` (TypedConfigService), `prisma`, `redis`, `crypto` (AES-256-GCM), `metrics` (prom-client), `logger` (pino), `filters`/`interceptors`/`pipes`/`middleware`.
- **knowledge-core — ядро продукта.** Pipeline `ingest → IdeaBlock + Entity → IdeaBlockLink/EntityLink (граф) → Theme (кластеры)`, всё через BullMQ-воркеры и `@Cron`. Карта модулей и потоков: [second-brain/02_architecture/module-map.md](second-brain/02_architecture/module-map.md), детали: [second-brain/02_architecture/knowledge-core.md](second-brain/02_architecture/knowledge-core.md).
- **Multi-tenancy:** `orgs` + `rbac` (Casbin-совместимый, `policies/policy.csv`). `TenantGuard` достаёт `tenantId` из `X-Org-Id`/`:orgId`. Любой knowledge-запрос требует `tenantId`.
- **LLM:** `ai/services/llm-router.service.ts` маршрутизирует по `taskType` к провайдерам (фильтр по `dataClass`); промпты редактируются из админки (registry с code-fallback). ASR + Claude — через внутренний proxy.
- **Данные:** одна Prisma-схема `backend/prisma/schema.prisma` (~1.7к строк, pgvector для embeddings). One-off скрипты — `backend/scripts/*` (seed/patch/smoke/backfill).

**Frontend** (`frontend/`): слоистая модель **ApiDto → DomainModel → UiModel** (см. skill `frontend-rules`):
- `src/api/*.api.ts` — вызовы через единый `api-client.ts` (ApiDto); `src/domain/*.ts` — мапперы в DomainModel; `src/ui` — компоненты; `src/contexts` — `auth` / `entitlement` / `toast`; `src/hooks`; data-fetching — SWR.
- `app/` — App Router с route-группами `(public)` / `(authenticated)` / `(admin)` / `(design-preview)`. UI на LiveKit React Components + Radix + Tailwind; плеер — Vidstack.

## Точка входа в second-brain

[second-brain/index.md](second-brain/index.md) — все разделы ведут отсюда.

## Как работать с проектом

- В начале задачи — читай этот файл, затем `second-brain/index.md` и нужные файлы из `second-brain/01_projects/` и `plans/`.
- Если меняется бизнес-логика — обнови `second-brain/index.md` и нужные файлы в `01_projects/` или `02_architecture/`.
- Если меняется план — обнови файл в `plans/`.
- Если появляется новая важная папка/документ — обнови этот `CLAUDE.md`.

## Правила работы с Git

**Перед `git pull`:**
1. Прочитай `second-brain/index.md` — зафиксируй состояние.
2. После pull — проверь `git diff HEAD~1 --name-only`.
3. Если изменились модули/контракты/архитектура — обнови `second-brain/`.

**Перед `git commit` / `git push`:**
1. Отражены ли изменения в `second-brain/`?
   - Новая фича → заметка в `01_projects/`.
   - Архитектурное изменение → обновить `02_architecture/`.
   - Удалён модуль → убрать все ссылки.
2. Обнови статусы в `plans/` (`[ ]` → `[x]`).
3. Коммит: `тип(область): описание` (Conventional Commits).

**ВАЖНО — что коммитить:** только то, что создал или изменил САМ. Никогда `git add .` / `-A` / массовых добавлений. Перед каждым `git add` явно перечисляй пути. Untracked файлы, появившиеся ДО сессии или не относящиеся к задаче, — не трогать.

**ВАЖНО — `git push` только с явным подтверждением:** для каждого нового push спрашивай отдельно. Разрешение на коммит ≠ разрешение на push.

**Исключение — рефлексия в `second-brain/05_история/`:** коммитится и пушится автоматически сразу после основного push, без отдельного подтверждения.

## ВАЖНО: завершение работы и рефлексия

Применяется **по триггеру**, не «в конце сессии».

### Триггер 1: после `git push`

1. **Обнови `second-brain/`** — если изменилась бизнес-логика/архитектура.
2. **Чек-лист производных заметок** — пройди по таблице ниже и обнови ВСЕ затронутые файлы. Заметки ссылаются друг на друга — пропуск ломает связность.

| Что изменил | Что обновить в second-brain (помимо профильной 01_projects/<feature>.md) |
|---|---|
| Новая колонка/таблица в БД | `02_architecture/data-model.md` |
| Новый модуль/контроллер | `02_architecture/module-map.md` |
| Новый AI-агент / воркер / job | `01_projects/ai-jobs.md`, `01_projects/workers-queues.md` |
| Новая admin-страница | `01_projects/admin.md` |
| Новый API-эндпоинт | `01_projects/api-layer.md` |
| Новая публичная страница | `01_projects/frontend-pages.md` |
| Новый context/hook | `01_projects/frontend-contexts-hooks.md` |
| Новый план в `plans/` | `second-brain/index.md` (если крупный) |

3. **Запиши рефлексию** в `second-brain/05_история/YYYY-MM-DD-краткое-название.md`:
   - что было поставлено
   - как решал (с конкретными файлами и коммитами)
   - что вышло (результаты верификации: сборка, тесты, ручная проверка)
   - чему научился

4. **Закоммить и запушь рефлексию** отдельным `docs(second-brain): рефлексия — ...` коммитом.

5. **Напомни про prod-операции** — если в коммитах изменились файлы, чьи данные хранятся в БД и редактируются админкой / требуют миграций / изменений конфига. Подсказка выдаётся ОДИН раз, в виде блока «Для применения на проде выполни: …». Команды должны быть копи-пейст-готовые.

6. **Сформируй полную prod-инструкцию для программиста** — пошагово, в чате (не файлом), включая только применимые шаги под фактический набор изменений.

### Триггер 2: пользователь говорит «всё», «закругляемся», «спасибо», «ок»

Тот же набор действий: обнови → запиши рефлексию → коммит → push.

### Триггер 3: накопилось >10 необработанных файлов в `05_история/`

Перед началом следующей задачи — пройдись по новым рефлексиям (без `distilled: true` в frontmatter) и вынеси повторяющиеся уроки:

| Тип урока | Куда переносить |
|---|---|
| Тех. факт о проекте (поля, контракты, ловушки tsc/Prisma/etc) | `02_architecture/code-pitfalls.md` |
| Поведенческое правило для агента | `~/.claude/projects/c--work-z/memory/feedback_*.md` + строка в `MEMORY.md` |
| Правило про конкретный модуль | профильная `01_projects/<feature>.md` |

Критерии переноса (хотя бы один):
- урок повторяется в ≥2 рефлексиях, ИЛИ
- грабля с ценой >1 час потерянного времени, ИЛИ
- меняет способ работы (новая команда, новый подход).

После переноса — `distilled: true` в frontmatter обработанных рефлексий. Файлы НЕ удалять — это контекст-источник для будущей дистилляции.

### Чего НЕ делать
- НЕ откладывай рефлексию «на потом, в конце сессии» — конца нет.
- НЕ пиши рефлексию задним числом — детали забудутся.
- НЕ пропускай рефлексию для «мелких» задач — даже фикс на 2 строки даёт урок.

## ВАЖНО: план для каждой новой функции

Любая нетривиальная функция — план в `plans/` ДО кода.

Правила:
1. Один план = одна функция. Если план уже есть — работаем с ним.
2. Имя: `YYYY-MM-DD-название-функции.md`.
3. План делится на фазы. У каждой статус `[ ]` или `[x]`.
4. В конце плана — итог: реализовано целиком или нет, что осталось.
5. План актуализируется после каждой сессии.

## Язык

Всегда отвечай на русском.
