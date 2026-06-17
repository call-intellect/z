# ТЗ: Интеграция Bitrix24 — установка + жизненный цикл токена

> Статус: **реализовано** (2026-06-09). Синк данных — отдельный следующий этап (не входит).
> План-источник: одобренный execution-план сессии 2026-06-09.

## Цель

Подключение портала Bitrix24 к компании (org) Коры с надёжным шифрованным
хранением и обновлением OAuth-токенов. Это фундамент под будущий синк CRM-данных
в knowledge-core. Покрыты **оба** способа установки тиражного (mass-market)
приложения.

## Объём (что входит)

- (A) OAuth-«Подключить» из UI Коры: ввод домена портала → редирект на authorize
  Bitrix → backend-callback меняет `code` на токены → сохранение per-org.
- (B) Установка из Bitrix24 Marketplace: приём `ONAPPINSTALL` (токены в `pending`)
  + iframe-handler внутри портала, который привязывает установку к org (claim) и
  вызывает `BX24.installFinish()`. Приём `ONAPPUNINSTALL` (подлинность по
  `application_token`).
- Шифрованное хранение `access+refresh` (+ `application_token`) — AES-256-GCM.
- Refresh по требованию (на протухшем токене), без крона (рекомендация Bitrix).
- «Проверка соединения» (`app.info`), отключение интеграции.

## Вне объёма

- Синхронизация данных Bitrix (контакты/сделки/пользователи → knowledge-core).
- Self-hosted (box) Bitrix — целевой контур только облако (`oauth.bitrix.info`).
- placement-виджеты (вкладки в карточках CRM).

## Опорные факты Bitrix24

- authorize: `https://{portal}/oauth/authorize/?client_id&state`; callback с
  `?code&domain&member_id&scope&state` (code живёт 30 сек).
- token: `GET https://oauth.bitrix.info/oauth/token/?grant_type=authorization_code|refresh_token&client_id&client_secret&...`
  → `{access_token, refresh_token, expires_in:3600, member_id, client_endpoint,
  server_endpoint, scope, ...}`. `refresh_token` живёт 180 дней.
- `ONAPPINSTALL` → POST form-urlencoded `event` + `auth[...]` + `application_token`.
- iframe-handler: POST `{PLACEMENT, AUTH_ID, member_id, DOMAIN, ...}`; обязателен
  `BX24.installFinish()`.

## Архитектура (реализовано)

**Данные** — `BitrixIntegration` (`backend/prisma/schema.prisma`), enum
`BitrixIntegrationStatus { pending connected error disconnected }`. Натуральный
ключ `memberId @unique`; `tenantId String?` (null пока `pending`). Токены —
`*Enc` (AES-256-GCM). Миграция `prisma/migrations/*_bitrix_integration`.
Уникальность «одна connected на org» — на уровне сервиса.

**Backend** (`backend/src/modules/bitrix/`):
- `bitrix-api.client.ts` — OAuth (exchange/refresh) + REST (`callMethod`,
  `getAppInfo`); `BitrixApiError{status,code,transient,isTokenExpired}`.
- `bitrix-integration.service.ts` — buildAuthorizeUrl / handleOAuthCallback /
  onAppInstall / onAppUninstall / claim / getValidAccessToken (refresh-on-expired)
  / testConnection / getIntegration (sanitize, без токенов) / remove.
- `bitrix-integration.controller.ts` (`CookieAuthGuard+TenantGuard`, RBAC
  `bitrix`, gate `feature.bitrix`): `GET /api/v1/bitrix/integration`,
  `GET .../authorize-url?domain=`, `POST .../test`, `POST .../claim`, `DELETE`.
- `bitrix-oauth.controller.ts` (public): `GET /api/v1/bitrix/oauth/callback` →
  redirect на `{frontend}/settings/integrations?bitrix=connected|error`.
- `bitrix-install.controller.ts` (public): `POST /api/v1/bitrix/install/event`
  (`ONAPPINSTALL`/`ONAPPUNINSTALL`), kill-switch `bitrix.enabled`, всегда 200.
- `bitrix.module.ts` → зарегистрирован в `app.module.ts`. Воркеры не нужны.

**Состояние/доступ**: state OAuth подписывается `JwtService.signBitrixState`
(TTL 15 мин). RBAC-ресурс `bitrix` (`policy.csv` + `RESOURCE_TYPES`). Фича
`feature.bitrix` (`tier-config.ts`, на всех тарифах). ENV `BITRIX_CLIENT_ID/
SECRET` + `BITRIX_OAUTH_BASE_URL` (`env.schema.ts`, геттер `cfg.bitrix`).

**Frontend**: `src/api/bitrix.api.ts`, `src/domain/bitrix.ts`,
`settings/integrations/BitrixIntegrationClient.tsx` (секция на странице
интеграций), iframe-handler `app/(public)/bitrix/install/page.tsx`.

## Фазы

- [x] Ф0 — Prisma-модель + enum + миграция.
- [x] Ф1 — ENV + config + API-клиент.
- [x] Ф2 — сервис + OAuth-коннект (способ A).
- [x] Ф3 — install-events + claim (способ B).
- [x] Ф4 — RBAC + entitlement + kill-switch + module wiring.
- [x] Ф5 — фронт (api/domain + секция + iframe install).
- [x] Ф6 — тесты + verify + документация.

## Верификация (выполнено)

- backend: typecheck/lint/build — зелёные; `bunx vitest run src/modules/bitrix/`
  — 17 тестов проходят (api-client + service).
- frontend: typecheck/lint/build — зелёные; маршрут `/bitrix/install` собран.

## Открытое / следующий этап

- Регистрация тиражного приложения в партнёрском кабинете Bitrix24 (client_id/
  secret → ENV; handler URL = `/bitrix/install`; install event →
  `/api/v1/bitrix/install/event`; redirect_uri → `/api/v1/bitrix/oauth/callback`).
  Финализировать `scope` (минимум `crm,user,profile`).
- Синк данных Bitrix → knowledge-core (отдельное ТЗ).
- Применить миграцию на dev/prod (на dev блокировал safety-классификатор; в прод —
  автоматически через `migrate deploy`).
