---
type: история
date: 2026-05-20
---

# 2026-05-20 — Docker-деплой + полный bun-рантайм + агрессивный апгрейд пакетов

## Что было поставлено

1. Проанализировать проект и оценить готовность.
2. Подготовить к деплою через docker compose: backend и frontend раздельно; фронт
   собирается в контейнере → артефакт копируется в host-директорию из `.env`,
   запускается `bun server.js`, nginx на хосте.
3. Обновить все пакеты до последних мажоров (агрессивно).
4. Полностью перевести рантайм на Bun (последний).
5. Написать dev-инструкцию без контейнеров (Postgres/Redis локально).

## Как решал

### Деплой-инфраструктура (новая папка `deploy/`)
- `backend/Dockerfile` — переписан: runner с `node:20` → `oven/bun:1.3-alpine`;
  multi-stage (deps/builder/runner); в runner добавлены init-скрипты + `prisma.config.ts`.
- `frontend/Dockerfile` — новый, multi-stage, Next `output:'standalone'`; стадия `runner` (`bun server.js`).
- `frontend/next.config.js` — добавлен `output: 'standalone'`.
- `deploy/backend/docker-compose.yml` — postgres(pgvector)+redis+migrate(one-shot)+backend+worker.
- `deploy/frontend/docker-compose.yml` — frontend контейнером (`bun server.js`, 127.0.0.1:3001).
- `deploy/backend/backend.env.example`, `deploy/frontend/frontend.env.example` (полные шаблоны по env.schema).
- `deploy/nginx/{z-backend,z-frontend}.conf`, `deploy/README.md`.

> Изначально для фронта планировался copy-to-host + systemd; по ходу упростили до
> контейнера (standalone — живой процесс, копировать на хост незачем). nginx на хосте
> проксирует и backend (:3000), и frontend (:3001). Smoke: контейнер фронта отдаёт HTTP 200.
- `.gitignore` — игнор `deploy/**/*.env` (секреты).

### Полный переход на Bun (Фаза 2)
- `backend/package.json` scripts: `node`→`bun`, `tsx`→`bun`; удалены `tsx`/`ts-node`/`ts-node-dev`.
- Проверено эмпирически: `bun src/main.ts` и `bun src/workers/main.ts` поднимают NestJS
  (decorator metadata + DI работают под bun).

### Агрессивный апгрейд (Фаза 3)
Backend: NestJS 10→11 (Express 5), Prisma 5→7, zod 3→4, @anthropic-ai/sdk 0.30→0.97,
openai 4→6, TypeScript 5→6, ESLint 8→10, vitest 2→4, @types/node 20→25, helmet/argon2/bcrypt/др.
Frontend: Next 14→16, React 18→19, Tailwind 3→4, lucide 0.4x→1.x, sonner 1→2, tailwind-merge 2→3 и т.д.

Результат typecheck: backend — 14 ошибок в 4 файлах, frontend — 1 ошибка. Все починены:
- **Prisma 7** — driver-adapter миграция: `@prisma/adapter-pg`, `prisma.config.ts` (url вынесен
  из schema), `PrismaService` на `PrismaPg`, `$use` (удалён в v7) → `$on('query'|'warn'|'error')`.
- **zod 4** — `z.record(value)` → `z.record(z.string(), value)` (теперь требует ключ).
- **@types/node 25** — `Buffer` не входит в `BlobPart` → обёртка `new Uint8Array(buffer)`.
- **TS 6** — `moduleResolution=node10`/`baseUrl` deprecated → `ignoreDeprecations: "6.0"`.
- **lucide-react 1.x** — удалена бренд-иконка `Slack` → `MessagesSquare`.
- **Tailwind 4** — `@tailwindcss/postcss`, в globals.css `@import "tailwindcss"` + `@config`
  (legacy JS-конфиг сохранён без переписывания токенов).
- **ESLint 10** — flat config обязателен. backend: `eslint-plugin-import` (сломан в ESLint 10:
  `getTokenOrCommentBefore`) → `eslint-plugin-import-x`. frontend: `eslint-config-next` + FlatCompat
  падает на циклической ссылке → `@next/eslint-plugin-next` напрямую + ts-парсер + react-hooks.
- `@vidstack/react`/`media-icons` оставлены на текущих (npm `latest` у них ниже).

### Найденный блокер деплоя (предсуществующий)
`tsc` не копирует non-TS ассеты → собранный `bun dist/main.js` падал на `RbacService`
(`ENOENT policies/policy.csv`). Добавлен `scripts/copy-assets.ts`, вызывается из `build`.

### Dev-инструкция (Фаза 4)
`docs/dev/onboarding.md` переписан под bun-рантайм + локальные Postgres(pgvector)/Redis без контейнеров.

## Что вышло (верификация)

- Backend: `typecheck` 0, `build` 0, `bun dist/main.js` **полностью поднял приложение** под bun
  (подключился к локальным Postgres+Redis, "Nest application successfully started"). Express 5
  wildcard-роуты (`forRoutes('*')`) работают без правок. `bun run lint` функционирует (66 находок
  новых правил — оставлены команде, 118 авто-фиксимы).
- Frontend: `typecheck` 0, `next build` 0, standalone `server.js` + CSS (90KB, токены на месте), `lint` 0.
- Docker: образ `z-backend:latest` собран (1.6GB). Frontend builder-образ собран. BuildKit требует
  `--network=host` в этом окружении.
- Compose-файлы валидны (`docker compose config`).

## Чему научился

- **Prisma 7 — это архитектурная миграция, не bump:** Rust-движок убран, обязателен driver adapter
  + `prisma.config.ts`; `url` запрещён в schema; `$use` удалён. `prisma generate` не должен требовать
  DATABASE_URL — в config используем `process.env['DATABASE_URL'] ?? ''`, иначе Docker-сборка падает.
- **`tsc` не копирует ассеты** — любой `readFileSync(join(__dirname, ...))` на non-TS файл ломает
  собранный артефакт. Нужен явный шаг копирования (или inline, как сделали с mail-шаблонами).
- **ESLint 10 экосистема ещё догоняет:** `eslint-plugin-import` и `eslint-config-next` несовместимы;
  лечится `import-x` и прямым `@next/eslint-plugin-next`.
- **«Latest» ≠ всегда выше:** `@vidstack/react`/`media-icons` в npm `latest` ниже установленных — проверять перед бампом.
- **Bun тянет весь NestJS-стек** (HTTP + worker, прод-рантайм) — Node как prod-runner не нужен.

## Worker DI: рефакторинг wiring (после локальной верификации)

При локальном запуске с валидным `.env` всплыло: `bun run worker:dev` не стартовал — NestJS 11
строгий DI. `WorkersModule` (root) перечислял сервисы локально, а `@Global KnowledgeCoreModule`
их не видел (на HTTP давал `@Global AiModule`, в воркере его нет). Каскад: LlmRouter → Embedding
→ CoreQueue → Entitlement/Quota → auth-guard'ы контроллеров knowledge-core.

Починено (логика сервисов не менялась, только проводка):
- `LlmRouterGlobalModule`, `EntitlementGlobalModule` — узкие @Global-обёртки для воркера.
- `EmbeddingsModule` → `@Global`; в WorkersModule импорт `CoreQueueModule` + `QuotasModule` вместо локальных провайдеров.
- Контроллеры knowledge-core вынесены в `KnowledgeCoreApiModule` (HTTP), `KnowledgeCoreModule` — только сервисы (@Global) → воркер их не инстанцирует.

**Верификация:** `bun run worker:dev` И `bun dist/workers/main.js` (прод-путь) стартуют, BullMQ
зарегистрировал все очереди (`ai.*`, `core.*`, `clip.render`, `webhook.delivery`, `export`). HTTP —
229 роутов замаплено, knowledge-контроллеры на месте. typecheck/build/lint без новых ошибок.
Детали — `02_architecture/code-pitfalls.md` §7.

## Prod-операции

Деплой описан в `deploy/README.md`. Особенность Prisma 7: схема накатывается сервисом `migrate`
(`prisma db push` + `apply-postgres-init`) до старта backend/worker.
