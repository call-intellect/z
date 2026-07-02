---
type: reflection
date: 2026-06-29
distilled: false
---

# 2026-06-29 — Помощник «временно недоступен»: DeepSeek-first для всех классов данных + крутилка таймаута KIE

## Постановка

ТЗ [`plans/tz/2026-06-29-chat-v2-dataclass-routing-fallback.md`](../../plans/tz/2026-06-29-chat-v2-dataclass-routing-fallback.md) (анализ [`2026-06-29-assistant-unavailable-chat-v2-dataclass-routing.md`](../../plans/analysis/2026-06-29-assistant-unavailable-chat-v2-dataclass-routing.md)). Владелец получил в Telegram «Помощник временно недоступен» на синтезе ответа (`taskType=chat-v2`). Корень: `chat-v2` передаёт в роутер `dataClass` извлечённых блоков; роутер фильтрует провайдеров по `PROVIDER_CAPABILITY.maxDataClass`. У `deepseek`/`openai-via-proxy` было `internal`, у `kie` — `private`. На `private`/`sensitive`-вопросах DeepSeek и OpenAI отфильтровывались → в активной цепочке оставался единственный зависающий `kie` (60 c) → `llm_error` → текст «недоступен». Задача (3 фазы): поднять DeepSeek/OpenAI до `private`, вынести таймаут KIE в крутилку (180 c), реконсилировать сиды chat-v2.

## Что сделал

- **Фаза 1 (коммит `3f8f23ad`)** — в `backend/src/modules/ai/services/llm-router.service.ts` константа `PROVIDER_CAPABILITY`: `deepseek` и `openai-via-proxy` подняты `maxDataClass` `internal`→`private`. Теперь оба eligible+primary для любого класса данных; цепочка резерва `DeepSeek → OpenAI → KIE` работает для любого вопроса.
- **Фаза 2 (коммит `1c83fc71`)** — таймаут KIE вынесен из захардкоженных `60_000` в крутилку `ai.kie.timeoutMs` (code-fallback 180000, `resolveSync`). Затронуто: `typed-config.service.ts` (`ai.kie.timeoutMs` + `chatV2SynthesisTimeoutMs` fallback 90_000→180_000), `kie.service.ts` (читает `this.cfg.ai.kie.timeoutMs`), `admin-setting-schema-registry.ts` (`POSITIVE_INT`), новый сид `backend/scripts/seed-admin-setting-kie-timeout.ts`, UI-группа «Провайдер KIE» в `OrchestratorSettingsClient.tsx`.
- **Фаза 3 (коммит `f9a9a63d`)** — сид-данные chat-v2 выровнены на `deepseek-v4-pro` (было `flash`) в `seed-llm-task-routes-default.ts` и `seed-llm-task-routes-knowledge-core.ts` (+ kie tertiary в legacy-сиде); `seed-admin-setting-kie-timeout.ts` зарегистрирован в `apply-prod-deploy.ts` `STEPS` (phase `seed-base`).
- **Документация** — `docs/operations/prod-deploy-log.md` (новый блок «Накоплено к выкату», Шаг 7); `second-brain/04_не-сделано/README.md` (3 follow-up строки); `second-brain/02_architecture/module-map.md` (раздел `llm-router.service.ts` — `PROVIDER_CAPABILITY` private + крутилка таймаута KIE).

## Что вышло

- Backend `typecheck` / `lint` / `build` — зелёные (build exit 0); frontend `typecheck` / `lint` — зелёные.
- В Фазе 2 при правке `kie.service.ts` найдена регрессия в `kie.service.spec` (тест ожидал старую константу 60_000) — устранена под новое чтение из cfg.
- `PROVIDER_CAPABILITY` — единственный потребитель (фильтр eligibility роутера), поэтому правка изолирована; blast-radius (private-данные теперь допускаются в DeepSeek/OpenAI) — осознанное решение владельца, приватность в деприоритете.

## Чему научился

1. **Двойная модель `LlmTaskRoute`: legacy-JSON `providers[]` vs нормализованные tier-строки.** Сиды маршрутов существуют в двух формах — legacy с JSON-массивом провайдеров и нормализованные per-tier записи. Правя цепочку chat-v2, нужно выровнять обе, иначе повторный сид рассинхронит. В следующий раз — сразу проверять оба сида (`*-default` и `*-knowledge-core`), а не один.
2. **Реальный прод-механизм chat-v2=`pro` — это everyDeploy-патч `patch-chat-v2-to-pro.ts`, а не сиды.** На проде primary chat-v2 держит патч из `apply-prod-deploy.ts`, а не seed. Правка сидов flash→pro — это гигиена fresh-DB и устранение рассинхрона сид↔прод, отдельного прод-действия не требует. Урок: прежде чем «чинить сид», проверить, не перетирает ли его патч/everyDeploy-шаг — иначе правишь не тот источник правды.
3. **Номера строк в ТЗ сместились на 1 после удаления нарратив-комментария** (правило «без комментариев в коде»): при удалении пояснительного комментария рядом с правкой все `path:line` ниже в файле сдвигаются, и acceptance-грепы ТЗ по номеру строки перестают совпадать. В следующий раз — в acceptance опираться на грепы по содержимому (`grep -n "deepseek: { maxDataClass: 'private'"`), а не на номера строк.
4. **Таймаут KIE 60 c резал `chatV2SynthesisTimeoutMs` 90 c** — захардкоженная константа провайдера побеждала крутилку синтеза. Урок: при выносе таймаута в крутилку проверять всю иерархию таймаутов (провайдер ≤ синтез ≤ глобальный dispatch), чтобы нижний не обрывал верхний.

## Что осталось

В реестр `04_не-сделано` вынесены 3 follow-up (vNext/needs-analysis):
- Видимая ошибка в кабинетном чате при `llm_error` (паритет с Telegram — сейчас кабинет молчит).
- Стабилизация/замена провайдера KIE (таймауты + ежечасный битый JSON; бьёт `strategic-alignment`, `block-ingest`).
- Recall-качество chat-v2 (промах ретрива по синонимам; «встречи»→`list_my_events` вместо записанных встреч).

Визуальная приёмка кабинетного чата на приватный вопрос — после прод-выката (qa-tester).

## Прод-команды

Полная актуальная инструкция — [`docs/operations/prod-deploy-log.md`](../../docs/operations/prod-deploy-log.md), блок «2026-06-29 — Помощник «временно недоступен»». Diff за этот выкат:
- Миграций/ENV/флагов нет.
- Шаг 7 (Seed, доезжают агрегатором `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`):
  - `scripts/seed-admin-setting-kie-timeout.ts` (НОВЫЙ, в STEPS) — крутилка `ai.kie.timeoutMs`=180000; повтор = no-op.
  - `scripts/seed-llm-task-routes-knowledge-core.ts` / `seed-llm-task-routes-default.ts` — реконсиляция chat-v2 на `deepseek-v4-pro`; на проде primary=pro уже держит everyDeploy-патч `patch-chat-v2-to-pro.ts`, отдельного действия не требует.
- Docker rebuild: `docker compose up -d --build backend frontend`.
