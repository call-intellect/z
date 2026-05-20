---
type: история
date: 2026-05-20
---

# 2026-05-20 — Единый docker-compose деплой + чистка мусора/legacy + README

## Что было поставлено

1. Проанализировать проект, вычистить неработающий мусор и legacy-код.
2. Подготовить к деплою: nginx для хоста; порты проброса И порты приложений через `.env`.
3. Деплой максимально простой: `docker compose up -d --build backend`, без профилей.
4. README проекта: что это, какие задачи, локальный запуск, деплой на сервер.

## Как решал

Предыдущая сессия (`2026-05-20-docker-deploy-bun-runtime-deps-upgrade`) сделала split-деплой
(`deploy/backend/` + `deploy/frontend/`, запуск через `--env-file`). Эта сессия свела его к одному.

### Чистка (Фаза 1)
- Удалены бинари `infra/livekit/bin/*` (livekit-server.exe 33.5 МБ + livekit.zip 11.6 МБ + LICENSE) —
  LiveKit и так из Docker-образа. `start-livekit-windows.ps1` (dev Linux-only). Orphan `livekit-local.yaml`.
- Корневые черновики: `setup-claude-tools.md`, `2026-05-03-second-brain-setup...md` удалены;
  `llm-models-playbook.md` + `livekit_ai_meetings_final_solution.md` → `docs/reference/`.
- 3 stale-пути `c:\work\z\llm-models-playbook.md` в backend ai-services → `docs/reference/...`.
- `.gitignore`: игнор `*.exe/*.zip/*.dll/*.tar*`.

### Единый деплой (Фазы 2–4)
- Корневой `docker-compose.yml` (прод): `postgres+redis+migrate+backend+frontend`, без профилей,
  `env_file: .env`. YAML-anchor `*backend-build` дедуплицирует сборку образа для migrate+backend.
- Старый dev-root-compose → `docker-compose.dev.yml` (pg+redis+minio; livekit убран — он через `bun run livekit`).
- Корневой `.env.example` = backend.env.example + NEXT_PUBLIC_* + порты.
- Удалены `deploy/backend/`, `deploy/frontend/`.
- Медиа отдельно: `infra/livekit/docker-compose.yml` (livekit+egress+redis, network_mode host);
  `livekit.yaml`/`egress.yaml` стали прод-шаблонами (CHANGE_ME, use_external_ip:true).

### Порты через .env (Фаза 3)
Раздельно: app-порт (`PORT`/`FRONTEND_PORT`, что слушает контейнер) и host-порт
(`BACKEND_HOST_PORT`/`FRONTEND_HOST_PORT`, публикация на 127.0.0.1). Маппинг
`127.0.0.1:${HOST_PORT}:${APP_PORT}`. Проверено: с `BACKEND_HOST_PORT=8080 PORT=4000`
рендерится `published: 8080, target: 4000`.

### nginx + README + docs (Фазы 5–6)
- `deploy/nginx/*.conf`: порт upstream привязан к `.env`-дефолту (комментарием); добавлен
  `z-livekit.conf` (только signaling/WS, медиа UDP идёт мимо nginx).
- Корневой `README.md` (проект/задачи/dev/deploy). Обновлены `deploy/README.md`,
  `docs/architecture/deployment.md`, `CLAUDE.md`, `backend/README.md`, `tech-stack.md`.

### Мёртвый код (Фаза 7)
knip + ручная верификация. Удалены подтверждённые: `raw-body.middleware.ts` (заменён inline
`express.json({verify})` в `main.ts:27-30`), `prompts/chat.ts` (CHAT_V2 выключен).
Frontend-кандидаты оставлены на ревью.

## Что вышло (верификация)

- `docker compose config -q` — OK для root / dev / media.
- Подстановка кастомных портов из env работает (app + host раздельно).
- `backend tsc --noEmit` — 0 ошибок после удаления мёртвого кода.
- **Реальная сборка контейнеров:** `docker compose build backend|frontend` — оба образа
  собраны (exit 0). Frontend `next build` — 49 роутов, TypeScript ок, standalone-артефакт.
- **Реальный запуск стека:** `docker compose up -d backend` → postgres+redis healthy,
  migrate отработал (db push + apply-postgres-init), backend `Nest application successfully
  started`, очереди BullMQ in-process (8 core + 9 ai), `/health`=ok,
  `/health/ready` postgres+redis=ok (livekit=fail — не запущен). Frontend-контейнер — HTTP 200.

### Пойманные баги деплоя (исправлены)

1. **Prisma 7 убрал `--skip-generate` у `db push`** — `migrate` падал exit 1. Фикс: убрал флаг.
   Латентный баг с прошлой сессии (там валидировали только `compose config`, не запускали migrate).
2. **Пустые `MAIL_USERNAME=`/`MAIL_PASSWORD=` в .env.example ломали boot** — `min(1).optional()`:
   пустая строка != отсутствие ключа. Закомментировал в `.env.example`.

## Чему научился

- **knip на NestJS шумит предсказуемо:** провайдеры/DTO через DI и `nestjs-zod`/`swagger-ui-express`
  он метит как unused — это ложные срабатывания. Высокий сигнал — unused FILES + корреляция
  «unused-файл + unused-dep» (напр. `progress.tsx` + `@radix-ui/react-progress`). One-off
  `scripts/*` всегда unused — норма.
- **`raw-body` дважды:** был отдельный middleware И inline в main.ts — реальный дубль-legacy.
  При рефакторинге проверять, не остался ли старый механизм рядом с новым.
- **Порты «приложения» vs «проброса» — две разные оси:** удобно `127.0.0.1:${HOST}:${APP}`,
  оба из `.env`; healthcheck/EXPOSE должны использовать APP-порт, иначе ломаются при смене.
- **LiveKit отдельно — не каприз, а необходимость:** `network_mode: host` несовместим с
  bridge-сетью основного compose; плюс принцип #6 (своя нода). Объединять нельзя.
- **`compose config` ≠ рабочий деплой:** валидный YAML не значит, что контейнеры собираются
  и поднимаются. Прошлая сессия пропустила оба бага, проверив только конфиг. Деплой надо
  ПОДНИМАТЬ (build + up + health), а не только парсить.
- **Zod `.min(1).optional()` + env-строки:** в .env пустое `KEY=` — это пустая СТРОКА (валится
  на min), а не отсутствие ключа. Optional-поля в .env.example держать закомментированными.
- **Prisma 7 — ещё одна несовместимость CLI:** `db push --skip-generate` удалён (после $use,
  driver-adapter, url-в-config). При апгрейдах Prisma проверять CLI-флаги в скриптах/compose.

## Prod-операции

Полная инструкция — выдана в чат (см. ниже в сессии) и в `README.md`. Ключевое: схема
накатывается сервисом `migrate` (Prisma 7: `db push` + `apply-postgres-init`) до старта backend.
