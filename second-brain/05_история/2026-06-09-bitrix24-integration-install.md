---
date: 2026-06-09
title: Bitrix24 — установка интеграции + жизненный цикл токена
tags: [bitrix24, integration, oauth, knowledge-core, marketplace]
---

# Bitrix24 — установка интеграции + жизненный цикл токена

## Что было поставлено

Владелец: «полноценная интеграция с Битрикс24 — изучи API (установка из маркета,
получение/обновление токенов), сделай именно **установку интеграции для
компании**». Развилки (через AskUserQuestion): **оба способа** (OAuth-коннект из
Коры + установка из Маркета `ONAPPINSTALL`), **тиражное** приложение, объём —
**установка + жизненный цикл токена** (без синка данных).

## Как решал

1. **Исследование API Bitrix24** (WebSearch/WebFetch apidocs.bitrix24.com): OAuth-
   протокол (authorize → callback `?code&domain&member_id` → token endpoint на
   `oauth.bitrix.info`), refresh (180 дней, по требованию), `ONAPPINSTALL`
   (form-urlencoded `auth[...]` + `application_token`), iframe-handler +
   `BX24.installFinish()`.
2. **Прецеденты в коде** (vexp + Explore-агенты): `chatbox` — образец per-org
   интеграции (модель + sanitize + RBAC + feature + kill-switch + public webhook);
   `billing/tochka` — образец OAuth-редиректа (`@Res() res.redirect`, state+TTL);
   `crypto.service` (AES-256-GCM), `jwt.service` (подпись state), `env.schema` +
   `typed-config`.
3. **План** (одобрен) → реализация 6 фаз:
   - Ф0: модель `BitrixIntegration` (ключ `memberId`, `tenantId?`) + enum + миграция.
   - Ф1: ENV `BITRIX_CLIENT_ID/SECRET/OAUTH_BASE_URL` + `bitrix-api.client`.
   - Ф2: `bitrix-integration.service` + OAuth-коннект (authorize-url + public callback).
   - Ф3: install-events (`ONAPPINSTALL`/`ONAPPUNINSTALL`) + `claim`.
   - Ф4: RBAC `bitrix`, `feature.bitrix`, kill-switch `bitrix.enabled`, wiring в `app.module`.
   - Ф5: фронт (api/domain + секция на `/settings/integrations` + iframe `/bitrix/install`).
   - Ф6: тесты + verify + доки.

Коммит `bffdcfa7` (ветка `bitrix`), 27 файлов.

## Что вышло (верификация)

- backend typecheck/lint/build — зелёные; **17 unit-тестов** (`src/modules/bitrix/`)
  проходят (api-client: exchange/refresh/error-mapping; service: state, refresh-on-
  expired, claim/conflict, sanitize-no-leak).
- frontend typecheck/lint/build — зелёные; маршрут `/bitrix/install` собран.

## Чему научился (грабли)

- **Узел привязки для тиражного app:** установка из Маркета не знает `tenantId`
  Коры → паттерн `pending` (ключ `memberId`) + `claim` из iframe-handler
  (нужна сессия Коры в iframe = third-party cookie). OAuth-коннект из Коры проще —
  `tenantId` в подписанном `state`.
- **Dev shadow DB падает на `ag_catalog`** (AGE) → `prisma migrate dev` нельзя.
  Чистая дельта миграции: `prisma migrate diff --from-schema <git HEAD schema>
  --to-schema <current>` (без shadow, без дрейфа живой БД), затем ручная папка
  `migrations/<ts>_name/migration.sql`. `--from-config-datasource` НЕ годится —
  тянет дрейф dev-БД (велась через db push).
- **Safety-классификатор блокирует `migrate deploy`** на корневом `.env` (считает
  его продом) — для типизации/сборки применение к dev-БД не нужно (хватает
  `prisma generate`).
- `ENV` Bitrix положил в существующую `MaxBotChannelSchema` (как `CHATBOX_API_BASE_URL`)
  — в проекте избегают роста `.merge()`-цепочки `EnvSchema` (TS2589).
- `useConfirmDialog` отдаёт `ask` (не `confirm`); `ApiError` несёт `code`
  (`'unauthorized'` на 401), а не `status`; Badge не имеет `destructive`-варианта.
- `useSearchParams` требует Suspense при сборке → для чтения `?bitrix=` после
  редиректа использовал `window.location.search` в `useEffect` (как `NotificationsClient`).

## Дальше

Roadmap — [`plans/analysis/2026-06-09-bitrix24-next-steps.md`](../../plans/analysis/2026-06-09-bitrix24-next-steps.md):
Этап 1 — синк CRM-данных в knowledge-core (главный). Перед стартом — уточнить у
владельца приоритет сущностей и глубину истории.
