# ChatBox: убрать приём вебхуков — только суточный забор по AccessToken

Дата: 2026-06-19
Статус: в работе

## Цель

Полностью убрать realtime-синхронизацию ChatBox по вебхукам. Единственный способ
забора данных — суточный `ChatboxSyncCron` (полночь), который тянет всё по
AccessToken. Вебхук был лишь триггером «иди синкани» и нёс операционную боль
(403 `chatbox_webhook_invalid_secret`, рассинхрон секрета URL ↔ БД).

## Решения владельца

1. **Внешние вебхуки на стороне ChatBox** — снять скриптом при выкате
   (одноразовый backfill через ChatBox API), чтобы ChatBox перестал стучаться.
2. **Схема** — дропнуть только webhook-колонки (`webhookSecret`,
   `webhookExternalId`). Поле `syncMode` и enum `ChatboxSyncMode` оставить;
   существующие `realtime`/`hourly` строки нормализовать в `daily`. Фронт не
   трогаем (визард и так хардкодит `daily`, realtime в UI не предлагается).

## Порядок деплоя (важно)

`apply-prod-deploy.ts --with-schema`: сначала SCHEMA PHASE (`migrate deploy`
дропает колонки), затем `backfill`-шаги. Значит cleanup-скрипт **не читает**
дропнутые колонки — он находит наши вебхуки через ChatBox API
(`GET /workspaces/{ws}/webhooks` → фильтр по URL `/api/v1/webhooks/chatbox/` или
описанию «Кора (Z)» → `DELETE`). Зависит только от `tokenEnc` + `workspaceId`
(остаются).

## Фазы

### Ф1 — backend: удалить webhook-контур [x]
- Удалить `chatbox-webhook.controller.ts` + `.spec.ts`.
- `chatbox.module.ts`: снять импорт и запись в `controllers`.
- `chatbox-integration.service.ts`: удалить `reconcileWebhook`/`ensureWebhook`/
  `removeWebhook`/`buildWebhookUrl`, вызов в `upsert()`, чистку в `remove()`,
  поле `cfg` + импорты `randomBytes`, `TypedConfigService`.
- `chatbox-api.client.ts`: удалить `createWebhook`/`deleteWebhook`/`listWebhooks`
  + интерфейс `ChatboxApiWebhook`.
- `chatbox-integration.service.spec.ts`: убрать webhook-поля из `makeRow`,
  webhook-тесты, `cfgMock`, create/deleteWebhook из `clientMock`.

### Ф2 — БД [x]
- `schema.prisma`: убрать `webhookExternalId`, `webhookSecret` из
  `ChatboxIntegration`.
- Миграция `20260619120000_chatbox_remove_webhooks`: `DROP COLUMN` ×2 +
  `UPDATE "ChatboxIntegration" SET "syncMode"='daily' WHERE "syncMode"<>'daily'`.
- `prisma generate`.

### Ф3 — cleanup-скрипт [x]
- `scripts/backfill-chatbox-unregister-webhooks.ts` — self-contained
  (own fetch к ChatBox API, декрипт токена `CryptoService`-стабом),
  идемпотентный, не падает при ошибке отдельного орга.
- Регистрация в `apply-prod-deploy.ts` STEPS (`phase: 'backfill'`,
  `skipBootstrap: true`).

### Ф4 — верификация [x]
- `prisma:generate` ✓, `typecheck` ✓ (exit 0, без OOM), `lint` ✓, `build` ✓,
  `test:unit` chatbox ✓ (101 тест). Висячих ссылок на webhook-символы нет.

### Ф5 — документация [x]
- second-brain: `01_projects/chatbox-integration.md`, `02_architecture/module-map.md`,
  `data-model.md`, `01_projects/api-layer.md`.
- `docs/operations/prod-deploy-log.md`: блок 2026-06-19 (Шаг 4 + Шаг 8 + Шаг 11/12).
- Реестр не-сделанного — правок не требует (проблема решена, не отложена).
- Рефлексия — `second-brain/05_история/2026-06-19-chatbox-remove-webhooks.md`.

## Итог

**Реализовано целиком.** Приём вебхуков ChatBox удалён полностью; единственный
способ забора — суточный `chatbox-sync.cron.ts` по AccessToken. Backend-only
(фронт не тронут — визард и так хардкодил `daily`). Колонки
`webhookSecret`/`webhookExternalId` дропнуты миграцией, legacy `syncMode`
нормализован в `daily`. Внешние вебхуки на стороне ChatBox снимаются backfill-
скриптом при выкате. Сборка/типы/линт/тесты зелёные. Ждёт прод-выката
(`docker compose up -d --build backend` → migrate deploy авто + `apply-prod-deploy
--mode update` для backfill).
