# Онбординг разработчика — dev-запуск без контейнеров

Рантайм проекта — **Bun** (Node не требуется). Postgres и Redis — **локально установлены**
на машине разработчика (не в контейнерах). Запускаем backend (HTTP) + worker (BullMQ) +
frontend как обычные процессы.

> Нужен только Docker? Нет. Для медиа (LiveKit/Egress) — опционально, см. конец файла.

## 1. Bun

```bash
curl -fsSL https://bun.sh/install | bash    # https://bun.sh
bun --version                                # ожидается >= 1.3
```

## 2. Postgres (с pgvector) + Redis — локально

Проекту нужен **Postgres с расширением pgvector** (граф знаний хранит embeddings).

```bash
# Postgres 16 + pgvector (Ubuntu/Debian)
sudo apt install -y postgresql-16 postgresql-16-pgvector redis-server

# Создать базу и пользователя
sudo -u postgres psql <<'SQL'
CREATE USER z_app WITH PASSWORD 'z_app_dev_password';
CREATE DATABASE z_main OWNER z_app;
\c z_main
CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector
SQL

# Redis — стандартный, без настройки
redis-cli ping   # PONG
```

Проверь, что слушают локально: Postgres `localhost:5432`, Redis `localhost:6379`.

## 3. ENV

```bash
cd backend
cp .env.example .env
```

Минимум, чтобы backend поднялся (валидация ENV строгая — падает на старте, если ключа нет):

| Ключ | Значение для dev |
|---|---|
| `DATABASE_URL` | `postgresql://z_app:z_app_dev_password@localhost:5432/z_main` |
| `REDIS_URL` | `redis://localhost:6379` |
| `JWT_SESSION_SECRET` / `JWT_DEEP_LINK_SECRET` | любые 32+ символа (`openssl rand -hex 32`) |
| `COOKIE_DOMAIN` | `localhost` |
| `PUBLIC_FRONTEND_URL` | `http://localhost:3001` |
| `WEBHOOK_SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` (base64 от 32 байт) |
| `LIVEKIT_*` | заглушки (`k`/`s`/`wss://media.local`), если не трогаешь встречи |
| `S3_*` | заглушки или локальный MinIO (см. ниже), если не трогаешь записи |
| `ANTHROPIC_API_KEY`, `VOX_API_TOKEN`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`, `GRSAI_API_KEY`, `KIE_API_KEY` | заглушки `x`, если не трогаешь AI-пайплайн |

> Заглушки проходят валидацию и дают приложению подняться. Реальные значения нужны
> только для соответствующих фич (AI-отчёт, запись, LiveKit-токены).

Frontend:
```bash
cd ../frontend
cp .env.example .env.local
# NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
# NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
# NEXT_PUBLIC_LIVEKIT_URL=wss://media.local   (заглушка для dev)
```

## 4. Схема БД + индексы + сиды

```bash
cd backend
bun install
bun run prisma:generate         # Prisma 7 Client
bun run prisma:push             # схема в z_main (db push, без migrate)
bun run apply-postgres-init     # HNSW/GIN-индексы pgvector (не в schema.prisma)
bun run prisma:seed             # промпты по типам встреч + дефолтные шаблоны (опц., нужен ADMIN_BOOTSTRAP_EMAIL)
```

## 5. Два процесса (два терминала)

AI/knowledge-core воркеры BullMQ работают **внутри** backend (in-process) — отдельный
worker-процесс больше не нужен.

```bash
# терминал 1 — backend: HTTP API (:3000) + воркеры BullMQ in-process
cd backend && bun run dev

# терминал 2 — frontend (:3001)
cd frontend && bun install && bun run dev
```

Открой http://localhost:3001. Swagger: http://localhost:3000/api/docs. Health: http://localhost:3000/health.

## Полезные команды

```bash
# Backend
bun run typecheck        # tsc --noEmit
bun run build            # tsc -> dist + копирование ассетов
bun run lint
bunx vitest run src      # unit
bun run prisma:studio    # UI инспекции БД

# Frontend
bun run typecheck
bun run build            # next build (standalone)
```

## S3 для dev (если нужны записи)

Заглушки в `S3_*` дают приложению подняться, но реальная загрузка записей требует S3.
Самый простой локальный вариант — один контейнер MinIO:

```bash
docker run -d --name z-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=z_minio_dev -e MINIO_ROOT_PASSWORD=z_minio_dev_password \
  minio/minio server /data --console-address ':9001'
# затем S3_ENDPOINT_URL=http://localhost:9000, ключи = z_minio_dev / z_minio_dev_password, S3_BUCKET=meetings-dev
```

## LiveKit для dev — реальное аудио/видео (опционально)

Нужен, только если работаешь с самими видеовстречами. Локальный LiveKit (single-node,
без redis) поднимается одним скриптом — **при первом запуске он сам скачает образ**:

```bash
infra/livekit/livekit-dev.sh up       # первый раз скачает образ LiveKit, затем стартует
infra/livekit/livekit-dev.sh status   # статус
infra/livekit/livekit-dev.sh logs     # логи
infra/livekit/livekit-dev.sh down     # остановить (rm — удалить контейнер)
```

Ключи/порт совпадают с `backend/.env` (`devkey` / `ws://localhost:7880`) — больше ничего
настраивать не нужно. После `up`: `/health/ready` покажет `livekit: ok`, и встреча на
`/m/<id>` даёт живое аудио/видео/screen-share.

> Конфиг — `infra/livekit/livekit-dev.yaml`. Egress (запись) для dev не обязателен —
> поднимается отдельно (см. `docs/architecture/deployment.md`).

## Ссылки

- Архитектура: `second-brain/02_architecture/`
- Бизнес-контекст: `second-brain/01_projects/`
- Деплой (prod, docker compose): `deploy/README.md`
