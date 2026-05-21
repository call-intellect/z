---
type: architecture
---

# Tech Stack

## Frontend

- React / Next.js
- LiveKit React Components

**Домен:** `meet.crossmark.ru` (см. ниже § Поддомены).

**Страницы:**
- `/meetings` — список встреч пользователя (для тех, у кого есть учётка в Z).
- `/meetings/create` — создание встречи (выбор типа). Обычно вызывается из Crossmark; на странице сам тоже доступен.
- `/m/:id` — **одна ссылка на встречу.** И хост, и гости открывают её одинаково. Хост узнаётся по cookie (поставленному при первом входе через `?t=<jwt>` deep-link из Crossmark); гость видит форму «Введите имя».
- `/meetings/:id/result` — карточка встречи: запись, транскрипт, AI-отчёт.

Отдельной гостевой страницы (`/g/:token` и т.п.) **нет** — одна ссылка для всех, как в Zoom / Google Meet / Яндекс Телемост.

## Backend

- NestJS
- PostgreSQL
- Redis
- BullMQ (очередь задач поверх Redis — для AI-обработки после встречи)
- LiveKit Server SDK
- S3 SDK

**Зоны ответственности:**
- создание встречи и room в LiveKit
- генерация LiveKit-токенов (host / guest)
- проверка прав, роли, гостевые ссылки
- статусы встречи (FSM)
- запуск/остановка записи
- приём webhooks от LiveKit
- сохранение ссылок на записи
- запуск AI-обработки

## Рантайм и деплой (актуально на 2026-05-20)

- **Рантайм — Bun (последний, ≥1.3) везде:** dev, сборка и prod-runner. Node как
  prod-runner backend больше не используется. `tsx`/`ts-node` удалены — TS-скрипты
  (seed, apply-postgres-init, copy-assets) запускаются `bun`.
- **Сборка backend:** `tsc -p tsconfig.build.json` → `dist/`, затем `bun scripts/copy-assets.ts`
  копирует non-TS ассеты (RBAC `policies/*.conf|.csv`) в `dist/` — иначе `bun dist/main.js`
  падает на старте.
- **Деплой — единый корневой `docker-compose.yml`** (`docker compose up -d --build backend`,
  без профилей; полная инструкция — корневой [`README.md`](../../README.md), nginx —
  [`deploy/README.md`](../../deploy/README.md)):
  - backend — postgres(pgvector)+redis+migrate(one-shot)+backend в одном compose, Bun-образ;
    воркеры BullMQ работают IN-PROCESS внутри backend (AppModule импортирует WorkersModule) —
    отдельного worker-процесса/контейнера нет;
  - frontend — Next `output: 'standalone'` контейнером (`bun server.js`, 127.0.0.1:${FRONTEND_PORT}),
    тем же compose; nginx на хосте проксирует (как и backend);
  - порты публикации/приложений — через `.env` (`BACKEND_HOST_PORT`/`PORT`,
    `FRONTEND_HOST_PORT`/`FRONTEND_PORT`);
  - медиа-стек (LiveKit+Egress) — ОТДЕЛЬНЫЙ compose `infra/livekit/docker-compose.yml`
    (network_mode host, Linux-only), принцип #6 «не на одной ноде».
- **Версии (мажоры, после апгрейда 2026-05-20):** NestJS 11, Prisma **7** (driver adapter
  `@prisma/adapter-pg`, без Rust-движка; URL в `prisma.config.ts`, не в schema), zod 4,
  Next 16, React 19, Tailwind 4 (CSS-first, legacy-конфиг через `@config`), TypeScript 6,
  ESLint 10, vitest 4. Исключения: `@vidstack/react`/`media-icons` оставлены на текущих
  (npm `latest` у них ниже).

## Медиа

- LiveKit Server (SFU) — только аудио/видео/screen share/media routing
- LiveKit Egress — общая запись + отдельные аудиодорожки → S3
- TURN — отдельный сервис

## Storage

Решение от 2026-05-06: разные S3 для prod и dev/staging.

- **Prod:** Selectel Object Storage в зоне Новосибирска (наши сервера тоже в DC Новосибирска — S3-трафик не уходит на магистраль через Москву, записи и дорожки выгружаются на максимальной скорости). Записи и аудио-дорожки участников. Egress пишет туда напрямую.
- **Dev/staging:** локальный MinIO в отдельной VM на сервере B. Тот же S3 API → код агностичен; меняется только endpoint в env.

**Важно:** код взаимодействует с S3 через ENV (`S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`) — переключение между Selectel / Yandex / MinIO без правки кода (см. правило switchable endpoints в memory).

В БД храним только ссылки и метаданные, не файлы.

## AI

После встречи:
1. Забираем аудиодорожки из S3
2. Транскрибация
3. Склейка диалога по времени
4. Разделение по спикерам
5. Шаблон анализа по типу встречи
6. Сохранение результата в БД

**Провайдеров не выбираем — у компании свои внутренние API:**
- собственный ASR-API для транскрибации;
- собственный LLM-API для шаблонов по типу встречи.

Из задачи интеграции уходит вопрос «какой провайдер» — остаётся только формат вызовов и интеграция в пайплайн (см. `plans/analysis/2026-05-05-ai-pipeline-providers.md`).

## Поддомены (под `crossmark.ru`)

| Поддомен | Что | Видимость |
|---|---|---|
| `meet.crossmark.ru` | Frontend встреч (ЛК, комната, гостевой вход `/g/<token>`) | Пользователю |
| `api.crossmark.ru` | Backend (REST + webhook endpoint) | Только серверу |
| `media.crossmark.ru` | LiveKit SFU (wss://). Имя нейтральное — не светит «livekit» | Браузеру при подключении |
| `turn.crossmark.ru` | TURN (на старте → сервер A с встроенным LiveKit TURN; при coturn → переключается через ENV) | Браузеру при NAT |
| `s3-dev.crossmark.ru` | MinIO dev — только внутренняя сеть | Только разработчикам |

**Convention:** в LiveKit room names и API keys слово «crossmark» не используется — нейтральные UUID/идентификаторы. Если завтра уйдём с LiveKit на другой SFU — URL переезжает без редизайна.

**TLS:** Let's Encrypt через nginx + certbot на обоих серверах. Wildcard от платного CA — только если уже куплен у компании.

## Инфраструктурное правило

В production **не** ставить всё на один сервер. Разделять:
- LiveKit SFU
- Egress
- TURN
- Backend
- PostgreSQL
- Storage

Причина: запись съедает CPU и роняет качество звонков; одна общая нода = сложно искать причину проблем и невозможно масштабировать.

[[../index|← index]]
