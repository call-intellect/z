# ТЗ — Восстановить работу провайдера deepseek (регрессия от «restrict env fallbacks»)

- **Дата:** 2026-07-09
- **Ветка:** `work/2026-07-09`
- **Тип:** прод-фикс (регрессия). Источник — первый прогон стенда тестирования ([docs/testing/README.md](../../docs/testing/README.md)).
- **Парное ТЗ:** [2026-07-09-remove-dataclass-classification.md](2026-07-09-remove-dataclass-classification.md) (независимая вторая находка того же прогона).

---

## Симптом (прод-доказательство)
Живой smoke-test на проде (`POST /api/v1/admin/ai/smoke-test/:provider`, авторизован владельцем):

| провайдер | smoke-test |
|---|---|
| **deepseek** | ❌ FAIL «openai-chat: provider=deepseek требует apiKey» (3 мс — падает до сети) |
| openai-via-proxy | ✅ OK, реальный ответ GPT-4o (6.2 с) |

В логах за сутки — массовый WARN `LlmRouter dispatch fallback: deepseek требует apiKey`; весь конвейер вместо `deepseek-v4` (primary по стандарту) тихо идёт на `openai-via-proxy` (`gpt-5.4-mini`). Стандарт «deepseek primary» в проде фактически не действует.

## Корень (подтверждён кодом)
1. Ключ провайдера с 2026-07-08 берётся из БД-реестра `LlmProvider`, а ENV-фолбэк **отключён** коммитом `46e25c97` «restrict env fallbacks»: [provider-info.resolver.ts:119](../../backend/src/modules/ai/services/protocol-adapter/provider-info.resolver.ts#L119) → `buildFromEnvIfDbEmpty` ([:137](../../backend/src/modules/ai/services/protocol-adapter/provider-info.resolver.ts#L137)) отдаёт ENV-конфиг, **только если вся таблица `LlmProvider` пуста**. В проде реестр наполнен → ENV-ключ `DEEPSEEK_API_KEY` больше не подхватывается.
2. Строка `deepseek` в реестре (`GET /api/v1/admin/llm-providers`): `hasApiKey=false`, не проксируется. Итог: `provider.apiKey=''` → адаптер [openai-chat.adapter.ts:36-38](../../backend/src/modules/ai/services/protocol-adapter/adapters/openai-chat.adapter.ts#L36) бросает «требует apiKey».
3. До `46e25c97` пустую строку реестра маскировал ENV-ключ — поэтому «перестало работать» именно после того коммита, без изменения самого deepseek.
> Контраст: openai-via-proxy тоже `hasApiKey=false`, но работает — он аутентифицируется на стороне прокси (agent-lia), ключ строке не нужен. Значит проблема именно в способе аутентификации deepseek.

## Решение (рекомендую)
Идемпотентный патч-скрипт, заполняющий ключ deepseek в реестре из ENV — сохраняет модель «реестр = источник правды», не откатывает `46e25c97`:
- `backend/scripts/patch-populate-provider-key-deepseek.ts`: если `LlmProvider(name='deepseek')` с пустым `apiKeyEncrypted` И в ENV есть `DEEPSEEK_API_KEY` → зашифровать (`CryptoService`) и записать. Повтор = no-op. `createPrismaClient()` из `_lib/prisma.ts`.
- Зарегистрировать в `apply-prod-deploy.ts` STEPS (`phase:'patch'`, `skipBootstrap`).
- Кэш резолвера протухнет сам (TTL 60с) либо `invalidate()`.

**Развилка (решение владельца — как deepseek ходит в прод):**
- **A1 (по умолчанию):** прямой `api.deepseek.com` со своим ключом из ENV (текущий `DEEPSEEK_BASE_URL`) → патч выше как есть.
- **A2:** через тот же прокси, что openai (`useProxy=true`+`proxyPath`) — если своего платного ключа нет и ходим через agent-lia. Тогда патч ставит прокси-флаги, ключ у прокси.
- **Вопрос:** у нас есть прямой ключ deepseek (тогда A1) или ходим через прокси (тогда A2)?

## Верификация (что доказывает, что решило)
- `POST /api/v1/admin/ai/smoke-test/deepseek` → `status: ok` + осмысленный `reply`.
- Через ~5 мин: в логах нет WARN `deepseek требует apiKey`; в `diag.ts usage` появляются вызовы `provider=deepseek`.
- `GET /api/v1/admin/llm-providers` → deepseek `hasApiKey=true` (A1) или `useProxy=true` (A2).

## Прод-деплой (дифф)
Полная инструкция — [prod-deploy-log.md](../../docs/operations/prod-deploy-log.md). Дифф:
- **Шаг 6 (patch):** `bun run scripts/patch-populate-provider-key-deepseek.ts` — заполнить ключ deepseek из ENV (идемпотентно).
- **Шаг 12 (smoke):** `POST /api/v1/admin/ai/smoke-test/deepseek` → ok; логи чистые от `deepseek требует apiKey`.

## Фазы
- [ ] **Ф1 — Патч-скрипт** ключа deepseek + регистрация в STEPS + локальная проверка (что читает ENV, шифрует, идемпотентен). _(ждёт развилку A1/A2)_
- [ ] **Ф2 — Прод:** прогон патча + smoke-test зелёный + логи чистые.

## Открытая развилка для владельца
**A1 vs A2** — deepseek напрямую (свой ключ) или через прокси? По умолчанию беру A1.
