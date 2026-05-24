---
type: tz
status: done
feature: infrastructure-deployment
date: 2026-05-06
---

# ТЗ: Инфраструктура и развёртывание Z (фаза 1)

> Анализ: `plans/analysis/2026-05-05-livekit-self-hosted-deployment.md`

## Цель

Поднять рабочую инфраструктуру Z на двух физических серверах в дата-центре Новосибирска. Состояние «можно создать комнату через LiveKit, подключиться двумя клиентами, провести встречу, получить общую запись и отдельные аудио-дорожки в Selectel Object Storage». Бэкенд — заглушка с health-check и webhook handler. Фронтенд, бизнес-логика встреч и AI — следующими ТЗ.

## Scope

**Входит:**
- Установка Proxmox VE (гипервизор) на оба сервера.
- Создание виртуальных машин под каждую роль (см. карту ниже), Ubuntu Server LTS внутри.
- LiveKit Server (SFU) + встроенный TURN с возможностью переключения на внешний.
- LiveKit Egress (запись).
- PostgreSQL, Redis, MinIO (для разработки), Prometheus, Grafana.
- NestJS-заглушка бэкенда: health-check, webhook handler с проверкой подписи и дедупом.
- DNS (5 поддоменов crossmark.ru + monitoring), сертификаты Let's Encrypt, nginx-reverse-proxy.
- Selectel Object Storage в зоне Новосибирск (`ru-7`), bucket `meetings-prod`.
- Базовые дашборды Grafana и алерты.
- End-to-end проверка: запись 5-минутной встречи между двумя клиентами, файлы оказались в Selectel, webhook `room_finished` дошёл до бэкенда.

**Не входит (отдельные ТЗ):**
- Бизнес-логика бэкенда (создание встреч через API, авторизация HMAC между Crossmark и Z, типы встреч, retention).
- AI-пайплайн (Vox + Claude Sonnet, цепочка из 4 этапов на BullMQ).
- Frontend на Next.js (страница встречи, ЛК, гостевой вход, карточка результата).
- Поднять руку, чат, screen-share UI — это уровень приложения, не инфры.

## Технические изменения

### Сервер A (медиа)

**Роль:** только медиа-плоскость. Не должен дёргаться при работе бэкенда / БД / записи.

Виртуальные машины:

| VM | vCPU | RAM | Диск | Назначение |
|---|---|---|---|---|
| `vm-livekit` | 12 | 24 GB | 80 GB | LiveKit Server (SFU) + встроенный TURN. Host networking — UDP-порты `7881-7882` (signalling) и `50000-60000` (RTC media). |
| `vm-system` | 1 | 2 GB | 20 GB | nginx-reverse-proxy, certbot, node_exporter (для Prometheus). |

Запас по серверу A: 13 vCPU из 28C, 26 из 128 GB. Под рост.

**Сетевая конфигурация:**
- Публичный IP на хосте Proxmox.
- VM-livekit получает публичный IP напрямую (host networking).
- VM-system на отдельном внутреннем IP, проксирует 80/443 к VM-livekit для wss.
- Firewall на Proxmox-хосте: открыть `80, 443 tcp`, `7881-7882 udp`, `50000-60000 udp`. Закрыть всё остальное снаружи.

### Сервер B (контроль и запись)

**Роль:** запись, бэкенд, базы, мониторинг.

Виртуальные машины:

| VM | vCPU | RAM | Диск | Назначение |
|---|---|---|---|---|
| `vm-egress` | 8 | 16 GB | 100 GB | LiveKit Egress (запись). |
| `vm-backend` | 4 | 8 GB | 40 GB | NestJS backend (health, webhooks). |
| `vm-postgres` | 4 | 8 GB | 200 GB | PostgreSQL 16. |
| `vm-redis` | 1 | 4 GB | 20 GB | Redis 7 (сессии LiveKit + BullMQ позже). |
| `vm-minio` | 2 | 4 GB | 500 GB | MinIO для dev/staging. |
| `vm-monitoring` | 2 | 4 GB | 100 GB | Prometheus + Grafana. |
| `vm-system` | 1 | 2 GB | 20 GB | nginx-reverse-proxy, certbot, node_exporter. |

Итого на сервере B: 22 vCPU / 46 GB / ~980 GB. Запас от 28 vCPU / 128 GB / дисков сервера — есть.

### DNS (под `crossmark.ru`)

A-records:
- `meet.crossmark.ru` → IP сервера B (frontend, в этом ТЗ ещё не разворачивается, но запись создаём).
- `api.crossmark.ru` → IP сервера B (backend).
- `media.crossmark.ru` → IP сервера A (LiveKit wss).
- `turn.crossmark.ru` → IP сервера A (на старте указывает туда же).
- `s3-dev.crossmark.ru` → IP сервера B (MinIO, доступен только из внутренней сети / VPN).
- `monitoring.crossmark.ru` → IP сервера B (Grafana, защищён basic-auth).

### TLS / сертификаты

- Let's Encrypt через `certbot --nginx` на обоих серверах (через VM-system).
- Если у компании есть API доступ к DNS-зоне crossmark.ru — wildcard `*.crossmark.ru` через DNS-01 challenge, иначе по одному сертификату на поддомен через HTTP-01.
- Автообновление через `certbot renew` в cron, дважды в сутки.
- Только TLS 1.2 и 1.3, отключить старые версии и слабые шифры.

### LiveKit Server

- Версия — фиксируем по тегу. Текущий stable на 2026-05 (проверить релизные ноты на наличие фикса по issue #1133 «Egress crackling Feb 2026», см. `code-pitfalls.md`).
- Конфиг `livekit.yaml`:
  - `port: 7880` (signalling).
  - `redis.address: vm-redis:6379`.
  - `keys: <api-key-для-backend>: <api-secret>` (генерируем свои, по 64 символа).
  - `webhook.urls: ["https://api.crossmark.ru/webhooks/livekit"]`.
  - `webhook.api_key: <api-key>` (для подписи).
  - `turn.enabled: true`, `turn.tls_port: 5349`, `turn.udp_port: 3478`.
  - `room.empty_timeout: 600` (10 минут).
- ENV для переключения TURN (на старте — встроенный):
  - `TURN_MODE=builtin`.
  - При `TURN_MODE=external` — конфиг переключает LiveKit на внешний TURN с `TURN_HOST/PORT/USERNAME/PASSWORD/TLS`.

### LiveKit Egress

- Один инстанс на vm-egress. Когда упрёмся в 80–90 одновременных записей — поднимаем второй.
- Версия — фиксируем тегом, тот же stable, что у LiveKit Server.
- Конфиг подключения:
  - `redis.address: vm-redis:6379`.
  - `api_key/secret` совпадают с LiveKit Server.
- Конфиг S3 — через ENV, агностичен:
  - `S3_ENDPOINT_URL=https://s3.ru-7.storage.selcloud.ru` (Selectel Новосибирск).
  - `S3_BUCKET=meetings-prod`.
  - `S3_ACCESS_KEY` / `S3_SECRET_KEY` — из секретов.
- На dev/staging переменные переключаются на MinIO (`https://s3-dev.crossmark.ru`).

### Selectel Object Storage

- Аккаунт в Selectel, выпуск ключей S3-API.
- Bucket `meetings-prod` в зоне `ru-7` (Новосибирск). Приватный, доступ только по подписанным URL.
- Lifecycle policy не настраиваем в этом ТЗ — будет в ТЗ на retention. Заложить место в конфиге.
- CORS — разрешить GET/PUT с `meet.crossmark.ru` для будущих presigned-загрузок.

### MinIO (dev/staging)

- Версия — последний stable.
- Bucket `meetings-dev`. Те же ключи API S3, что в проде в формате — код агностичен.
- Доступ только из внутренней сети / VPN.

### NestJS-заглушка бэкенда

В этом ТЗ — минимум:
- `GET /health` → `{ status: "ok", version: "0.0.1" }`.
- `POST /webhooks/livekit` →
  - проверка JWT в заголовке `Authorization` против `LIVEKIT_WEBHOOK_API_SECRET`,
  - проверка sha-256 тела (вшит в JWT),
  - дедуп по `event.id` через таблицу `webhook_seen_events(event_id PK, received_at)`,
  - на дубликат — 200 no-op,
  - в логи писать тип события и комнату.
- Без бизнес-логики встреч, без HMAC от Crossmark — отдельным ТЗ.

### Postgres

- Версия 16.
- База `z_main`, пользователь `z_app`.
- Таблицы в этом ТЗ:
  - `webhook_seen_events(event_id text primary key, event_type text, received_at timestamptz default now())`.
- Бэкап — `pg_dump` раз в сутки на `vm-system`, оттуда rsync в Selectel в bucket `db-backups`. Retention 14 дней.

### Redis

- Версия 7. Без persistence для MVP (LiveKit-сессии и BullMQ-очереди можно потерять при рестарте — пересоздадутся).

### Prometheus + Grafana

- Prometheus собирает метрики раз в 15 секунд:
  - node_exporter на каждой VM — CPU, RAM, диск, сеть.
  - LiveKit (встроенный endpoint `/metrics`).
  - Egress (встроенный endpoint).
  - postgres_exporter рядом с VM-postgres.
  - redis_exporter рядом с VM-redis.
  - NestJS — `@willsoto/nestjs-prometheus`, эндпоинт `/metrics` на бэкенде.
- Grafana дашборды:
  - **Хосты** (Proxmox A/B + все VM) — CPU, RAM, диск, сеть.
  - **LiveKit** — активные комнаты, активные участники, опубликованные треки video/audio/screen.
  - **Egress** — текущие задания, очередь, длительность задания, упавшие.
  - **PostgreSQL** — соединения, размер БД, slow queries.
  - **Redis** — память, операции/сек, длина очередей BullMQ (готовим под AI-пайплайн).
- Алерты в Grafana:
  - CPU >85% на любой VM в течение 5 минут.
  - Свободного диска <10%.
  - Egress upload failed.
  - LiveKit недоступен с healthcheck.
  - Алерты — пока в email админу. Telegram/PagerDuty — следующим ТЗ.
- Доступ: `monitoring.crossmark.ru` через basic-auth + IP allowlist (пока что только IP компании).

## Критерии готовности (DoD)

- [ ] Proxmox VE поднят на серверах A и B.
- [ ] Все виртуальные машины созданы по таблице, стартуют автоматически после ребута физ-сервера.
- [ ] DNS — все 6 поддоменов резолвятся в правильные IP.
- [ ] TLS-сертификаты валидные на всех 6 поддоменах, автообновление настроено и проверено `certbot renew --dry-run`.
- [ ] LiveKit принимает подключение через `wss://media.crossmark.ru` — проверено `livekit-cli` (это утилита командной строки от LiveKit для теста).
- [ ] Из `livekit-cli` создаётся room, подключаются 2 тестовых клиента, проходит звук и видео.
- [ ] Egress пишет общую запись (composite) в `meetings-prod` Selectel — файл доступен по подписанному URL.
- [ ] Egress пишет per-track audio (отдельная дорожка на каждого участника) в `meetings-prod` — каждый файл отдельным объектом.
- [ ] Webhook `room_finished` приходит на `https://api.crossmark.ru/webhooks/livekit` с валидной JWT-подписью, бэкенд возвращает 200, событие записано в `webhook_seen_events`.
- [ ] Дубликат того же webhook (повторно отправленный) не создаёт новой записи — 200 no-op.
- [ ] Grafana показывает дашборд с активными встречами — при подключении клиентов число растёт, при отключении падает.
- [ ] Backend `GET https://api.crossmark.ru/health` отвечает 200.
- [ ] PostgreSQL и Redis доступны с `vm-backend` по внутренней сети.
- [ ] MinIO работает на `s3-dev.crossmark.ru`, Egress переключается на него по смене ENV.
- [ ] Финальный тест — 5-минутная встреча с двумя живыми участниками, запись и аудио-дорожки видны в Selectel, аудио чистое (без потрескиваний — особенно проверить per-track), видео плавное.

## Риски и ограничения

- **Договор с Selectel** — оформление может занять несколько дней, не блокер для всей фазы инфры (можно сначала отладить на MinIO).
- **Сертификаты Let's Encrypt** — для `media.crossmark.ru` важно: сначала поднять nginx на 80 для HTTP-01 challenge, потом включить wss на 443. Иначе certbot не получит сертификат.
- **Egress «потрескивание» в свежих версиях** (issue #1133) — обязательно проверить per-track audio качество перед фиксацией версии. Если в текущем stable баг есть — откатиться на предыдущую версию.
- **Проксирование wss через nginx** — буферизация по умолчанию ломает websocket. Включить `proxy_buffering off`, `proxy_http_version 1.1`, `proxy_set_header Upgrade $http_upgrade`, `Connection "upgrade"`.
- **UDP firewall** — провайдер DC может ограничивать большие диапазоны UDP-портов. Подтвердить с инженерами DC возможность открытия `50000-60000` UDP до того, как ставить LiveKit.

## Фазы реализации

- [x] Фаза 1 — Proxmox VE на оба сервера, базовые виртуальные машины с Ubuntu Server LTS, ssh-доступ.
- [x] Фаза 2 — Сеть и firewall на Proxmox-хостах, проверка доступности с интернета.
- [x] Фаза 3 — DNS-записи, nginx на vm-system с обоих серверов, сертификаты Let's Encrypt.
- [x] Фаза 4 — PostgreSQL, Redis, MinIO. Schema `webhook_seen_events`, бэкап-скрипт.
- [x] Фаза 5 — LiveKit Server (vm-livekit) с встроенным TURN. Тест wss-подключения через livekit-cli.
- [x] Фаза 6 — Egress (vm-egress). Сначала с MinIO как S3, потом переключение на Selectel.
- [x] Фаза 7 — NestJS-заглушка с health и webhook handler. Тест webhook от LiveKit.
- [x] Фаза 8 — Selectel Object Storage, bucket, ключи API, переключение Egress на прод S3.
- [x] Фаза 9 — Prometheus + Grafana, дашборды, алерты в email.
- [x] Фаза 10 — End-to-end тест: 5-минутная встреча, проверка файлов в Selectel и качества аудио per-track.

## Итог

_(заполняется по факту: реализовано целиком или нет, что осталось)_

## Ревизия от 2026-05-24

**Статус:** done
**Реализовано:**
- LiveKit Server + встроенный TURN в `infra/livekit/livekit-dev.yaml`, `infra/livekit/docker-compose.yml`, `infra/livekit/livekit-dev.sh`.
- LiveKit Egress: `infra/livekit/egress.dev.yaml`, `infra/livekit/egress-dev.sh`, конфиг S3 переключается через ENV.
- PostgreSQL + Redis + MinIO подняты для dev через корневой `docker-compose.dev.yml`, для prod через `docker-compose.yml`.
- Webhook handler с проверкой подписи и дедупом в `backend/src/modules/webhooks/livekit-webhooks.controller.ts` + `livekit-signature.verifier.ts`; модель `WebhookSeenEvent` в `backend/prisma/schema.prisma`.
- Health-check и `@willsoto/nestjs-prometheus` метрики на бэкенде, конфиг через `TypedConfigService` (`backend/src/common/config/`).
- Запись композитная + per-track audio в S3-bucket работает (используется во всём AI-pipeline meetings → recordings → transcription).
- Grafana + Prometheus в `infra/`, дашборды задеплоены.
- DNS / TLS / nginx — настроены, продукт работает на prod-домене meet.crossmark.ru / api.crossmark.ru.
