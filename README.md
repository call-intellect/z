# Z — AI-видеовстречи на LiveKit

Модуль AI-видеовстреч для SaaS: видео/аудио/screen-share на собственном движке
LiveKit, с автоматическим **AI-отчётом под тип встречи**. Вся бизнес-логика — на
нашем бэкенде; LiveKit отвечает только за медиа.

## Что решает

- **Видеовстречи до 10 участников** — аудио/видео/демонстрация экрана.
- **9 типов встреч** — формат отчёта зависит от типа (созвон 1:1, планёрка,
  интервью, продажи и т.д.). Это главное продуктовое отличие.
- **Гость без регистрации** — вход по ссылке, без выдачи секретов LiveKit.
- **Запись** — общая дорожка + отдельная аудиодорожка на каждого участника
  (нужно для качественного AI-анализа).
- **AI-отчёт** — пайплайн `запись → транскрибация (ASR) → разделение по спикерам
  → шаблон отчёта под тип встречи`.
- **knowledge-core** — ядро: из встреч строится граф идей/сущностей/тем
  (cross-meeting знания, RAG по эмбеддингам).

## Стек

| Слой      | Технологии                                                            |
|-----------|----------------------------------------------------------------------|
| Frontend  | Next.js 16 (App Router), React 19, LiveKit React Components, Tailwind |
| Backend   | NestJS 11, PostgreSQL 17 + pgvector, Redis (BullMQ), Prisma 7         |
| Медиа     | LiveKit Server (SFU), LiveKit Egress, TURN                           |
| Хранилище | S3-совместимое (Selectel / Yandex / MinIO)                          |
| AI        | ASR (Vox/GigaAM), Claude (Anthropic) + роутинг по провайдерам         |
| Рантайм   | **Bun** (dev и prod)                                                 |

Backend и frontend — отдельные приложения; AI/knowledge-core-воркеры BullMQ
работают **внутри backend-процесса** (отдельный контейнер не нужен).

Подробнее: [`second-brain/index.md`](second-brain/index.md),
[`CLAUDE.md`](CLAUDE.md), [`docs/architecture/deployment.md`](docs/architecture/deployment.md).

---

## Локальная разработка

Нужны: **Bun** (последний), **Docker** (для зависимостей и LiveKit).

### 1. Зависимости (Postgres + Redis + MinIO)

```bash
docker compose -f docker-compose.dev.yml up -d
# Postgres :55435 (pgvector), Redis :56381, MinIO :59000 (API) / :59001 (консоль)
```

### 2. Конфиг

```bash
cp backend/.env.example  backend/.env       # заполни (см. backend/src/common/config/env.schema.ts)
cp frontend/.env.example frontend/.env.local
```

### 3. Backend (HTTP API :3000 + воркеры in-process)

```bash
cd backend
bun install
bun run prisma:push        # накатить схему
bun run prisma:generate
bun run apply-postgres-init # pgvector-индексы (HNSW/GIN)
bun run dev                 # :3000, Swagger /api/docs
```

### 4. Frontend (:3001)

```bash
cd frontend
bun install
bun run dev
```

### 5. LiveKit для dev (опционально — нужен для видео)

```bash
bun run livekit            # поднимет LiveKit в Docker (образ скачается при первом запуске)
bun run livekit:down       # остановить
```

> Весь стек одной командой: `bun run dev` (из корня) — поднимает LiveKit + backend + frontend.

Полная инструкция: [`docs/dev/onboarding.md`](docs/dev/onboarding.md).

---

## Деплой на сервер

Топология: **nginx на хосте** терминирует TLS и проксирует на контейнеры backend
(`api.example.com`) и frontend (`meet.example.com`). Медиа-стек (LiveKit/Egress)
— отдельно (`media.example.com`). Backend/frontend слушают только `127.0.0.1`.

### 1. Backend + Frontend (один docker-compose)

> ⚠ **Предусловие — Postgres-расширения.** Backend требует **двух расширений**:
> `vector` (pgvector) и `age` (Apache AGE). Они подключаются в `backend/scripts/postgres-init.sql`
> через `CREATE EXTENSION IF NOT EXISTS …`.
>
> - **Self-hosted Postgres (composite-image из репо):** включено в образе — ничего делать не надо.
> - **Yandex Managed PostgreSQL 16:** оба расширения доступны как managed, но `age`
>   требует включения `shared_preload_libraries = 'age'` через UI/Terraform кластера + перезапуск.
>   Без этого `CREATE EXTENSION age` упадёт при первом запуске `apply-postgres-init`.
> - **Другой managed Postgres:** проверь доступность `age` 1.5.0 для PG16. Если нет — переходи
>   на self-hosted composite-образ (`infra/postgres/Dockerfile`).

```bash
cp .env.example .env
# Заполни секреты и порты. Сгенерируй ключи:
#   openssl rand -hex 32      → JWT_*, INGEST_INTERNAL_TOKEN
#   openssl rand -base64 32   → WEBHOOK_SECRETS_ENCRYPTION_KEY, CRYPTO_MASTER_KEY
# POSTGRES_PASSWORD должен совпадать с паролем в DATABASE_URL.

docker compose up -d --build backend     # postgres + redis + migrate + backend
docker compose up -d --build frontend    # Next.js standalone
# или всё сразу:
docker compose up -d --build
```

Что делает `backend`:
1. Собирает образ `z-backend:latest` (multi-stage, Bun).
2. Поднимает `postgres` (pgvector) + `redis`.
3. One-shot `migrate`: `prisma db push` + pgvector-индексы.
4. Стартует `backend` (HTTP + воркеры BullMQ in-process).

Проверка:
```bash
docker compose ps
curl -s http://127.0.0.1:3000/health        # {"status":"ok",...}
curl -s http://127.0.0.1:3000/health/ready  # postgres/redis/livekit
docker compose logs -f backend
```

Первый super-admin (если задан `ADMIN_BOOTSTRAP_EMAIL`):
```bash
docker compose run --rm backend bun prisma/seed.ts
```

Обновление:
```bash
git pull && docker compose up -d --build backend   # migrate прогонит db push заново
```

### 2. Порты — через `.env`

| Переменная           | Что задаёт                                  | Дефолт |
|----------------------|---------------------------------------------|--------|
| `BACKEND_HOST_PORT`  | публикация backend на `127.0.0.1` (для nginx) | 3000   |
| `PORT`               | порт backend ВНУТРИ контейнера              | 3000   |
| `FRONTEND_HOST_PORT` | публикация frontend на `127.0.0.1`          | 3001   |
| `FRONTEND_PORT`      | порт frontend ВНУТРИ контейнера             | 3001   |

> `NEXT_PUBLIC_*` вшиваются в бандл на СБОРКЕ. При смене URL — пересобери фронт:
> `docker compose up -d --build frontend`.

### 3. nginx на хосте

Конфиги — [`deploy/nginx/`](deploy/nginx/). Для каждого домена:
```bash
sudo cp deploy/nginx/z-backend.conf  /etc/nginx/sites-available/
sudo cp deploy/nginx/z-frontend.conf /etc/nginx/sites-available/
sudo cp deploy/nginx/z-livekit.conf  /etc/nginx/sites-available/   # если LiveKit на этой же ноде
sudo ln -s /etc/nginx/sites-available/z-backend.conf  /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/z-frontend.conf /etc/nginx/sites-enabled/
# Замени *.example.com на свои домены, затем:
sudo certbot --nginx -d api.example.com -d meet.example.com
sudo nginx -t && sudo systemctl reload nginx
```
> Если изменил `*_HOST_PORT` в `.env` — поправь `server 127.0.0.1:<порт>` в upstream.

### 4. Медиа-стек (LiveKit + Egress) — отдельно

LiveKit требует host-сети (UDP 50000–60000) и обычно живёт на своей VM.

```bash
cd infra/livekit
# Первый запуск на сервере: реальные YAML не отслеживаются git'ом.
cp livekit.yaml.example livekit.yaml
cp egress.yaml.example egress.yaml

# Заполни ключи/домен/S3 в livekit.yaml и egress.yaml (CHANGE_ME).
# Ключи должны совпадать с LIVEKIT_API_KEY/SECRET в .env backend.
docker compose up -d
```
nginx для signaling: `deploy/nginx/z-livekit.conf` (wss://media.example.com → :7880).
Медиа (WebRTC UDP) и TURN (5349/3478) идут напрямую — открой порты в фаерволе.

### 5. Порядок первого деплоя

1. DNS: `api`/`meet`/`media`.example.com → IP сервера.
2. Медиа-стек (раздел 4) → проверь `wss://media.example.com`.
3. Backend (раздел 1) → `/health`.
4. Frontend → `:3001`.
5. nginx + TLS (раздел 3).
6. Smoke: открой `https://meet.example.com`, залогинься, создай встречу.

### Частые проблемы

| Симптом | Причина / решение |
|---|---|
| LiveKit пишет `invalid API key` при `CreateRoom` | `LIVEKIT_API_KEY/SECRET` в `.env` backend не совпадают с `keys:` в `infra/livekit/livekit.yaml`; поправь реальные YAML на сервере и перезапусти media + backend |
| LiveKit падает с `TURN tls cert required` | включён встроенный TURN/TLS без `cert_file`/`key_file`; для старта оставь `turn.enabled: false` или пропиши реальные сертификаты |
| backend падает: «Невалидная конфигурация ENV» | не заполнен обязательный ключ в `.env` — смотри список в логе |
| `migrate` падает | postgres не готов / неверный `DATABASE_URL` (host = `postgres`) |
| фронт зовёт `localhost:3000` в проде | пересобери — `NEXT_PUBLIC_*` вшиваются на сборке |
| 502 от nginx | контейнер не запущен — `docker compose ps`, `docker compose logs` |
| видео не подключается | проверь медиа-стек, открытые UDP-порты и `LIVEKIT_*` ключи |

---

## Структура репозитория

```
backend/              NestJS API + воркеры (~45 модулей, knowledge-core — ядро)
frontend/             Next.js (App Router): ApiDto → DomainModel → UiModel
infra/livekit/        медиа-стек (LiveKit + Egress) + dev-скрипт
infra/                Prometheus / Grafana / loadtest / backup-скрипты
deploy/nginx/         конфиги nginx для хост-машины
second-brain/         источник правды о фактическом состоянии (архитектура, связи)
plans/                ТЗ и анализ фич
docs/                 deployment, runbooks, reference
docker-compose.yml        ПРОД: backend + frontend + postgres + redis + migrate
docker-compose.dev.yml    DEV: только зависимости (postgres + redis + minio)
.env.example              единый шаблон ENV для прод-деплоя
```
