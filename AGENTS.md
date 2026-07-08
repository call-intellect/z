# Z / Кора — агент-память (читай первым)

> **Источник правды в глубину — [CLAUDE.md](CLAUDE.md).** Этот файл — выжимка для агентов ZCode: что это за репо, как тут работать и где лежат подробности. При расхождениях с CLAUDE.md приоритет у CLAUDE.md (а по позиционированию — у `second-brain/06_marketing/`).

## Что это

Платформа **памяти компании** (бренд Z → Кора, ребренд M9–M12): автоматически собирает граф знаний из встреч/чатов/решений и помнит за всю команду. MVP-вертикаль — **AI-встречи на LiveKit** как первый источник графа (до 10 участников, гость без регистрации, запись отдельными аудиодорожками, AI-отчёт зависит от типа встречи).

## Структура репозитория

- `backend/` — NestJS + Prisma + PostgreSQL + Redis + BullMQ + LiveKit Server SDK + S3 + Anthropic SDK. ~100 feature-модулей в `src/modules/*`.
- `frontend/` — Next.js (App Router) + React 19 + LiveKit React Components + Radix + Tailwind + SWR + Vidstack.
- `infra/` — LiveKit / gepa / postgres / loadtest (вне Bun-стека; Python допустим только тут как отдельные HTTP-микросервисы).
- `second-brain/` — **источник правды о фактическом состоянии** (архитектура, сущности, контекст, рефлексия). Вход — [second-brain/index.md](second-brain/index.md).
- `plans/` — намерения: `analysis/` (как улучшить) · `architecture/` (решение человеческим языком, владелец одобряет ДО ТЗ) · `tz/` (ТЗ-контракт) · `archive/`.
- `docs/` — операционные регламенты (`docs/operations/prod-deploy-log.md`, `docs/operations/feature-flags.md`, `docs/methodology/prompts/`).
- `scripts/` (корень) — оркестрация локального dev-стека.

**Правило «работает или идея?»: работает → `second-brain/`, идея → `plans/`.**

## Стек и рантайм

- **Bun** для dev/build, **Node 20** для prod-runner. Команды — из `backend/` или `frontend/`.
- Backend слушает `:3000`: Swagger `/api/docs`, health `/health`, метрики `/metrics`. Глобальный префикс `/api/v1`.
- HTTP и BullMQ-воркеры/cron — **в одном процессе** (`WorkersModule` в `AppModule`); отдельного worker-процесса нет.

## Команды разработки

**Локальные зависимости** (из корня): `docker compose -f docker-compose.dev.yml up -d` (Postgres+pgvector :55435, Redis :56381, MinIO :59000/59001). LiveKit для dev — `bun run livekit` (Linux-only).

**Backend** (`cd backend`):
- Первый запуск: `bun install && bun run prisma:migrate && bun run prisma:generate` (+ опц. `bun run prisma:seed`).
- Dev: `bun run dev`
- Проверка: `bun run typecheck` · `bun run lint` · `bun run build`
- Тесты (vitest): `bun run test:unit` / `test:integration` / `test:e2e`. Один файл: `bunx vitest run src/путь/файл.spec.ts`; по имени: `bunx vitest run -t "имя"`.
- pgvector-индексы (HNSW + GIN, **вне** `schema.prisma`): `bun run apply-postgres-init`.

**Frontend** (`cd frontend`, `:3001`): `bun run dev` · `bun run typecheck` · `bun run lint` · `bun run build` · `bun run test:unit`.

**Полная таблица команд** — [backend/README.md](backend/README.md).

## Архитектура и границы слоёв

- **knowledge-core — ядро продукта.** Pipeline `ingest → IdeaBlock + Entity → IdeaBlockLink/EntityLink (граф) → Theme (кластеры)` через BullMQ + `@Cron`. Карта: [second-brain/02_architecture/module-map.md](second-brain/02_architecture/module-map.md).
- **Multi-tenancy:** `orgs` + `rbac` (Casbin-совместимый, `policies/policy.csv`). `TenantGuard` берёт `tenantId` из `X-Org-Id`/`:orgId`. **Любой knowledge-запрос требует `tenantId`.**
- **LLM:** `ai/services/llm-router.service.ts` маршрутизирует по `taskType`; промпты редактируются из админки с code-fallback. ASR + Claude — через внутренний proxy.
- **Frontend, слоистая модель** `ApiDto → DomainModel → UiModel`: `src/api/*.api.ts` (через единый `api-client.ts`) → `src/domain/*.ts` → `src/ui`. Data-fetching — SWR; контексты — `auth` / `entitlement` / `toast`.
- **LiveKit — только медиа.** Никакой бизнес-логики в LiveKit Server; все токены генерит только backend; гость не получает секреты LiveKit. Аудио — отдельной дорожкой на участника.

## ЖЁСТКИЕ правила (нарушение = ошибка)

1. **Без комментариев в коде.** Код самодокументируем. Не добавлять нарративные/JSDoc комментарии; при правке файла такие комментарии удалять. Допустимы только функциональные директивы: `eslint-disable*`, `@ts-expect-error`, `prettier-ignore`, `/// <reference`. Знания живут в `docs/`, не в коде.
2. **Отвечать только на русском.** Уточняющие вопросы — на русском, с развёрнутым объяснением каждого варианта и явной рекомендацией (рекомендуемый вариант — первым, с пометкой «(рекомендую)»).
3. **Единый backend-стек — Bun + Node + TypeScript.** В продакшен-путь `backend/` Python не вводить. Нашёл работающий Python — открой ТЗ на порт в TS. Исключения: `infra/*` HTTP-микросервисы, Docker build-time нативные модули, `.claude/` tooling.
4. **Конфиги: крутилки — в `AdminSetting`, не в ENV и не в коде.** В `env.schema.ts` только секреты, строки подключения, bootstrap рантайма (`NODE_ENV`/`PORT`/`LOG_LEVEL`/…) и креды+endpoint внешней инфры. Всё остальное (порог, лимит, флаг, retention, rate-limit, выбор модели, debounce/TTL) — `AdminSetting` через `resolveSync`/`getDynamic` + строка в [admin-setting-schema-registry.ts](backend/src/modules/admin/settings/admin-setting-schema-registry.ts) + сид. Прямой `process.env.*` мимо `env.schema.ts` запрещён.
5. **Ship-On.** Готовая фича идёт в прод СРАЗУ включённой. Запрещено «выкатить OFF и включить потом». Допустимы ровно два вида флагов: **(а) kill-switch** (фича ON, рубильник — только экстренно выключить), **(б) решение владельца** (необратимое изменение доступа/бюджета — выкатывается только вместе с заданным владельцем параметром и сразу включается). Любой новый флаг = строка в [docs/operations/feature-flags.md](docs/operations/feature-flags.md).
6. **Prisma — версионируемые миграции.** Любое изменение БД = файл миграции: `bun run prisma:migrate -- --name <описание>` → ревью SQL → коммит миграции вместе с кодом. На прод применяется автоматически (`migrate deploy`, зашито в `apply-prod-deploy.ts`). `prisma:push` (`db push`) — **только** для черновых локальных проб, которые не коммитятся. После правки моделей — `bun run prisma:generate`. См. skill `prisma-db-push-rules`.

## Git и завершение работы

- **Перед коммитом:** отражены ли изменения в `second-brain/`? (новая фича → `01_projects/`, архитектура → `02_architecture/`, удалён модуль → убрать ссылки). Статусы в `plans/` (`[ ]` → `[x]`). Сообщения — Conventional Commits: `тип(область): описание`.
- **`git add` — явно по путям.** Никогда `git add .` / `-A`. Коммитить только то, что создал/изменил сам. `git push` — только с отдельным явным подтверждением для каждого push (разрешение на коммит ≠ разрешение на push).
- **Рефлексия — по триггеру, не «в конце сессии».** Триггеры: после `git push`; пользователь сказал «всё»/«закругляемся»/«спасибо»/«ок»; накопилось >10 необработанных файлов в `05_история/`. Действия: обновить `second-brain/` по таблице производных заметок (CLAUDE.md, Триггер 1) → записать рефлексию в `second-brain/05_история/YYYY-MM-DD-*.md` → закоммитить+запушить её отдельным `docs(second-brain): рефлексия` коммитом (без доп. подтверждения) → обновить `docs/operations/prod-deploy-log.md`.
- **Prod — только через docker-compose:** `docker compose exec backend ...` / `docker compose run --rm backend ...`. Никаких `cd backend && bun run ...` на проде.
- **PrismaClient в скриптах:** используй `createPrismaClient()` из `backend/scripts/_lib/prisma.ts` (Prisma 7 падает на голом `new PrismaClient()`). Импорты из кода — `import { X } from '../src/modules/...'` (не `../dist/`). Любой новый `seed-*`/`patch-*`/`backfill-*`/`migrate-*` скрипт → обязательно добавить в массив `STEPS` файла `backend/scripts/apply-prod-deploy.ts`.

## Tooling: ВАЖНО — два разных окружения

> ⚠️ **Критично.** Этот репозиторий выстроен вокруг **Claude Code** toolchain, но сейчас ты работаешь под **ZCode**, где набор инструментов **другой**. Не применяй правила `.claude/` вслепую — сверяйся с тем, что реально доступно в твоей сессии.

### Под ZCode (текущее окружение) — что реально работает

**MCP-сервера (встроены в клиент ZCode, не в конфигах):**
- `mcp__4_5v_mcp__analyze_image` — анализ изображений по URL (PNG/JPG).
- `mcp__web_reader__webReader` — чтение URL в markdown/текст.

**Доступные MCP-серверы (плагины user scope, подключаются при старте сессии):**
- **context7** — дока внешних библиотек: `mcp__context7__resolve-library-id` → `mcp__context7__query-docs`. Плагин установлен и включён (`npx -y @upstash/context7-mcp`, требует Node/npx на PATH). Используй для свежей доки NestJS 11 / Prisma 7 / Next.js 16 / LiveKit и т.п. перед интеграцией или обновлением версии. **Не полагайся на память** по версиям API.
- **playwright** — проверка фронта (`browser_*`).
- **serena** — семантический анализ кода (LSP-based: поиск символов, навигация, рефакторинг), инструменты `mcp__serena__*`. Плагин установлен и включён, но запускается через `uvx` (`git+https://github.com/oraios/serena`) — **требует `uv` на PATH** (`brew install uv`). Если в сессии нет `mcp__serena__*` — сервер упал на старте с `spawn uvx ENOENT`.
- Встроенные MCP ZCode: `mcp__4_5v_mcp__analyze_image` (анализ изображений по URL), `mcp__web_reader__webReader` (чтение URL). Резерв для доки при недоступности context7: `WebSearch` / `web_reader`.
- **Гочча stdio-MCP и пропавший runtime:** MCP подключаются **только на старте сессии**. Если в сессии нет `mcp__context7__*` (runtime `npx`), `browser_*` (playwright) или `mcp__serena__*` (runtime `uvx`), а в `~/.zcode/cli/log/*` виден `spawn <runtime> ENOENT` + `toolCount: 0` — нужный runtime исчез с PATH. Чинить: `brew install node` (для npx) или `brew install uv` (для uvx/serena), затем перезапустить ZCode. Диагностика — скилл `zcode-guide:diagnosing-mcp`.

**vexp НЕ используется** (выпилен) — хуков/блокировок Grep/Glob нет. Изучай код обычными инструментами.

**Скиллы (ZCode-плагины, доступны через Skill tool):**
- `superpowers:*` — `brainstorming` (перед любой фичей), `systematic-debugging` (перед фиксом бага), `test-driven-development`, `writing-plans`, `executing-plans`, `verification-before-completion`, `requesting-code-review`, `using-git-worktrees` и др.
- `document-skills:docx` / `document-skills:pdf` — генерация документов.
- `skill-creator` — создание/правка скиллов.
- `zcode-guide:*` — диагностика конфигурации ZCode (команды, хуки, MCP, плагины, скиллы).
- Плагины `commit-commands`, `feature-dev`, `code-review` предоставляют агентов и команды (не скиллы).

**Установленные плагины (user scope):** `context7`, `superpowers`, `playwright`, `commit-commands`, `feature-dev`, `code-review`, `serena` (все `@claude-plugins-official`). Built-in: `document-skills`, `skill-creator`, `zcode-guide` (`@zcode-plugins-official`); `ios-simulator`/`android-emulator` suppressed.

### Под Claude Code (настройки в `.claude/`) — если запускаешь там

Эти инструменты и правила активны только в Claude Code, **не в ZCode**:
- **context7** (`resolve-library-id` → `query-docs`) — дока внешних библиотек.
- **playwright** (`browser_*`) — проверка фронта (прописан и в workspace `.mcp.json`).
- **`.claude/skills/`** (Claude Code, НЕ ZCode): `nestjs-rules`, `frontend-rules`, `frontend-design`, `impeccable`, `prisma-db-push-rules`, `safe-seed-rules`, `feature-analyst`, `solution-blueprint`, `tz-author`, `tz-orchestrator`, `project-architecture-router`, `domain-business-context`, `core-engineering-standards`, `strict-production-review-gate`, `qa-tester` и др.
- **Hooks** (`.claude/settings.json`): блокировка `git push` в main/master, `rm -rf /`, `DROP TABLE`; запрет `cat`/`Read` секретов; Stop-хук напоминает обновить `second-brain/`.
- **Цепочка планирования** (`feature-analyst` → `solution-blueprint` → `tz-author` → `tz-orchestrator`) — это Claude Code скиллы. Под ZCode те же принципы (план в `plans/` до кода, одобрение архитектуры ДО ТЗ) применяй вручную или через `superpowers:writing-plans` + `superpowers:brainstorming`. **Жёсткий gate сохраняется:** ТЗ не пишется без `plans/architecture/<feature>.md` со `status: approved`.

## Что читать перед задачей

1. Этот файл → [CLAUDE.md](CLAUDE.md) → [second-brain/index.md](second-brain/index.md).
2. Нужные файлы из `second-brain/01_projects/` и `plans/`.
3. Перед правками в чувствительных зонах — [second-brain/02_architecture/module-map.md](second-brain/02_architecture/module-map.md), [second-brain/02_architecture/knowledge-core.md](second-brain/02_architecture/knowledge-core.md), [docs/operations/prod-deploy-log.md](docs/operations/prod-deploy-log.md).
