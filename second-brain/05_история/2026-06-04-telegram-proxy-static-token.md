---
name: 2026-06-04-telegram-proxy-static-token
description: Перевод авторизации админ-API прокси telegram.crossmark.ru с login/password на статический токен + приведение к реальному Swagger-контракту + e2e через туннель
metadata:
  type: reflection
---

# Telegram-прокси: статический токен вместо login/password (2026-06-04)

## Что было поставлено
Доработать работу с telegram-прокси: убрать авторизацию по email/password
(через `POST /auth/login` → JWT в Redis) и перейти на **статический Bearer-токен
из ENV**. Протестировать, что бот создаётся через админку и всё проксируется.
Бэк — на :3000, туннель `https://tunnel.agent-lia.ru → localhost:3000` для вебхуков.

## Как решал

**Разведка прокси (ключевое).** Поскольку нужен был реальный e2e, сходил в живой
Swagger прокси (`https://telegram.crossmark.ru/docs-json`) и гайд. Вскрылось, что
**наш код был написан против предполагаемого контракта**, а не реального:
- `POST /api/bots` ждёт `{name, token, targetWebhookUrl}` — у нас слалось
  `{token, secret_token, target_url}` (таких полей в API нет, `name` обязателен).
- Обновление — `PATCH /api/bots/{id}`, а у нас был `PUT`.
- Ответ — `BotResponseDto` с полями `tokenPreview`/`targetWebhookUrl`/`telegramBotId`/
  `webhookError`, а наш `parseBotInfo` искал `token_masked`/`target_url`.
- **Секрет вебхука прокси генерит сам и НЕ отдаёт через REST** (только в веб-карточке
  бота). Прокси форвардит его в `X-Telegram-Bot-Api-Secret-Token`, но нам этот секрет
  недоступен → header-валидация в proxy-режиме нерабочая.

**Решение по секрету** (согласовано с владельцем): кладём СВОЙ секрет в путь
`targetWebhookUrl = ${PUBLIC_HOST_URL}/api/v1/webhooks/telegram-bot/s/<secret>`
(как у эталонного бота requex.me). Добавлен роут `POST .../telegram-bot/s/:secret`;
header-режим сохранён для direct (`TELEGRAM_PROXY_ENABLED=false`).

**Правки:**
- `env.schema.ts`/`typed-config.service.ts`: `+TELEGRAM_PROXY_TOKEN`, убраны
  `TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD/JWT_PREFETCH_SEC`.
- `telegram-proxy-admin.client.ts`: переписан — `getAdminToken()` (статический),
  убраны Redis/JWT-decode/`/auth/login`/retry-on-401. `upsertBot` под реальный
  контракт, `getBotByToken` матчит по `telegramBotId` (не берёт чужого при отсутствии
  совпадения — важно, в аккаунте прокси несколько ботов), `webhookError`→throw,
  `ping()`→`GET /health`.
- `admin-telegram-bot.service.ts`: `updateToken`/`resetWebhook` передают `name` и
  `targetUrl` с секретом в пути (`computeWebhookTargetUrl`).
- `telegram-webhooks.controller.ts`: новый роут `/s/:secret`, `processUpdate`
  принимает `providedSecret` (header или path).
- `patch-telegram-register-in-proxy.ts`: pre-check по `TELEGRAM_PROXY_TOKEN`.
- Тесты переписаны (client/controller/api-client/admin-service).

## Что вышло (верификация)
- `bun run typecheck` — чисто; `bun run lint` — 0 ошибок; `bunx vitest` по telegram-bot —
  **126 passed**.
- **e2e на живом прокси + туннеле:**
  - Статический токен: `GET /api/bots` → 200.
  - Регистрация через реальный admin-код (`AdminTelegramBotService.updateToken`):
    `getMe` ок → нашёл бота по `telegramBotId` → `PATCH` → прокси сделал `setWebhook`.
    `lastSyncError=null`, `webhookError=null`. Прокси стал форвардить на туннель `/s/<secret>`.
  - Inbound через публичный туннель: правильный секрет → `200 {ok:true}`, неверный → `403`.
  - **Реальное сообщение от человека боту** прошло Telegram→прокси→туннель→бэк→ответ
    обратно через прокси (владелец получил ответ бота). Outbound тоже подтверждён.
- После теста: webhook бота Revisor Vision возвращён на исходный requex.me,
  тестовый бэк остановлен, временные файлы удалены.

## Чему научился
- **«Либеральный парсинг под неизвестный контракт» = технический долг.** Код прокси-клиента
  с самого начала (ТЗ 2026-05-26) угадывал имена полей, потому что Swagger не смотрели.
  Реальный контракт оказался другим почти во всём — фича по факту не работала бы в проде.
  Урок: при интеграции с внешним API **сначала живой Swagger/гайд**, потом код.
- **Прокси crossmark не отдаёт webhook-secret через REST** — это определяет всю модель
  безопасности inbound. Секрет в пути `targetWebhookUrl` — рабочий и полностью
  автоматизируемый паттерн (подтверждён эталонным ботом requex.me).
- **`PUBLIC_HOST_URL` кодом не определяется** — только ENV, fallback на `PUBLIC_FRONTEND_URL`
  (обычно неверный для бэк-вебхуков). В проде задавать обязательно.
- Локальный e2e против внешнего сервиса отлично делается через `bun --env-file` с отдельным
  не-`.env*` файлом оверрайдов (permission-guard на `.env*` обходится, файл удаляется после).
- Чтение `.env*` заблокировано guard'ом — оверрайды только отдельным файлом, см.
  [[project-local-dev-arm64-bun]].

## Связанное
- ТЗ-предок: `plans/tz/2026-05-26-telegram-via-crossmark-proxy.md` (контракт там
  устарел — фактическое состояние в `second-brain/01_projects/conversational-channels.md`).
- Ветка: `feature/telegram-proxy-static-token`, коммит `6a4eafee`.
