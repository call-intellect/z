# ТЗ — Smoke-тест провайдеров: убрать ложные провалы (OpenAI 400) и починить недоставляемый алерт

> **Приоритет: 🟠 P2** (наблюдаемость; на конечного пользователя не влияет, но скрывает реальные сбои LLM-провайдеров и засоряет логи каждые 30 мин). Вскрыто ретестом №2 на проде ([plans/analysis/2026-06-07-retest2-RESULTS-technical.md](../analysis/2026-06-07-retest2-RESULTS-technical.md) §7).
> **Тип:** баг-фикс (backend). **Одна функция:** сделать `ProviderSmokeTestCron` правдивым и его алерт — доставляемым.

---

## 1. Проблема (что в логах)

Каждые ~30 минут в prod-логах:
- `[WARN] OpenAiProxyService  OpenAI-via-proxy complete (400): Invalid 'max_output_tokens': integer below minimum value. Expected >= 16, but got 8`
- `[WARN] ProviderSmokeTestCron  maybeAlertOnCall: sendNotification failed для <userId>: Bad Request Exception`

Итог: (1) OpenAI-провайдер **всегда** числится «упавшим» smoke-тестом (ложно-негатив), хотя реально работает; (2) когда после 3 провалов система пытается уведомить супер-админа — **уведомление само падает с 400** и не доставляется. То есть о **реальном** сбое провайдера админ тоже не узнает.

---

## 2. Корень (оба бага подтверждены кодом)

### Баг A — smoke-проба просит меньше токенов, чем разрешает OpenAI

[provider-smoke-test.cron.ts:113-120](../../backend/src/modules/admin/economics/provider-smoke-test.cron.ts#L113):
```ts
const out = await adapter.complete({
  provider: resolved.info,
  input: { system: {...}, user: SMOKE_PROMPT, maxTokens: 8 },  // ← 8
});
```
`maxTokens: 8` → в OpenAI-протоколе мапится в `max_output_tokens: 8`, а OpenAI требует **`>= 16`** → 400. Для OpenAI-family провайдеров smoke-тест падает структурно, а не из-за реальной недоступности. (Доп. нюанс: для reasoning-моделей `max_output_tokens` включает reasoning-токены — даже 16 может уйти в reasoning без видимого ответа → `success=false` «empty response». Нужен запас.)

### Баг B — алерт шлёт payload не по схеме `system.message`

[provider-smoke-test.cron.ts:195-201](../../backend/src/modules/admin/economics/provider-smoke-test.cron.ts#L195) (`maybeAlertOnCall`):
```ts
await this.conversational.sendNotification({
  eventType: 'system.message',
  payload: { kind, provider, streak, error, message },   // ← не те поля
  ...
});
```
`sendNotification` валидирует payload через `validateEventPayload('system.message', …)` ([conversational.service.ts:187](../../backend/src/modules/conversational/conversational.service.ts#L187)). Схема [`SystemMessagePayloadSchema`](../../backend/src/modules/conversational/types/event-payload.registry.ts#L37) — `.strict()` и требует:
```ts
{ title: string(1..200), body: string(1..8000), severity?: 'info'|'warning'|'error', actionUrl?: string }
```
Переданные `{kind, provider, streak, error, message}` — **лишние ключи + нет обязательных `title`/`body`** → Zod кидает `BadRequestException` (400). Тот же дефект в [`notifyRecovery`](../../backend/src/modules/admin/economics/provider-smoke-test.cron.ts#L213) (`{kind, provider, message}`) — но там ошибка тихо проглатывается `catch {}`.

---

## 3. Решение (decisive, минимальное)

### Фаза 1 — Правильный размер smoke-пробы

В [provider-smoke-test.cron.ts](../../backend/src/modules/admin/economics/provider-smoke-test.cron.ts): вынести в именованную константу и поднять выше floor OpenAI с запасом на reasoning-вывод:
```ts
private static readonly SMOKE_MAX_TOKENS = 64; // > OpenAI floor (16) + запас для reasoning-моделей
// ...
input: { system: {...}, user: SMOKE_PROMPT, maxTokens: ProviderSmokeTestCron.SMOKE_MAX_TOKENS },
```
Стоимость ничтожна (64 токена × N провайдеров × 48/сутки). 64 — баланс: гарантированно > 16 и оставляет место на «OK» у reasoning-моделей.

**Защитно (тот же класс — опц., рекомендуется):** в OpenAI-протокол-адаптере/`OpenAiProxyService` клампить `max_output_tokens` к минимуму провайдера (`Math.max(16, requested)`), чтобы любой вызов с маленьким лимитом не падал 400, а молча поднимался до floor. Это страхует не только smoke, но и любые будущие мелкие запросы. (Если делаем — добавить unit-тест на кламп.)

### Фаза 2 — Валидный payload алерта

`maybeAlertOnCall` — собрать payload по схеме `system.message`:
```ts
payload: {
  title: `LLM-провайдер ${providerName} недоступен`,
  body: `Провалил ${streak} smoke-теста подряд. Последняя ошибка: ${error}`,
  severity: 'error',
},
```
`notifyRecovery` — аналогично:
```ts
payload: {
  title: `LLM-провайдер ${providerName} восстановился`,
  body: `Провайдер ${providerName} снова отвечает на smoke-тест.`,
  severity: 'info',
},
```
Машинные поля (`kind`/`provider`/`streak`) при необходимости — НЕ в payload `system.message` (схема strict), а через метаданные нотификации, если контракт это поддерживает; иначе оставить их только в `title`/`body` (для MVP достаточно человекочитаемого текста). **Не расширять** `SystemMessagePayloadSchema` лишними полями — это общий контракт, менять его ради одного источника нельзя.

### Фаза 3 — Тесты

- Обновить [provider-smoke-test.cron.spec.ts](../../backend/src/modules/admin/economics/provider-smoke-test.cron.spec.ts): (a) при провале сверх порога `sendNotification` зовётся с payload, проходящим `validateEventPayload('system.message', …)` без throw; (b) `maxTokens` пробы = `SMOKE_MAX_TOKENS` (≥16).
- Если делаем кламп — unit-тест адаптера: `requested=8 → отправлено max_output_tokens=16`.

### Фаза 4 — Прочие prod-WARN из ретеста №2 (наблюдаемость, разбор по диспозиции)

Остальные повторяющиеся WARN, замеченные в `diag logs` за сессию. Не блокеры, но «найдено → зафиксировано»:

| WARN (источник) | Диспозиция |
|---|---|
| `OllamaService complete (401): Invalid API key format` (каждые 30 мин, из того же smoke-крона) | Ollama — tertiary safety-net [[feedback_ollama_tertiary_only_deepseek_flash_cheap]], но ключ невалиден → сеть не работает И шумит. **Сделать:** либо прописать валидный ключ/URL, либо если ollama в проде намеренно не настроена — **исключать неактивные/без-ключа провайдеры из smoke-обхода** (`runOnce` фильтрует по «есть кредлы»), чтобы не плодить ложные провалы и 401-шум. |
| `LegacyRouteConverter: Unsupported route path "/api/v1/*"` (Express 5 / path-to-regexp) | Deprecation: в Express 5 wildcard `*` требует имя (`/*splat`). Сейчас — только WARN, но сломается при следующем мажоре. **Сделать (low-prio):** найти регистрацию маршрута `/api/v1/*` (вероятно глобальный fallback/404-handler или статика) и привести к новому синтаксису. Отдельно от smoke — но в том же «наблюдаемость»-проходе. |
| `MeetingSpeakerAnalyzerWorker … невалидный JSON от LLM` и `IntakeAutoTriageWorker: LLM вернул невалидный JSON` (разово) | Тот же класс, что чинил ТЗ-3 (граф/роутер), но **в других воркерах** — у них свой parse без устойчивого `tryParseJson`/ретрая. **Сделать:** применить тот же паттерн (`tryParseJson` + ретрай/fallback) к speaker-analyzer и intake-auto-triage. Можно вынести в отдельную мелкую задачу, если разрастётся. |
| `LlmRouter dispatch fallback: deepseek-v4-flash … validate caller'а` — **высокая базовая доля** (7 fallback'ов на одну короткую встречу) | Фикс ТЗ-3 корректно ловит и достраивает на secondary (связи не теряются), **но каждый fallback = лишний LLM-вызов** (стоимость/латентность). Первопричина — flash слабо держит strict-JSON. **Рекомендация:** провести мини-e2e форс `tool_choice:{function}`+`function.strict:true` (ТЗ-3 Ф3, флаг сейчас OFF) и, если прокси принимает, включить — это срежет долю fallback'ов. |

> Эти пункты — **наблюдаемость/тех-долг**, не P0. Можно реализовать вместе с Фазами 1–3 (один backend-проход) или вынести часть в отдельную задачу — на усмотрение реализатора. Главное — не потерять (зафиксировано здесь и в реестре «не-сделано»).

---

## 4. Acceptance-сигнал (после выката)

1. В prod-логах за час **нет** `OpenAI-via-proxy complete (400): Invalid 'max_output_tokens'` и **нет** `maybeAlertOnCall: sendNotification failed`.
2. `diag logs --at-least WARN` — поток smoke-related WARN прекратился; `provider_smoke_test_success{provider="openai…"}` = 1.
3. Искусственный/реальный провал провайдера сверх порога → супер-админ получает `system.message` уведомление (in_app/email) — доставлено, не 400.

---

## 5. Объём / риски / прод

- **Минимальный**, backend-only. Фаза 1 — константа. Фаза 2 — собрать корректный объект. Фаза 3 — тесты. Кламп (опц.) — 1 строка + тест.
- Риск: низкий. `system.message` уже умеют рендерить in_app/email-адаптеры (проверено: [email-smtp.adapter.ts:142](../../backend/src/modules/conversational/adapters/email-smtp.adapter.ts#L142)).
- **Прод-операций нет** (рестарт backend `docker compose up -d --build`). ENV/миграций/seed — нет. (Если позже захотим вынести `SMOKE_MAX_TOKENS`/порог в `AdminSetting` — отдельная мелкая задача, см. [[feedback_admin_settings_not_env_or_code]]; для фикса не требуется.)

---

## Итог (реализовано 2026-06-07, feature/retest2-agent-chain-overhaul)
- [x] Фаза 1 — `SMOKE_MAX_TOKENS=64` + защитный кламп `max_output_tokens=Math.max(16, requested)` в `openai-proxy.service.ts`
- [x] Фаза 2 — валидный `system.message` payload (`title`/`body`/`severity`) в `maybeAlertOnCall` (`error`) + `notifyRecovery` (`info`); лишние ключи убраны
- [x] Фаза 3 — спека (5/5): проба с `maxTokens=64`, payload проходит `validateEventPayload('system.message')`, runOnce пропускает провайдер без baseUrl
- [~] Фаза 4 — частично: **сделано** — runOnce пропускает неконфигурированные провайдеры (пустой `baseUrl`). **НЕ сделано (в реестр «не-сделано»):** ollama-401 = прод-конфиг (валидный ключ/URL ИЛИ деактивация провайдера через админку — не код); Express 5 route `/api/v1/*`; JSON-устойчивость speaker-analyzer & intake-auto-triage; форс tool_choice (ТЗ-3 Ф3, нужен замер). Все — отдельные задачи (ТЗ это разрешает).
- [ ] Прод-проба: час без smoke-400/alert-fail в логах _(после выката)_
