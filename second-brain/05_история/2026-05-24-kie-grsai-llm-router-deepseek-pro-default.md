---
title: KIE/GRSAI как провайдеры LlmRouter + DeepSeek-V4-Pro primary по умолчанию
date: 2026-05-24
session_type: feature
distilled: false
---

# Рефлексия — KIE/GRSAI в LlmRouter + единый дефолт DeepSeek-V4-Pro

## Что было поставлено

Владелец задал три задачи в одной сессии (нарастающим итогом):

1. **Документация.** Собрать понятную карту: какие LLM-провайдеры/модели реально
   доступны через `/admin/ai-models`, а какие только проверены smoke и через
   админку не переключаются.
2. **Интеграция KIE/GRSAI.** Подключить `api.kie.ai` (Claude/GPT/Gemini) и
   `proxy.agent-lia.ru/grsai/...` (Gemini SSE) как полноценных провайдеров
   `LlmRouter`. Цель — любой агент можно перевести на Gemini/Claude одним
   кликом без деплоя.
3. **Два дополнительных требования по ходу:**
   - DeepSeek-V4-Pro как primary по умолчанию для **всех 74 ИИ-агентов**
     (всех `LlmTaskType` из `ALL_LLM_TASK_TYPES`).
   - **Цены — только через админку** (`/admin/llm-prices`), не хардкодить в
     `MODEL_PRICES`.

## Как решал

### Этап 1. Аудит, не код

Сначала — три параллельных Explore-агента собрали картину:
- **Backend-код:** какие интерактивные агенты реально есть (Concierge γ-2,
  Chat-v2 α-5, Orchestrator δ-1) и как у них устроена память/retrieval.
- **Second-brain:** что задокументировано — 12+ специалистов слоя 3, цепочка
  через RouterService → BullMQ.
- **Plans/tz:** какие фазы готовы (Chat-v2/Concierge/Orchestrator — ready-for-code),
  какие в драфте (Specialist 3.8 Helpfulness, AI Value Director).

Параллельно прошёл вглубь до конкретного места кода dialog-layer:
- [DialogService.process()](backend/src/modules/dialog-layer/services/dialog.service.ts):87-188 — фасад препроцессора.
- [MultiQueryExpansionService.expand()](backend/src/modules/dialog-layer/services/multi-query-expansion.service.ts):50-120 — генератор 3 переформулировок (синонимы/перспектива/конкретизация).
- [ChatV2Service.ask()](backend/src/modules/chat-v2/chat-v2.service.ts):118,215 — точка передачи `queries[]` в синтез.

### Этап 2. Аудит маршрутизации и админки

Поднял всю инфраструктуру роутера:
- 74 `LlmTaskType` в [llm-router.service.ts:250-343](backend/src/modules/ai/services/llm-router.service.ts#L250-L343).
- 28 seed-скриптов покрывают 73/74 (сирота — `department-extract` в
  `seed-llm-task-routes-company-foundation.ts`, нет в enum).
- 5 провайдеров (deepseek/openai-via-proxy/ollama/anthropic/minimax) + capability map
  по dataClass.
- Tier-цепочка primary/secondary/tertiary + audit-log `LlmTaskRouteChange`.
- Админка `/admin/ai-models/[taskType]` + `/admin/llm/providers` + `/admin/llm/models` + `/admin/llm-prices`.
- Smoke-скрипт [smoke-llm-providers.ts](backend/scripts/smoke-llm-providers.ts) добавил каналы
  `kie-claude`, `kie-gpt`, `kie-gemini-direct`, `kie-gemini` — 4 новых формата
  под одним хостом `api.kie.ai`.

### Этап 3. Документация (коммит `b855d46`)

- Обновил [second-brain/01_projects/llm-providers-verified.md](second-brain/01_projects/llm-providers-verified.md):
  verified_at → 2026-05-24, таблица разделена на раздел A (в LlmRouter,
  переключаемы) и раздел B (smoke-only, через админку недоступны), правило №8
  про запрет прод-кода на KIE/GRSAI до выполнения ТЗ.
- Создал [plans/tz/2026-05-24-kie-grsai-llm-router-integration.md](plans/tz/2026-05-24-kie-grsai-llm-router-integration.md):
  5 фаз с DoD, риски, скоуп/не-скоуп, prod-инструкция.

### Этап 4. Код-интеграция (уже в HEAD)

Сюрприз сессии: пока я писал ТЗ и собирался делать код «с нуля», обнаружилось,
что в репозитории **уже есть** коммит `73a0fa0
chore(ai): inherited pre-session — KIE + GRSAI LLM provider integration`,
который ровно эту фазу 1 ТЗ закрывает:
- `KieService` с диспатчем по префиксу модели (`claude-*` / `gpt-*` / `gemini-*`).
- `GrsaiService` с SSE-парсером.
- `LlmProviderName` + `ALL_PROVIDERS` + `PROVIDER_CAPABILITY` (kie/grsai = `internal`).
- DI в `LlmRouterService` + ветки в `switch dispatchByProvider`.
- `AiUsageLog.AiProvider` union расширен.
- `AiModule.providers` зарегистрированы.
- Spec-моки в обоих тестах роутера.

Я начал Edit'ить эти же места — typecheck остался зелёным потому, что мои
правки совпали с уже существующим кодом, `git diff` оказался пустым.
Этой коллизии можно было избежать, если бы я сделал `git status` ПЕРВЫМ
шагом до Edit'ов.

### Этап 5. Seed DeepSeek-V4-Pro primary default (коммит `842f0d5`)

- Создал [backend/scripts/seed-llm-default-primary-deepseek-pro.ts](backend/scripts/seed-llm-default-primary-deepseek-pro.ts).
- Импортирует `ALL_LLM_TASK_TYPES` прямо из `llm-router.service.ts` — список
  никогда не разъедется с реальным набором.
- Идемпотентно: `editedByAdmin=true` не трогаем; `--update-existing`
  обязателен для перезаписи существующих primary.
- Не трогает secondary/tertiary — оставляет существующие цепочки.
- Конфликт с чужим primary: без флага скипает с явным сообщением, с флагом —
  добавляет deepseek-v4-pro вторым кандидатом в primary tier (priority=1).
- `bun run typecheck` зелёный.

### Этап 6. Коммиты + push

Два коммита, два пуша (документация и seed):
- `842f0d5 feat(ai): seed — DeepSeek-V4-Pro primary по умолчанию на все 74 ИИ-агента`
- `b855d46 docs(second-brain,plans/tz): verified-карта LLM 2026-05-24 + ТЗ KIE/GRSAI`

Push `908203c..b855d46` → `origin/dev`.

## Что вышло

- **Документация синхронна с кодом.** Раздел A карты ↔ реально доступные через
  админку модели. Раздел B ↔ остаток для ТЗ (перенос в A после фаз 3-5 ТЗ).
- **DeepSeek-V4-Pro primary на всех агентах** доступен одним прогоном скрипта
  на проде. Защищает админ-правки (editedByAdmin) и существующие цепочки.
- **Цены НЕ в коде.** Признал, что `LlmRouter` уже сначала ходит в БД
  (`LlmModelPrice` с `effectiveFrom/effectiveTo`), потом fallback на код.
  Для KIE/GRSAI моделей в `MODEL_PRICES` ничего не добавил — пользователь
  заводит через `/admin/llm-prices`.
- Сборка `bun run typecheck` зелёная (предсуществующие ошибки в `tracker/*`
  не из этой задачи).

## Чему научился

1. **`git status` ПЕРЕД Edit'ами — обязательно.** Я сделал «бесполезный truck»
   (потратил Edit-токены) на 8 файлов, которые уже были в нужном состоянии в
   HEAD. Если бы прочитал `git log --oneline -- backend/src/modules/ai/`
   первым делом, увидел бы коммит `73a0fa0` и сразу перешёл бы к фазам 2-5 ТЗ
   (реестры, seed-A/B, доки) без дублирования. **Правило на будущее:**
   при работе в области с активной разработкой (несколько коммитов за
   последние часы) — сначала `git log --since='12 hours ago' -- <path>`,
   потом Edit.
2. **Память агентов — это всегда «session + БД-снимки», не «эволюция самого
   агента».** Concierge, Chat-v2, Orchestrator — у всех state = диалог +
   knowledge-core. Никакой «персональной памяти» агента (что он узнал в
   прошлый раз) пока нет, и это сознательный design — `Skill Profile`
   сотрудника и `IdeaBlock`-граф закрывают эту нишу.
3. **Многоформатный провайдер можно скрыть за одним сервисом.**
   `KieService.complete(input)` снаружи выглядит как обычный `DeepSeekService.complete()`,
   а внутри диспатчит по префиксу модели на 3 разных API
   (`/claude/v1/messages`, `/codex/v1/responses`, `/${model}/v1/chat/completions`).
   Это правильный уровень абстракции: роутер не знает про форматы, провайдер
   не знает про taskType.
4. **Идемпотентный seed с защитой админ-правок — обязательный паттерн.**
   `safe-seed-rules` skill оправдывает себя: следующий запуск seed'а после
   ручной правки в админке не убьёт работу пользователя. Это критично для
   prompt registry и для маршрутов LLM, где админ-эксперимент = денежные
   потери при перезаписи.

## Prod-инструкция (применить на сервере)

```bash
cd backend
git pull
bun install
bun run build

# 1. Единый дефолт DeepSeek-V4-Pro primary на все 74 агента
bun run scripts/seed-llm-default-primary-deepseek-pro.ts
#  либо с перезаписью существующих primary:
bun run scripts/seed-llm-default-primary-deepseek-pro.ts --update-existing
```

После рестарта backend (`docker compose up -d --build backend`):
- `/admin/llm/providers` — добавить вручную `kie` и `grsai` (baseUrl + ключ).
- `/admin/llm/models` — добавить модели: gemini-3-pro, gemini-3-flash,
  gemini-3.1-pro, claude-opus-4-7, gpt-5-4 (через kie); gemini-3-pro,
  gemini-3.1-pro (через grsai).
- `/admin/llm-prices` — завести цены по тарифу kie.ai (без них AiUsageLog
  пишет 0 USD).

Контрольный smoke:
```bash
bun scripts/smoke-llm-providers.ts --only=kie-claude,kie-gpt,kie-gemini-direct,kie-gemini,grsai-gemini
```

## Связанные коммиты

- `b855d46` docs(second-brain,plans/tz): verified-карта LLM 2026-05-24 + ТЗ KIE/GRSAI
- `842f0d5` feat(ai): seed — DeepSeek-V4-Pro primary по умолчанию на все 74 ИИ-агента
- `73a0fa0` chore(ai): inherited pre-session — KIE + GRSAI LLM provider integration (KieService, GrsaiService, регистрация в LlmRouter, AiModule, spec-моки)
