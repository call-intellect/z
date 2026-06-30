# Локальный запуск Коры (dev) — инструкция и журнал отладки

> Живой документ. Цель: поднять Кору локально на macOS, чтобы создавать пользователей,
> ходить по кабинету и тестировать. По мере запуска сюда дописываются найденные ошибки
> и их решения (раздел «Журнал ошибок»).
>
> Связано: [backend/README.md](../../backend/README.md) · корневой [docker-compose.dev.yml](../../docker-compose.dev.yml) ·
> прод-инструкция [prod-deploy-log.md](./prod-deploy-log.md).

## 0. Что решили (scope этого запуска)

| Развилка | Выбор |
|---|---|
| Что тестируем | **Кабинет без видеовстреч**: логин/регистрация, пользователи и команда, память (граф знаний), дашборд, AI-чат, трекер. LiveKit-видео не поднимаем. |
| AI-функции | **Реальные ключи** (Anthropic/Vox/DeepSeek/OpenAI через `proxy.agent-lia.ru`) — берём из прод-`.env`. |
| Данные | **Чистая БД + сиды** (первый админ, admin-settings, llm-task-routes, базовые справочники). Пользователей/встречи создаём руками. |
| Режим сейчас | **Гибрид**: зависимости (Postgres/Redis/MinIO) в Docker, backend+frontend нативно через Bun (быстрая отладка). |
| Финал | Весь стек в Docker (корневой `docker-compose.yml`) — отдельная фаза B (см. ниже). |

## 1. Главное предупреждение про `.env`

Корневой `/.env` настроен под **ПРОД** (`NODE_ENV=production`, `DATABASE_URL=…@postgres:5432`,
`REDIS_URL=…@redis:6379`, `COOKIE_DOMAIN=korateam.ru`, прод-S3/LiveKit, боевые секреты).
Он подаётся в прод `docker-compose.yml` и в корневой `bun run dev` (через `scripts/dev.ts` →
`--env-file=../.env`).

**Поэтому:**
- `bun run dev` из корня для локалки НЕ использовать — он потащит прод-конфиг.
- Корневой `/.env` не трогаем, не коммитим, не выводим.
- Локальный конфиг живёт в **`backend/.env`** (его Bun и Prisma CLI подхватывают автоматически
  из каталога `backend/`) и в `frontend/.env.local`. Оба в `.gitignore`.
- Локальный запуск — через `bun run dev:local` (лаунчер `scripts/dev-local.ts`, НЕ передаёт прод-`.env`).

Почему `NODE_ENV=development` обязателен локально: cookie сессии ставится с
`secure: !isDevelopment` (`backend/src/modules/accounts/unified-login.controller.ts:76` и др.).
При `production` кука `secure=true` и НЕ сохранится по `http://localhost` → логин «проходит, но
сразу разлогинивает». В dev `secure=false` → логин по http работает.

## 2. Предпосылки

- Docker Desktop (демон запущен).
- Bun ≥ 1.3 (`bun --version`).
- **psql-клиент** для агрегатора сидов: `brew install libpq` →
  `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"` (libpq keg-only, в PATH не симлинкуется сам).
- Порты свободны: `3000` (backend), `3001` (frontend), `55435` (PG), `56381` (Redis),
  `59000/59001` (MinIO). **На macOS все инфра-URL — через `127.0.0.1`, НЕ `localhost`**
  (localhost → IPv6 `::1`, а Docker публикует только IPv4).

## 3. Топология локального стека (гибрид)

```
браузер → http://localhost:3001  (Next.js dev, нативно)
frontend → http://localhost:3000 (NestJS API + воркеры in-process, нативно)
backend  → Postgres  127.0.0.1:55435   (Docker, образ PG16+pgvector+AGE)
         → Redis     127.0.0.1:56381   (Docker)
         → S3/MinIO  127.0.0.1:59000   (Docker, bucket meetings-dev)
         → AI: proxy.agent-lia.ru      (внешний, реальные ключи)
LiveKit  → не поднимаем (видеовстречи вне scope)
```

## 4. Шаги запуска (фаза A — гибрид)

### A1. Поднять зависимости в Docker
```bash
docker compose -f docker-compose.dev.yml up -d --build postgres redis minio minio-init
docker compose -f docker-compose.dev.yml ps     # все healthy
```
Первый раз собирается образ `z-postgres-age-pgvector:pg16` (PG16 + pgvector + Apache AGE) —
это минуты. `gepa` не нужен (prompt-evolution выключен).

### A2. Создать `backend/.env`
Локальный env = копия прод-`.env` с пропатченной инфраструктурой на localhost. Реальные AI-ключи
переносятся как есть. Делается скриптом-патчером (не печатает секреты): `scripts/make-local-env.ts`
(см. ниже, раздел «Артефакты»). Он:
- копирует `/.env` → `backend/.env`;
- переопределяет: `NODE_ENV=development`, `LOG_LEVEL=debug`, `DATABASE_URL`, `REDIS_URL`,
  `COOKIE_DOMAIN=localhost`, `COOKIE_STANDALONE_DOMAIN=localhost`, `PUBLIC_FRONTEND_URL=http://localhost:3001`,
  `S3_*` (MinIO), `LIVEKIT_API_URL=ws://localhost:7880`, `MAIL_DRY_RUN=true`, `TELEGRAM_PROXY_ENABLED=false`.

Локальные значения инфраструктуры:
| Ключ | Значение |
|---|---|
| `DATABASE_URL` | `postgresql://z_app:z_app_dev_password@127.0.0.1:55435/z_main` |
| `REDIS_URL` | `redis://127.0.0.1:56381` |
| `S3_ENDPOINT_URL` | `http://127.0.0.1:59000` |
| `S3_REGION` | `us-east-1` |
| `S3_BUCKET` | `meetings-dev` |
| `S3_ACCESS_KEY` | `z_minio_dev` |
| `S3_SECRET_KEY` | `z_minio_dev_password` |

### A3. Создать `frontend/.env.local`
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
NEXT_PUBLIC_LIVEKIT_URL=ws://localhost:7880
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3001
```

### A4. Зависимости и схема БД
```bash
cd backend
bun install
bunx prisma migrate deploy        # 0_init = полный снимок схемы → создаёт всё на пустой БД
bun run apply-postgres-init       # HNSW/GIN индексы + AGE-инфраструктура (не в schema.prisma)
bun run prisma:generate
```

### A5. Сиды (чистая БД)
```bash
cd backend
bun scripts/apply-prod-deploy.ts --mode bootstrap --continue-on-fail --no-fail-on-steps
```
Прогоняет: bootstrap-admin (из `ADMIN_BOOTSTRAP_EMAIL`), seed-llm-core (провайдеры/модели/цены/
13 промптов/дефолтные цепочки), seed-base (entitlements, retention, справочники, admin-settings).
Патчи/бэкфилы/миграции пропускаются (`skipBootstrap`).

### A6. Запуск
```bash
# из корня
bun run dev:local        # backend (без --watch) + frontend (next dev)
```
- backend → http://localhost:3000 (Swagger `/api/docs`, health `/health`, метрики `/metrics`)
- frontend → http://localhost:3001

> На arm64 backend идёт без `--watch` (bun --watch ломает трансляцию `as const`). После правок
> кода backend — перезапусти `bun run dev:local`. Frontend hot-reload работает.

### A7. Smoke-проверка
```bash
curl -fsS http://localhost:3000/health
curl -fsS http://localhost:3000/api/docs -o /dev/null -w "swagger:%{http_code}\n"
curl -fsS http://localhost:3001 -o /dev/null -w "frontend:%{http_code}\n"
```

### A8. Создать пользователей для теста
Три пути:
1. **Саморегистрация** — `http://localhost:3001/signup` (или `POST /api/v1/accounts/register`
   `{email,name,companyName,consentDataProcessing:true}`). При `MAIL_DRY_RUN=true` письмо НЕ уходит,
   а **печатается в логи backend** (шаблон `register-temp-password`) — оттуда копировать
   **временный пароль**. Затем вход на `/login` → форсится `/onboarding/change-password`
   (постоянный пароль) → `/onboarding/welcome` (6 шагов) → кабинет.
   Грепнуть пароль из логов: `grep -A3 "register-temp-password" <лог dev:local>` или ищи
   `Временный пароль:`.
2. **Инвайт в команду** — из кабинета владельца, ссылка `/invite/[token]` (magic-link в логах).
3. **Супер-админ платформы** — `http://localhost:3001/admin/login`, e-mail из `ADMIN_BOOTSTRAP_EMAIL`
   (создан сидом bootstrap-admin).

**Готовые аккаунты (логины/пароли) — в gitignored-файле `/.local-dev-accounts.md`** (корень репо).
Там: тест-юзер (owner орга с данными «Демо: ТехноСтрим» — 20 встреч + граф) и супер-админ для `/admin/login`,
плюс команды пересоздания. Пароли в git НЕ коммитим — только в этом локальном файле.
- Демо-данные живут в эталонной Demo-Org «ТехноСтрим» (сид `patch-create-reference-demo-org`, `ZDEMO_ORG_ID`).
- Завести вручную: пароль+супер-админ — `bun run scripts/set-admin-password.ts <email> <pwd> --super`;
  членство в орге — строка в `Membership` (`orgId`,`userId`,`role='owner'`). Это правки ЛОКАЛЬНОЙ БД, не код.

## 5. Фаза B — весь стек в Docker (финал, после стабилизации кабинета)

Корневой `docker-compose.yml` поднимает postgres+redis+migrate+backend+frontend. Для локального
прогона нужен локальный `/.env` (НЕ прод). Делать отдельной фазой — см. реестр не-сделанного.
Черновой набросок:
```bash
# отдельный локальный compose-env (НЕ перезаписывая прод /.env), затем:
docker compose --env-file .env.local.docker up -d --build
```
Детали и риски (NEXT_PUBLIC_* инлайнятся на сборке; migrate-сервис делает pg_dump-бэкап) —
дописать при выполнении фазы B.

## 6. Журнал ошибок и решений

> Пополняется по ходу запуска. Формат: дата · симптом · причина · решение.

| Дата | Симптом | Причина | Решение |
|---|---|---|---|
| 2026-06-28 | `prisma migrate deploy` падает на `20260627120000_partition_idea_block_entity_by_tenant`: `relation "IdeaBlock_pkey" already exists` (42P07) | `ALTER TABLE … RENAME TO …_old` в Postgres НЕ переименовывает индекс pkey → имя `IdeaBlock_pkey`/`Entity_pkey` занято при `ADD CONSTRAINT` на новой партиционированной таблице. Баг миграции (написана без локальной БД) — упал бы и на проде. | В ШАГ4/5 после ренейма добавлен `ALTER TABLE "*_old" DROP CONSTRAINT IF EXISTS "*_pkey"` (входящие FK уже сняты в ШАГ2). Затем `prisma migrate resolve --rolled-back …` + повторный `migrate deploy`. **Фикс нужен и для прод-выката.** |
| 2026-06-28 | `apply-prod-deploy.ts` падает: `Executable not found in $PATH: "psql"` | Агрегатор сидов создаёт ledger-таблицу через `psql`; на macOS-хосте клиента нет (скрипт рассчитан на docker-контейнер). | `brew install libpq` + `export PATH="/opt/homebrew/opt/libpq/bin:$PATH"`. Внесено в предпосылки. |
| 2026-06-28 | backend крэшится на старте: ioredis `Connection is closed` (хотя контейнеры healthy) | `localhost` на macOS резолвится сначала в IPv6 `::1`, а Docker публикует порт только на IPv4 `127.0.0.1`. ioredis/pg/AWS-SDK бьют в `::1` → отказ. (Prisma migrate через Rust-движок проходил по localhost.) | Инфра-URL в `make-local-env.ts` → `127.0.0.1` (`DATABASE_URL`/`REDIS_URL`/`S3_ENDPOINT_URL`). Перегенерить `backend/.env --force`. |
| 2026-06-28 | через `bun run dev:local` backend всё равно `Connection is closed` (а `bun src/main.ts` из `backend/` — ок) | `bun run dev:local` стартует родителя из корня → Bun авто-грузит корневой ПРОД `/.env` в `process.env` (`REDIS_URL=redis://redis:6379`, `DATABASE_URL=@postgres:5432`), а лаунчер отдавал `env: process.env` детям → прод перебивал `backend/.env`. | `dev-local.ts`: берём из `backend/.env` только имена ключей и **удаляем** их из наследуемого env backend-ребёнку — значения подставляет сам Bun из `backend/.env` (он корректно срезает кавычки/инлайн-комментарии). |
| 2026-06-28 | ENV-валидация падает: `MAIL_FROM invalid email`, `CLONE_V2_ENABLED expected boolean` и др. | Промежуточная версия лаунчера накладывала значения, распарсенные наивно (не срезая `"кавычки"` и `# инлайн-комментарии`, как делает Bun). | См. фикс выше — лаунчер больше НЕ парсит значения, только имена ключей. |
| 2026-06-28 | backend `EADDRINUSE` на :3000 | Порт 3000 держал осиротевший `next-server` соседнего проекта `sitekora/web` (PPID=1, без супервизора; ранее убивался только родитель `next dev`). | `kill -9 <pid next-server>`. Для Kora порт 3000 — дефолтный; если sitekora нужен — поднять его на другом порту. |
| 2026-06-28 | ✓ ИТОГ | — | Стек поднят: `/health` = `{"status":"ok"}`, Redis OK, `Nest application successfully started`, frontend HTTP 200. |

## 7. Траблшутинг (типовое)

- **`Невалидная конфигурация ENV`** при старте backend — не заполнен обязательный ключ.
  Обязательные без дефолтов: `DATABASE_URL`, `REDIS_URL`, `JWT_*` (≥32), `COOKIE_DOMAIN`,
  `PUBLIC_FRONTEND_URL`, все `LIVEKIT_*`, все `S3_*`, AI-ключи
  (`ANTHROPIC/VOX/OPENAI/DEEPSEEK/MINIMAX/GRSAI/KIE`), `WEBHOOK_SECRETS_ENCRYPTION_KEY` (base64 32 байта).
- **Логин «сбрасывается»** — `NODE_ENV` не `development` (secure-кука по http не сохраняется).
- **`ECONNREFUSED 127.0.0.1:55435`** — не подняты зависимости (`docker compose -f docker-compose.dev.yml ps`).
- **prisma `DATABASE_URL` не найден** — команды Prisma запускать из `backend/` (там `backend/.env`
  читается через `dotenv/config` в `prisma.config.ts`).
- **AI-вызов падает 401/403** — проверь, что реальные ключи перенесены в `backend/.env`.
- **`EADDRINUSE :3000/:3001` при перезапуске** — `next-server`/`bun` от прошлого запуска
  осиротел (PPID→launchd, переживает Ctrl+C лаунчера). Перед повторным `dev:local`:
  ```bash
  pgrep -f "next-server|src/main.ts|scripts/dev-local.ts" | xargs kill -9 2>/dev/null
  lsof -ti tcp:3000 tcp:3001 | xargs kill -9 2>/dev/null
  ```
  Отдельно: порт 3000 может занимать соседний проект (напр. `sitekora/web` next dev).
- **Swagger** доступен на `http://localhost:3000/api/docs` (health — `/health`, без префикса
  `/api/v1`). Глобальный префикс API — `/api/v1`.

## 8. Артефакты этой настройки

- `backend/.env` — локальный конфиг (gitignored).
- `frontend/.env.local` — frontend env (gitignored).
- `scripts/dev-local.ts` — лаунчер backend+frontend для локалки (использует `backend/.env`, не прод).
- `scripts/make-local-env.ts` — генератор `backend/.env` из прод-`.env` с патчем инфраструктуры.
- `package.json` → `dev:local`.
