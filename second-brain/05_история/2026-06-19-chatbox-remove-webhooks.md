---
date: 2026-06-19
distilled: false
---

# ChatBox: убрать приём вебхуков — только суточный забор по AccessToken

## Что было поставлено

Владелец заметил постоянные 403 `chatbox_webhook_invalid_secret` (кейс «Ооо луа»)
и спросил: «мы же забираем всё по AccessToken — зачем вообще вебхук?». После
разбора архитектуры принял решение: **полностью убрать приём вебхуков**, оставить
только суточный забор по токену. Вебхук давал лишь «мгновенность» (триггер «иди
синкани»), но данные всё равно тянутся по AccessToken — мгновенность не стоила
операционной боли рассинхрона секрета URL↔БД.

## Как решал

Сначала через `vexp run_pipeline` (preset refactor) убедился, что webhook-контур
ChatBox **полностью изолирован**: контроллер `chatbox-webhook.controller.ts`,
методы `reconcile/ensure/removeWebhook` + `buildWebhookUrl` в
`chatbox-integration.service.ts`, методы `create/list/deleteWebhook` +
`ChatboxApiWebhook` в API-клиенте, и две колонки в БД. Нигде больше — ни во
фронте (визард хардкодит `daily`, realtime в UI не предлагается), ни в других
модулях.

Два решения у владельца (AskUserQuestion, рекомендации по-русски):
1. Внешние вебхуки на стороне ChatBox — **снять скриптом при выкате**.
2. Схему — **дропнуть только webhook-колонки**, `syncMode` оставить.

Реализация (backend-only):
- Удалил контроллер + спеку, снял регистрацию в `chatbox.module.ts`.
- Выпилил webhook-методы/вызов/cfg/randomBytes из `chatbox-integration.service.ts`,
  три метода + интерфейс из `chatbox-api.client.ts`, поправил спеку (`d2…` →
  4 webhook-теста убраны, `remove`-тест переписан под новое поведение).
- Схема: дроп `webhookSecret`/`webhookExternalId`, ручная миграция
  `20260619120000_chatbox_remove_webhooks` (DROP COLUMN ×2 + нормализация
  `syncMode`→`daily`).
- Скрипт `backfill-chatbox-unregister-webhooks.ts` + регистрация в STEPS.

## Что вышло

`prisma generate` ✓, `typecheck` ✓ (exit 0, без OOM с `--max-old-space-size=8192`),
`lint` ✓, `build` ✓, `vitest` chatbox ✓ (101 тест). Висячих ссылок на webhook-
символы по всему backend — ноль.

## Чему научился

1. **Порядок prod-деплоя решает дизайн cleanup-скрипта.** В `apply-prod-deploy.ts`
   SCHEMA PHASE (`migrate deploy`, дроп колонок) идёт **до** `backfill`-шагов.
   Значит cleanup-скрипт, который должен «снять вебхуки», НЕ может читать
   дропнутые `webhookExternalId`/`webhookSecret` — их уже не будет. Решение:
   скрипт находит наши вебхуки **через ChatBox API** (`listWebhooks` по
   `tokenEnc`+`workspaceId`, фильтр по URL/описанию), а не по колонке. Это
   сняло необходимость двухфазного (expand/contract) выката.

2. **Локальную миграцию иногда честнее писать руками.** `bun run prisma:migrate`
   (= `migrate dev`) требует доступную локальную БД + shadow DB, а на
   расходящейся истории может предложить destructive reset. При `DATABASE_URL`
   unset в шелле и хрупком локальном dev надёжнее отредактировать
   `schema.prisma` + руками создать `migration.sql` в формате существующих
   миграций (timestamp_name) + `prisma generate` (он БД не требует). Прод всё
   равно применит через `migrate deploy`.

3. **Декрипт токена в standalone-скрипте** — паттерн `new CryptoService(cfgStub
   as never)` со стабом `{ crypto: { masterKey: process.env.CRYPTO_MASTER_KEY }}`
   (прецедент `patch-encrypt-tochka-oauth.ts`). В скриптах `process.env` —
   допустимо (в `src/` — только через `TypedConfigService`).

4. **«Зачем вебхук, если есть токен» — частый архитектурный вопрос:** вебхук как
   триггер ≠ канал данных. Если данные всё равно тянутся pull-ом, push-триггер
   стоит держать только когда мгновенность реально нужна и его поддержка дешевле
   операционной боли.
