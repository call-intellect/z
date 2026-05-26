---
date: 2026-05-26
type: рефлексия
session: ревизия prod-deploy-log.md под docker-compose + санитизация bun.lock
distilled: false
---

# Рефлексия — prod-deploy-log переведён на docker compose, lockfile очищен от npmmirror

## Что было поставлено

1. Полный локальный аудит проекта и smoke-запуск dev-стека (frontend + backend + LiveKit) на хост-машине с локальными Postgres/Redis.
2. Проверка docker-сборки prod-образов.
3. По итогам — выдать пользователю «полную инструкцию по обновлению на проде».
4. Когда выяснилось, что у пользователя на проде всё в `docker compose` — актуализировать `docs/operations/prod-deploy-log.md` под compose, зафиксировать правило, прорефлексировать.

## Как решал

### Локальный аудит
- Хост уже имел: Postgres 17 (5432), Redis 6379, LiveKit в Docker (7880). Установлены bun 1.3.13, Node 24, Docker 29.
- В `backend/.env` `DATABASE_URL` указывал на dev-контейнер `:55435` (pgvector/pgvector:pg17). Перевёл на хост-PG (`:5432`).
- Conflict при `prisma db push`: 10 legacy `Meeting` с `tenantId=NULL` (схема требует NOT NULL) + 5 новых UNIQUE constraints на 4 пустых таблицах (EntityLink/Goal/LlmTaskRoute/OrgInvitation). Бэкфилл существующим orgId + `--accept-data-loss` (после проверки count=0).
- **AGE-блокер.** Хост-PG 17 без AGE; apache/age master не компилится под PG17 (изменился API `index_beginscan`). Решение: поставил параллельный кластер PG16 на 5433 (`apt install postgresql-16 postgresql-16-age postgresql-16-pgvector`), `shared_preload_libraries='age'`, перенёс данные `pg_dump → pg_restore`, переключил `DATABASE_URL` на `:5433`.
- `apply-postgres-init.ts` под `z_app` падает на `LOAD 'age'` (требует SUPERUSER, либо preload). Запустил psql под `postgres` user через peer-auth (`sudo -u postgres psql -p 5433 -f /tmp/postgres-init.sql`), затем GRANT'ы на `ag_catalog` + `z_graph` для `z_app`.
- Backend `bun run dev` → `/health/ready` вернул `pg:ok, redis:ok, livekit:ok`. Frontend → HTTP 200.

### Docker build
- `docker compose build` упал: `bun install` в Alpine-контейнере выкинул `error: GET https://cdn.npmmirror.com/.../components-react-2.9.21.tgz - 404` — пакета на китайском зеркале уже нет.
- Проверил историю — был коммит `e1626cc fix(deploy): bun.lock на registry.npmjs.org`, но `grep -c npmmirror` показал, что в `frontend/bun.lock` осталось 659 ссылок, в `backend/bun.lock` — 933. Фикс был неполный (видимо, заменили только часть записей через sed).
- Создал `frontend/bunfig.toml` и `backend/bunfig.toml` с `[install] registry = "https://registry.npmjs.org"` и перегенерировал оба `bun.lock`. После этого `docker compose build` собрал все три образа (backend, frontend, postgres-age-pgvector:pg16). `docker compose up -d` — все 4 контейнера healthy.

### Перевод prod-инструкции на compose
- Пользователь спросил «могу ли обновлять прод» → выдал ему полную пошаговку.
- Пользователь напомнил, что у него прод в docker-compose, а в `prod-deploy-log.md` была смесь `cd backend && bun run ...` с `docker compose up -d --build`.
- Переписал `docs/operations/prod-deploy-log.md` целиком (~500 строк): все команды patch/seed/backfill/migrate/setup — через `docker compose exec backend bun run scripts/...`. Pre-up-сценарии (gate Шаг 3) — через `docker compose run --rm backend`. Бэкап БД — через `docker compose exec -T postgres pg_dump`. Рестарт — `docker compose up -d --build` (новый код) или `--force-recreate backend` (новый ENV). Добавил отдельный блок «Жёсткие правила формата команд» в раздел «Правила поддержки файла».
- В `CLAUDE.md` добавил предложение в Шаге 5 рефлексии: «ВСЕ команды этого файла — через `docker compose exec backend ...` или `docker compose run --rm backend ...`. Никаких прямых `cd backend && bun run ...`».
- Добавил Pre-flight 0.3 (lockfile-санитизация — проверка `grep -c npmmirror` = 0) — чтобы будущие коммиты не вернули китайское зеркало в `bun.lock`.

## Что вышло

- Локальный полный стек поднимается: dev (bun run dev) и compose (всё в контейнерах). `/health/ready` зелёный.
- Docker-сборка трёх образов прошла: `z-backend`, `z-frontend`, `z-postgres-age-pgvector:pg16`.
- `docs/operations/prod-deploy-log.md` теперь однородный — везде compose-команды.
- В `CLAUDE.md` зафиксировано правило «инструкция всегда через docker compose».
- В git готовы к коммиту: `backend/bunfig.toml`, `frontend/bunfig.toml`, `backend/bun.lock`, `frontend/bun.lock`, обновлённый `docs/operations/prod-deploy-log.md`, обновлённый `CLAUDE.md`, эта рефлексия.

## Чему научился

### Грабли для будущих сессий

1. **`bun.lock` с npmmirror — мина замедленного действия.** Если хоть один разработчик однажды запустил `bun install` с китайским зеркалом, lockfile сохраняет хост `cdn.npmmirror.com` для КАЖДОГО тарбола. На проде/в CI этот хост недоступен (или пакета там уже нет). Фиксить `sed`-ом по lockfile рискованно — надёжнее `rm bun.lock && bun install` с правильным `bunfig.toml` в репо.
2. **Apache AGE для PG17 пока нет.** Master не компилится (API `index_beginscan` сломан). PG16 + age 1.5-1.6 — стабильная связка; в проекте composite-образ `z-postgres-age-pgvector:pg16` это уже даёт. На хосте для dev — `apt install postgresql-16-age` (Ubuntu/Debian с pgdg-репо).
3. **`LOAD 'age'` требует SUPERUSER** (если age не в `shared_preload_libraries`). Лучше — `shared_preload_libraries='age'` + рестарт PG, тогда обычным юзерам `CREATE EXTENSION age` хватает.
4. **CHANGE_ME в `.env.example`.** 19 placeholder'ов: POSTGRES_PASSWORD, DATABASE_URL, JWT_SESSION/DEEP_LINK_SECRET, LIVEKIT_*, WEBHOOK_SECRETS_ENCRYPTION_KEY, IP_HASH_DAILY_SALT + 7 опциональных API-ключей (Anthropic/OpenAI/Vox/Kie/Grsai/Minimax/Deepseek). Backend стартует без последних, но обязательные секреты валидируются zod'ом и убивают процесс на старте.

### Правила для prod-инструкции (зафиксированы в `docs/operations/prod-deploy-log.md` → «Правила поддержки файла»)

| Что | Как |
|---|---|
| Patch/seed/backfill/migrate-скрипты | `docker compose exec backend bun run scripts/<file>.ts` |
| Pre-up gate (когда backend ещё не стартовал) | `docker compose run --rm backend bun run scripts/<file>.ts` |
| Schema | автоматически через `migrate`-сервис при `docker compose up`; вручную — `docker compose run --rm backend bun run apply-postgres-init` |
| Бэкап БД | `docker compose exec -T postgres pg_dump -U $POSTGRES_USER $POSTGRES_DB -Fc > backup.dump` |
| Подхват новой ENV | `docker compose up -d --force-recreate backend` (для NEXT_PUBLIC_* — `--build frontend`) |
| Новый код | `docker compose up -d --build backend` |

### Что НЕ делать

- ❌ `cd backend && bun run ...` в prod-инструкции — Z в проде целиком в контейнерах.
- ❌ `docker compose restart backend` после правки `.env` — `restart` НЕ перечитывает env_file; нужен `--force-recreate`.
- ❌ Локальный `pg_dump` через сетевой IP контейнера — внешний порт обычно не публикуется, всегда через `docker compose exec -T postgres`.
- ❌ Прибивать `bun.lock` к не-npmjs.org реестру без `bunfig.toml` в репо — следующий разработчик с другим registry создаст конфликт.

## Ссылки

- `docs/operations/prod-deploy-log.md` — обновлённая инструкция (~500 строк, всё через compose).
- `CLAUDE.md` → раздел «ВАЖНО: завершение работы и рефлексия» → Триггер 1 → Шаг 5 — добавлено правило про compose.
- `second-brain/02_architecture/age-deployment-decision.md` — почему PG16+age, а не PG17.
- Commit `e1626cc` (2026-05-21) — предыдущая попытка фикса bun.lock; была неполной.
