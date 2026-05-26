---
date: 2026-05-26
distilled: false
---

# Telegram-канал переведён на прокси telegram.crossmark.ru

ТЗ: [plans/tz/2026-05-26-telegram-via-crossmark-proxy.md](../../plans/tz/2026-05-26-telegram-via-crossmark-proxy.md).
Коммит: `b789d63` на ветке `telegram`.

## Что было поставлено

Backend Z живёт в ДЦ Новосибирска. Прямой канал `api.telegram.org` и
входящие webhook'и от Telegram нестабильны/недоступны. Прежняя реализация
бота (β-9 глобальный `@kora_bot`) технически работала только локально и
в Telegram-friendly локациях. Нужно было пустить весь Telegram-трафик
через прокси-сервис `telegram.crossmark.ru` (доку получил через WebFetch
`/guide`).

Пользователь явно сказал: «не привязывайся к текущей реализации, переделай
правильно с технической стороны». Это значит — не ограничиваемся
переключением `TELEGRAM_BOT_API_BASE`, а перерабатываем транспортный
слой полностью: outbound через прокси, inbound тоже через прокси
(прокси сам регистрирует у Telegram свой webhook), admin-API для
управления, observability, идемпотентный patch-скрипт, документация.

## Как решал

7 фаз, по плану в самом ТЗ §11. Кратко:

**Фаза 1 — конфиг.** Новый раздел `TelegramProxySchema` в
[env.schema.ts](../../backend/src/common/config/env.schema.ts) с
7 переменными (`TELEGRAM_PROXY_ENABLED` default true, `_API_BASE`,
`_FILE_BASE`, `_ADMIN_EMAIL`/`_PASSWORD` опц., `_JWT_PREFETCH_SEC`,
`_REQUEST_TIMEOUT_MS`, `_HEALTH_INTERVAL_SEC`). Геттер
`cfg.telegramProxy` в `TypedConfigService`. Заглушка
[telegram-proxy-admin.client.ts](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-proxy-admin.client.ts)
с `login()` (JWT-кэш в Redis `tg:proxy:admin:jwt` с TTL по `exp`) и
`ping()`. 11 unit-тестов.

**Фаза 2 — outbound.** Переписал `TelegramApiClient.call()` и
`downloadFile()` на `resolveApiBase()` / `resolveFileBase()`. Добавил
классификацию `outcome` для новых метрик `telegram_proxy_request_total`
(counter с лейблом `outcome ∈ ok|proxy_4xx|proxy_5xx|telegram_4xx|telegram_5xx|network`)
+ `telegram_proxy_request_duration_seconds` (histogram). Ключевое
различие: если ответ — JSON с полем `ok`, относим к Telegram; если
HTML/plain на не-2xx — относим к прокси. 8 unit-тестов.

**Фаза 3 — admin-клиент + patch-скрипт.** Расширил
`TelegramProxyAdminClient`: `upsertBot` (идемпотентен через
`getBotByToken` → POST или PUT), `getBotByToken` (либеральный парсинг
ответа: `id|_id|bot_id`, `target_url|targetUrl|webhook_url`),
`apiRequest` с retry-on-401 (один re-login через `forceLogin`).
Зарегистрировал в `conversational.module.ts` (providers + exports —
@Global модуль). Переписал `AdminTelegramBotService.resetWebhook`:
proxy-mode → `upsertBot`, legacy → старый `setWebhook`. Создал
[patch-telegram-register-in-proxy.ts](../../backend/scripts/patch-telegram-register-in-proxy.ts)
через `NestFactory.createApplicationContext(AppModule)` — переиспользует
существующие сервисы. Зарегистрировал в `apply-prod-deploy.ts` с
`phase: 'patch'`, `skipBootstrap: true`. +5 проверок в admin spec.

**Фаза 4 — invalidation кэша.** Это была главная скрытая ловушка.
`TelegramWebhooksController` держит `globalChannelCache` в памяти.
После ротации `webhookSecret` в админке без рестарта входящие
webhook'и продолжали бы проверяться против старого секрета и
отвергаться `invalid_webhook_secret`. Решение: общий топик
`conversational:channel:updated:telegram_bot` в новом
[topics.ts](../../backend/src/modules/conversational/topics.ts).
Контроллер в `onModuleInit` делает `redis.client.duplicate().subscribe(...)`
(отдельное соединение, т.к. ioredis блокирует канал после subscribe);
Admin-сервис publish'ит после **каждой** мутации `Channel.config`
(token/webhook/templates/status). +4 теста pub/sub invalidation.

**Фаза 5 — observability + frontend.** Новый
[telegram-proxy-health.cron.ts](../../backend/src/modules/conversational/adapters/telegram-bot/telegram-proxy-health.cron.ts) —
лидер-выбор через Redis `SET NX EX`, динамический интервал из ENV
(регистрация через `SchedulerRegistry`, потому что `@Cron` декоратор
не умеет в ENV-driven cron-expression). Новый эндпоинт
`POST /admin/system/telegram-bot/ping`. Поле `proxy.*` в
`getSettings` response (enabled, apiBase, healthy, botId,
registeredAt, lastSyncError). Frontend: `TelegramBotProxyStatusDomain`
с computed `trafficLight: green|yellow|red|gray`, новая секция
«Прокси telegram.crossmark.ru» в админ-странице.

**Фаза 6 — унификация.** `TelegramBotSender` и
`TelegramAdapterService` (ingest) переведены на единый
`TelegramApiClient`. Удалён дублирующий `callBotApi`. У `ingest` —
явный warn в `registerWebhook` при `proxy.enabled=true`, поскольку
прокси не пропустит per-source webhook для незарегистрированного
бота. На основной conversational-flow (`@kora_bot`) это не влияет.

**Фаза 7 — документация.** `second-brain/01_projects/conversational-channels.md`
расширен разделом «Транспорт Telegram через прокси».
`docs/operations/prod-deploy-log.md` — Шаг 1 (новые ENV), Шаг 6.11
(новый patch-скрипт), Шаг 12 (smoke прокси). `workers-queues.md` +
строка про `telegram-proxy-health` cron. ТЗ переведено в
`status: in_progress`, проставлены ✅ по фазам и заполнен §17 «Итог».

## Что вышло

- Backend `bun run typecheck && lint` — зелёные.
- Frontend `bun run typecheck && lint` — зелёные.
- 135 тестов в telegram-bot модулях + config — зелёные (включая 34 новых).
- Полный `bun run test:unit` — 2102 passed / 2 failed (оба pre-existing,
  не связаны с моими изменениями: один требует живую БД, второй —
  внешний DNS).
- Push на `origin/telegram` принят.

Оператору осталось:
1. Зарегистрировать аккаунт на https://telegram.crossmark.ru/register.
2. `TELEGRAM_PROXY_ADMIN_EMAIL/PASSWORD` в `.env` прода.
3. `docker compose exec backend bun run scripts/patch-telegram-register-in-proxy.ts`.
4. Smoke по Шагу 12.

## Чему научился

1. **ioredis pub/sub требует отдельное соединение** — `redis.client.duplicate()`.
   Если делать subscribe на основном клиенте, он перестаёт обслуживать
   обычные команды. В нашей `RedisService` нет API для второго клиента —
   потребители сами вызывают `duplicate()` (паттерн стоит закрепить
   в [[code-pitfalls]] если повторится в третьем месте).

2. **JWT кэш — обязательно в Redis, не в process-memory.** У Z воркер
   и HTTP-нода — разные процессы. Если кэшировать JWT в памяти —
   каждый процесс делает свой login → прокси может ввести rate-limit
   на login. Redis-кэш с TTL по `exp - prefetchSec` решает.

3. **Зачем `outcome` различает `proxy_*` vs `telegram_*`.** В инцидент
   on-call в 3 ночи должен моментально понять «прокси упал» или «Telegram
   через прокси вернул нам 429». Без разделения метрика
   `telegram_proxy_request_total{outcome=5xx}` ничего не говорит о виновнике.
   Маркер `ok: boolean` в JSON-ответе работает как «это Telegram-формат»
   — наличие = прокси отпроксировал.

4. **Pre-existing flaky тесты лучше явно отсеять `git stash` baseline'ом**,
   чем убеждать себя, что «они и так падали». Сделал быстро,
   сэкономил минут 20 сомнений: «не моих ли изменения сломали 7 файлов?».

5. **`@Cron`-декоратор не дружит с ENV-driven интервалами** — пришлось
   регистрировать вручную через `SchedulerRegistry.addCronJob`. Декоратор
   фиксирует выражение во время `reflect-metadata`, до запуска
   процесса. Если интервал меняется ENV-переменной — нужно императивно.

6. **Идемпотентные patch-скрипты надо ВСЕГДА регистрировать в
   `apply-prod-deploy.ts`** — иначе они забываются и оператор крутит
   их руками. CLAUDE.md `auto memory` правильно настаивает на этом
   шаге, я его не пропустил.

7. **`TELEGRAM_PROXY_ENABLED=false` как escape-hatch** — закладывать
   аварийный rollback на legacy direct mode по умолчанию — дешёво
   (ещё один if в `resolveApiBase()`), а в инцидент бесценно.
