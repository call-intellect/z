# Z — Деплой через Docker Compose

Раздельный деплой **backend** (контейнеры) и **frontend** (сборка в контейнере →
артефакт на хост → systemd + nginx). Рантайм — **Bun**. nginx живёт на хост-машине.

```
deploy/
├── backend/
│   ├── docker-compose.yml        # postgres(pgvector) + redis + migrate + backend (воркеры in-process)
│   └── backend.env.example       # → backend.env (секреты)
├── frontend/
│   ├── docker-compose.yml        # Next standalone контейнером (bun server.js)
│   └── frontend.env.example      # → frontend.env (NEXT_PUBLIC_* + FRONTEND_PORT)
└── nginx/
    ├── z-backend.conf            # host nginx → 127.0.0.1:3000
    └── z-frontend.conf           # host nginx → 127.0.0.1:3001
```

Топология: nginx(host) → `api.example.com` → backend-контейнер (:3000); nginx(host)
→ `meet.example.com` → frontend-контейнер (:3001). И backend, и frontend — контейнеры,
слушают только на 127.0.0.1, наружу публикует nginx с хоста. Postgres/Redis — внутри
backend-compose. LiveKit/Egress/TURN — отдельно (см. `infra/livekit/`).

---

## 1. Backend

```bash
cd deploy/backend
cp backend.env.example backend.env
# Заполни секреты. Сгенерируй ключи:
#   openssl rand -hex 32      → JWT_SESSION_SECRET, JWT_DEEP_LINK_SECRET, INGEST_INTERNAL_TOKEN
#   openssl rand -base64 32   → WEBHOOK_SECRETS_ENCRYPTION_KEY, CRYPTO_MASTER_KEY
# POSTGRES_PASSWORD в backend.env должен совпадать с паролем в DATABASE_URL.

docker compose --env-file backend.env up -d --build
```

Что произойдёт:
1. Соберётся образ `z-backend:latest` (multi-stage, Bun).
2. Поднимутся `postgres` + `redis` (с volume и healthcheck).
3. One-shot `migrate`: `prisma db push` (схема) + `apply-postgres-init` (HNSW/GIN-индексы pgvector).
4. После успешной миграции стартует `backend` (HTTP :3000 + воркеры BullMQ in-process).

Проверка:
```bash
docker compose --env-file backend.env ps
curl -s http://127.0.0.1:3000/health        # {"status":"ok","version":"..."}
curl -s http://127.0.0.1:3000/health/ready  # проверка postgres/redis/livekit
docker compose --env-file backend.env logs -f backend
```

Первый super-admin (если задан `ADMIN_BOOTSTRAP_EMAIL`):
```bash
docker compose --env-file backend.env run --rm backend bun prisma/seed.ts
```

Обновление backend:
```bash
git pull
docker compose --env-file backend.env up -d --build   # migrate прогонит db push заново
```

nginx на хосте:
```bash
sudo cp ../nginx/z-backend.conf /etc/nginx/sites-available/z-backend.conf
sudo ln -s /etc/nginx/sites-available/z-backend.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d api.example.com
sudo nginx -t && sudo systemctl reload nginx
```

---

## 2. Frontend

Фронт (Next.js `output: 'standalone'`) запускается **контейнером** (`bun server.js`),
слушает только `127.0.0.1:${FRONTEND_PORT}`; наружу публикует nginx с хоста.

```bash
cd deploy/frontend
cp frontend.env.example frontend.env
# Заполни NEXT_PUBLIC_* (вшиваются в бандл на сборке!) и FRONTEND_PORT.

docker compose --env-file frontend.env up -d --build
curl -s http://127.0.0.1:3001 | head         # фронт отвечает
```

> ⚠️ `NEXT_PUBLIC_*` встраиваются в бандл во время сборки. При смене URL-ов —
> пересобери: `docker compose --env-file frontend.env up -d --build`.

nginx на хосте:
```bash
sudo cp ../nginx/z-frontend.conf /etc/nginx/sites-available/z-frontend.conf
sudo ln -s /etc/nginx/sites-available/z-frontend.conf /etc/nginx/sites-enabled/
sudo certbot --nginx -d meet.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Обновление frontend:
```bash
git pull && cd deploy/frontend
docker compose --env-file frontend.env up -d --build
```

---

## 3. Порядок первого деплоя

1. DNS: `api.example.com`, `meet.example.com`, `media.example.com` → IP сервера.
2. LiveKit/Egress/TURN — `infra/livekit/` (см. `docs/architecture/deployment.md`).
3. Backend (раздел 1) → проверь `/health`.
4. Frontend (раздел 2) → проверь `:3001`.
5. nginx + TLS (certbot) для обоих доменов.
6. Smoke: открой `https://meet.example.com`, залогинься, создай встречу.

## 4. Частые проблемы

| Симптом | Причина / решение |
|---|---|
| backend падает на старте с «Невалидная конфигурация ENV» | не заполнен обязательный ключ в `backend.env` — смотри список в сообщении |
| `migrate` падает | postgres не готов / неверный `DATABASE_URL` (host должен быть `postgres`) |
| фронт зовёт `localhost:3000` в проде | пересобери — `NEXT_PUBLIC_*` вшиваются на сборке |
| 502 от nginx | контейнер (`z-frontend`/`z-backend`) не запущен — `docker compose ps`, `docker compose logs` |
