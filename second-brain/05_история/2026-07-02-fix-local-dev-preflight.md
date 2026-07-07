---
title: Починка локального запуска — preflight docker-зависимостей в bun run dev
date: 2026-07-02
tags: [dev-tooling, local-dev, wsl, docker, next-turbopack]
distilled: false
---

## Что было поставлено

`bun run dev` падал на старте:

```
[ioredis] Unhandled error event: Error: connect ECONNREFUSED 127.0.0.1:56381
[bootstrap] Не удалось запустить приложение: ... ioredis ... error: Connection is closed.
✖ Один из сервисов завершился — останавливаю стек.
```

Плюс шумный warning Next.js: `inferred your workspace root ... selected /home/tozix/package-lock.json as root` (multiple lockfiles).

## Как решал

Диагностика: `docker ps` — живы только `z-dev-postgres` и `z-dev-gepa`; `z-dev-redis` (Exited 255, ~35 ч назад) и `z-dev-minio` (Exited 255, ~5 дней) лежали. Логи чистые — не краши, а внешнее убийство (жёсткий рестарт WSL2). У всех сервисов `restart: unless-stopped`, но redis/minio после рестарта WSL не воскресли, а postgres/gepa вернулись — известный WSL2-квирк.

1. Немедленно: `docker compose -f docker-compose.dev.yml up -d` → все 4 healthy, `redis-cli ping` → PONG. Проверил бут backend: `/health` → `{"status":"ok"}`.
2. Preflight в [scripts/dev.ts](../../scripts/dev.ts): `ensureDeps()` перед стартом делает `docker compose -f docker-compose.dev.yml up -d postgres redis minio` и `waitForTcp` (node:net, poll 500ms, timeout 30s) на `REDIS_URL`. Только после готовности Redis спавнит back/front. Убрал устаревший docstring (описывал модель «Redis хостовый / только postgres из корневого compose» — по факту используется docker-compose.dev.yml) и inline-комментарии (жёсткое правило «без комментариев»).
3. `turbopack.root` в [frontend/next.config.mjs](../../frontend/next.config.mjs) = `fileURLToPath(new URL('.', import.meta.url))` (папка frontend). `fileURLToPath` вместо `import.meta.dirname` — портируется между Node20/Bun без завязки на версию.

## Что вышло

Живой прогон `bun run dev`:
```
▶ Поднимаю docker-зависимости (postgres/redis/minio)…
✓ Зависимости готовы (Redis localhost:56381)
✓ Ready in 287ms        ← фронт, warning про lockfile исчез
{"status":"ok"}         ← backend /health
```
Коммит `37d28ffc`, запушено в `fix/invite-password-existing-user-multi-org`. Prod-операций нет (dev-tooling).

## Чему научился

- **WSL2 + `restart: unless-stopped` ≠ гарантия воскрешения.** После жёсткого shutdown WSL контейнеры получают exit 255; часть сервисов (postgres/gepa) возвращается, часть (redis/minio) — нет. Надёжнее не полагаться на restart-политику, а делать preflight в самом dev-скрипте.
- **`turbopack.root` — штатное лекарство от «multiple lockfiles».** Чужой `/home/tozix/package-lock.json` в `$HOME` заставлял Turbopack выбирать домашнюю папку корнем workspace. Фикс — зафиксировать root, а не удалять внешний файл.
- **Модель локального dev по факту = docker-compose.dev.yml** (PG :55435, Redis :56381, MinIO :59000), а НЕ «postgres из корневого compose + хостовый Redis», как гласил старый docstring. Память [[project-local-dev-arm64-bun]] актуализирована.
