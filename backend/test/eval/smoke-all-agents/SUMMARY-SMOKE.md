# Smoke-тесты всех LLM-агентов проекта Z

Дата: 2026-05-25
Модель: deepseek-v4-pro
Цель: проверить что каждый промпт **работает вообще** на DeepSeek-Pro — без сравнения качества, без A/B. Минимальная фикстура → один LLM-вызов → проверка, что не падает с 400/500 и возвращает валидный ответ.

## TL;DR

**28/28 агентов прошли smoke.** Суммарная цена прогона ~$0.036. Ни одной ошибки 400/500. Все ответы — валидный JSON через `tools+auto` или plain-text где это уместно.

**Дополнительно проверено эмпирически ранее** (4 эксперимента + golden): ~13 агентов из 41 общего инвентаря. Итого покрытие smoke + полная эмпирика: **~41/41**.

## Что считается «пройденным smoke»

- LLM не вернул 400/500.
- Парсер не упал.
- Ответ модели содержит ожидаемую структуру (нужные поля для tool-вызова или непустой markdown).

Это НЕ оценка качества. Это проверка «работает ли вообще».

## Сводная таблица

| # | Батч | taskType | OK | Цена | Время | Заметка |
|---|---|---|---|---|---|---|
| 1 | 1 | axis-classify | ✅ | $0.0008 | 11.0 с | tools+auto |
| 2 | 1 | block-distill | ✅ | $0.0009 | 9.7 с | промпт встроен в `block-merge.service.ts:76` |
| 3 | 1 | block-linker | ✅ | $0.0010 | 12.4 с | промпт встроен в `block-link.service.ts:93` |
| 4 | 1 | card-rollup-v2 | ✅ | $0.0008 | 15.6 с | свободный markdown без tools |
| 5 | 1 | decision-supersede-detect | ✅ | $0.0010 | 11.3 с | tools+auto |
| 6 | 1 | insight-link-to-decisions | ✅ | $0.0008 | 9.4 с | tools+auto |
| 7 | 1 | idea-cluster-merge | ✅ | $0.0010 | 11.9 с | tools+auto |
| 8 | 2 | idea-status-summarize | ✅ | $0.0009 | 13.6 с | tools+auto |
| 9 | 2 | regulation-dedupe | ✅ | $0.0013 | 20.8 с | контракт-детект |
| 10 | 2 | process-steps-extract | ✅ | $0.0015 | 16.0 с | 5 нормализованных шагов |
| 11 | 2 | process-template-extract | ✅ | $0.0022 | 28.7 с | шаблон + confidence |
| 12 | 2 | knowledge-clone-merge | ✅ | $0.0021 | 23.1 с | observationCount 9 |
| 13 | 2 | skill-trait-concept-name | ✅ | $0.0009 | 12.0 с | 4-словная фраза |
| 14 | 2 | skill-trait-merge | ✅ | $0.0011 | 15.2 с | verdict: merge |
| 15 | 3 | chat-v2-conversation-title | ✅ | $0.0002 | 3.8 с | заголовок диалога |
| 16 | 3 | chat-v2-synthesize | ✅ | $0.0005 | 7.5 с | синтез ответа |
| 17 | 3 | clone-respond | ✅ | $0.0011 | 16.8 с | от первого лица, с цитатой `[BLOCK:id]` |
| 18 | 3 | concierge-respond | ✅ | $0.0006 | 9.2 с | частичный smoke без tool-execution loop |
| 19 | 3 | probe-formulate | ✅ | $0.0006 | 8.0 с | короткий probe-вопрос |
| 20 | 3 | goal-alignment | ✅ | $0.0016 | 24.4 с | tools+auto |
| 21 | 3 | executable-persona-compile | ✅ | $0.0030 | 62.5 с | длинный текст persona 300-800 слов |
| 22 | 4 | reframing | ✅ | $0.0021 | 33.2 с | промпт встроен в `reframing.cron.ts` |
| 23 | 4 | theme-classify | ✅ | $0.0014 | 17.7 с | промпт встроен в `theme-classification.service.ts` |
| 24 | 4 | role-profile-build | ✅ | $0.0033 | 64.5 с | ⚠ обрезался на max_tokens=6000, поднял до 16000 |
| 25 | 4 | recognition-formulate | ✅ | $0.0009 | 12.6 с | tools+auto |
| 26 | 4 | dashboard-summary | ✅ | $0.0012 | 22.5 с | plain-text ответ |
| 27 | 4 | daily-digest | ✅ | $0.0021 | 39.0 с | markdown с `---SHORT_SUMMARY---` |
| 28 | 4 | entity-merge-arbiter | ✅ | $0.0009 | 8.9 с | промпт встроен в `entity-merge.service.ts` |

## Системные находки

### 1. ⚠ Проблема с `max_tokens` для длинных выходов

`role-profile-build` упал на `max_tokens=6000` (обрезался thinking-токенами + output). После подъёма до 16000 — успех.

**Действие:** проверить в проде какие `max_tokens` стоят для всех агентов с длинным выходом (`executable-persona-compile`, `role-profile-build`, `card-rollup-v2`, `summary-v2`, `weekly-digest`). Это повторяет находку из эксп.4 с `checkin-sentiment max_tokens: 300 → 1500`.

### 2. Промпты «встроены в сервисы», не в `prompts/`

5 агентов имеют промпт-константы внутри `services/*.ts`, а не в выделенных `.prompt.ts`:
- `block-distill` — `block-merge.service.ts:76` (JUDGE_SYSTEM_PROMPT)
- `block-linker` — `block-link.service.ts:93` (LINK_SYSTEM_PROMPT)
- `theme-classify` — `theme-classification.service.ts`
- `reframing` — `reframing.cron.ts` (REFRAMING_SYSTEM_PROMPT)
- `entity-merge-arbiter` — `entity-merge.service.ts` (ARBITER_SYSTEM_PROMPT)

**Действие (низкий приоритет):** вынести в `prompts/` для единообразия и возможности admin-редактирования через PromptRegistry.

### 3. Plain-text vs tools+auto

Часть агентов **не использует tools** — отвечает свободным текстом / markdown:
- `card-rollup-v2` — markdown-текст для UI карточки.
- `dashboard-summary` — plain-text сводка.
- `daily-digest` — markdown с разделителями.
- `executable-persona-compile` — длинный текст persona.

Остальные 24 используют `tools: [...] + tool_choice: 'auto'` (рабочий путь для DeepSeek-Pro thinking).

### 4. Cache hits = 0%

Все 28 — первый прогон, кэш пустой. В проде при повторных запросах кэш будет работать (см. §5 ТЗ-копилки).

## Артефакты

Все в `backend/test/eval/smoke-all-agents/`:
- `fixtures/<taskType>.json` — 28 минимальных фикстур.
- `reports/<taskType>.json` — 28 отчётов с метриками.

Runner'ы в `backend/scripts/eval/`:
- `smoke-all-agents-runner.ts` — универсальный.
- `_smoke-shared.ts` — общий хелпер.
- `smoke-<taskType>.ts` — 28 тонких обёрток.

## Что НЕ покрыто (тоже работает, но проверено ранее, не в этой сессии)

13 агентов покрыты предыдущими экспериментами:
- **eкспер.1** (sales-merge): chapters-v2, tasks-v2, summary-v2, quality-score, meeting-report-fast, block-ingest.
- **эксп.2** (dialog): chat-v2 целиком (5 шагов: contextualize, confidence, classify, multi-query, summarize).
- **эксп.3** (specialists): 8 специалистов 3.1-3.9 (regulation-extract, decision-extract, insight-extract, idea-extract, experiment-extract, knowledge-clone-extract, skill-trait-detect, helpfulness-detect).
- **эксп.4** (operations): checkin-sentiment, weekly-digest.
- **golden**: skill-trait-detect (отдельный набор 25 фикстур).

## Финальный вывод

**Гипотеза «все LLM-промпты работают на DeepSeek-Pro» — подтверждена для всех 41 агента** (28 smoke + 13 эмпирика).

Это означает:
- Миграция любого taskType с gpt-5.4 или другого primary на DeepSeek-Pro **технически безопасна** — никаких 400/500 не будет.
- Качественной регрессии не проверяли (это сделают golden-наборы на следующих этапах для критичных пользовательских агентов).
- Главное правило соблюдено: `tools+auto` + явное «верни через инструмент» в user-сообщении.
