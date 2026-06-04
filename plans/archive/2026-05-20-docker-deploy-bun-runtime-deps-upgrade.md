---
type: tz
status: done
feature: docker-deploy-bun-runtime-deps-upgrade
date: 2026-05-20
---

> 📦 **АРХИВ (аудит 2026-06-04): ✅ реализовано — 95%.**
> Все технические цели реализованы и проверены по коду: полный переход на Bun (Dockerfile-ы на oven/bun, tsx/ts-node удалены), агрессивный апгрейд пакетов (Next 16, React 19, Prisma 7, zod 4, Tailwind 4, NestJS 11, ESLint 
> Полный разбор: `plans/analysis/2026-06-04-tz-audit-reestr-i-prioritety.md`


# ТЗ: Docker-деплой (backend/frontend раздельно) + полный переход на Bun + апгрейд пакетов

> Контекст: подготовка Z к развёртыванию через `docker compose`. Деплой backend и
> frontend — раздельный. Фронт (Next `output: 'standalone'`) запускается
> **контейнером** (`bun server.js`, 127.0.0.1:3001), **nginx на хосте** проксирует
> (как и backend). Рантайм — полностью **Bun** (последний). Пакеты — агрессивно
> до последних мажоров.
>
> NB: изначально планировался copy-to-host + systemd для фронта; по ходу решено
> упростить до контейнера (standalone — это всё равно живой процесс, копировать на
> хост незачем). В Dockerfile это стадия `runner`.

## Решения (согласовано с владельцем)

1. **Фронт:** Next `output: 'standalone'`. Контейнер собирает → артефакт
   (`server.js` + `.next/static` + `public` + минимальные `node_modules`)
   копируется в host-директорию `FRONTEND_DEPLOY_DIR` → `bun server.js` под
   systemd на `:3001` → nginx host reverse-proxy. Чистая статика (`output:
   'export'`) отвергнута: `middleware.ts` + динамические роуты (`/meetings/[id]`,
   `/m/[code]`, `/share/[token]`) + SSR несовместимы без переписывания.
2. **Пакеты:** агрессивно — Next 14→16, React 18→19, Prisma 5→7, zod 3→4,
   Tailwind 3→4, NestJS 10→11, ESLint 9 и т.д.
3. **БД/Redis:** внутри deploy-compose (pgvector + redis как сервисы с volume).
4. **Рантайм:** полностью Bun (prod-runner backend — был node:20 → bun; tsx/ts-node
   удалить, скрипты на bun).

## Фазы

> Все фазы выполнены и верифицированы (см. рефлексию `second-brain/05_история/2026-05-20-...`).

- [x] **Фаза 1 — Deploy-инфраструктура (additive).**
  - [ ] `backend/.dockerignore`, `frontend/.dockerignore`
  - [ ] `backend/Dockerfile` — runner на bun (был node:20), worker через ту же image
  - [ ] `frontend/Dockerfile` — multi-stage standalone build
  - [ ] `frontend/next.config.js` — `output: 'standalone'`
  - [ ] `deploy/backend/docker-compose.yml` — backend + worker + postgres(pgvector) + redis + migrate-init
  - [ ] `deploy/frontend/docker-compose.build.yml` — build-only → copy в host dir
  - [ ] `deploy/backend/backend.env.example`, `deploy/frontend/frontend.env.example`
  - [ ] `deploy/nginx/z-frontend.conf`, `deploy/nginx/z-backend.conf`
  - [ ] `deploy/systemd/z-frontend.service`
  - [ ] `deploy/README.md` — пошаговая инструкция деплоя
- [x] **Фаза 2 — Полный переход на Bun.**
  - [ ] backend package.json scripts: tsx/ts-node → bun
  - [ ] удалить devDeps `tsx`, `ts-node`, `ts-node-dev`
  - [ ] Dockerfile-ы на `oven/bun:1.3-alpine`
- [x] **Фаза 3 — Агрессивный апгрейд пакетов (риск).**
  - [ ] backend: NestJS 11, Prisma 7, zod 4 (+ nestjs-zod совместимая), Anthropic/OpenAI SDK, BullMQ, ESLint 9, …
  - [ ] frontend: Next 16, React 19, Tailwind 4, Radix latest, livekit latest, …
  - [ ] починить typecheck + build на обоих
- [x] **Фаза 4 — Dev-инструкция без контейнеров.**
  - [ ] `docs/dev/local-setup.md` (postgres/redis локально у разработчика)

## Верификация

- `cd backend && bun run typecheck && bun run build`
- `cd frontend && bun run typecheck && bun run build`
- `docker compose -f deploy/backend/docker-compose.yml build`
- `docker compose --env-file deploy/frontend/frontend.env -f deploy/frontend/docker-compose.build.yml build`

## Итог

_(заполняется по факту)_
