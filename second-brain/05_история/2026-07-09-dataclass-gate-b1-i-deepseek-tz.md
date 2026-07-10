---
date: 2026-07-09
tags: [llm-router, dataclass, deepseek, prod-fix, testing]
distilled: false
---

# Гейт dataClass (B1-фикс) + разбор регрессии deepseek + 2 ТЗ

## Что было поставлено
Продолжение стенда тестирования: разобрать три находки первого прогона по существу (что за функция, где, почему), решить проблему 1+3 сразу, оформить раздельные ТЗ, deepseek — отложить на проверку ключей владельцем. Работать на новой ветке `work/2026-07-09`, коммит+пуш.

## Как решал
- **Разбор механики** (не по логам, а по коду): фильтр провайдеров по dataClass в [llm-router.service.ts:1560-1586](../../backend/src/modules/ai/services/llm-router.service.ts#L1560); шкала `public<internal<sensitive<private` ([:1002](../../backend/src/modules/ai/services/llm-router.service.ts#L1002)); при пустом фильтре — `throw NoEligibleProviderError` = block dispatch.
- **Живой прод-тест** (авторизован владельцем): скрипт логин+`GET /admin/llm-providers`+`POST /admin/ai/smoke-test/:provider`. Результат: deepseek FAIL «требует apiKey» (3мс), openai OK. cap всех рабочих провайдеров в проде = **`internal`** (не `private`, как в хардкоде) → любые `sensitive`/`private`-данные никто не покрывает.
- **Корень deepseek** — коммит `46e25c97` «restrict env fallbacks»: ключ теперь только из БД-реестра ([provider-info.resolver.ts:119/137](../../backend/src/modules/ai/services/protocol-adapter/provider-info.resolver.ts#L119)), ENV-фолбэк отключён; строка deepseek без ключа → падает. openai жив, т.к. проксируется.
- **B1-фикс (проблема 1+3):** гейт больше не блокирует — при пустом фильтре dispatch по всей цепочке + WARN + метрика (наблюдаемость). Коммит `24ef6619`, тест обновлён (30/30), typecheck/lint зелёные.
- **2 раздельных ТЗ** (по требованию владельца): `2026-07-09-llm-deepseek-key-restore.md`, `2026-07-09-remove-dataclass-classification.md` (Этап B1 сделан, B2 — полное удаление ≈184 файла — отложен под решение). Коммит `d71bb99e`. Строки в `04_не-сделано`.

## Что вышло (верификация)
- Тест роутера 30/30, typecheck 0, lint 0. Поведение: транскрипт-refine и др. call-site, что деградировали на `NoEligibleProviderError`, теперь реально отрабатывают.
- Прод-эффект будет после rebuild backend (код-фикс, без миграций/seed/ENV).

## Чему научился
- **`.rejects.toThrow()` — слабый ассерт:** старый тест «проходил» на TypeError из мока (`incCoreDataClassViolation` не был в mock metrics), а не на целевом `NoEligibleProviderError`. Любой throw красит зелёным. Урок: проверять тип/сообщение ошибки, а не «упало вообще».
- **Провайдер-капабилити в проде живёт в БД-реестре, а не в хардкод-карте** (`PROVIDER_CAPABILITY` — только фолбэк): реальные cap читаются из `LlmProvider.capability`, и они разошлись с кодом (все `internal`). Диагностику LLM-роутинга надо делать по проду (`GET /admin/llm-providers`), не по коду.
- **Смок-тест провайдера доступен по HTTP** (`POST /api/v1/admin/ai/smoke-test/:provider`) — быстрый способ проверить живой LLM-вызов на проде без SSH.
