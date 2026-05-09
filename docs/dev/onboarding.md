# Онбординг разработчика — 5 шагов

## 1. Зависимости

```bash
# Установить bun (https://bun.sh)
curl -fsSL https://bun.sh/install | bash

# Установить Node 20 (lts)
nvm install 20

# Установить Docker Desktop (или нативный docker)
```

## 2. Клонировать репо и настроить ENV

```bash
git clone git@github.com:<org>/z.git
cd z

cp backend/.env.example backend/.env
# отредактировать DATABASE_URL, REDIS_URL, JWT_SECRET, LIVEKIT_*, S3_*, ANTHROPIC_API_KEY

cp frontend/.env.example frontend/.env.local
# отредактировать NEXT_PUBLIC_BACKEND_URL=http://localhost:3000
```

## 3. Поднять инфру (postgres + redis + minio)

```bash
cd backend
docker-compose up -d
```

## 4. Накатить схему БД и сиды

```bash
cd backend
bun install
bun run prisma:push
bun run prisma:seed     # промпты по типам встреч + дефолтный шаблон отчёта
bun run scripts/set-admin-password.ts admin@local.test admin12345
```

## 5. Запустить три процесса (три терминала)

```bash
# терминал 1 — backend HTTP
cd backend && bun run dev

# терминал 2 — AI-воркеры
cd backend && bun run worker:dev

# терминал 3 — frontend
cd frontend && bun install && bun run dev
```

Открыть http://localhost:3001, залогиниться через `/admin/login`
(`admin@local.test` / `admin12345`) или создать встречу через
Crossmark API (см. `docs/integrations/crossmark.md`).

## Полезные ссылки

- Архитектура: `second-brain/02_architecture/`.
- Бизнес-контекст: `second-brain/01_projects/`.
- ТЗ MVP: `plans/tz/2026-05-08-mvp-fullstack-tz.md`.
- API: http://localhost:3000/api/docs (Swagger UI).

## Тесты

```bash
# Backend
cd backend
bun run typecheck
bunx vitest run src       # unit
bunx vitest run test/e2e  # e2e (нужны postgres+redis+minio)

# Frontend
cd frontend
bun run typecheck
bun run build             # smoke-build
```
