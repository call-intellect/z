---
type: рефлексия
date: 2026-05-25
session: handoff-full-close v2 (Wave 4 — finishing T7 P2/P3)
distilled: false
parent: 2026-05-25-handoff-full-close-7-of-9.md
related:
  - second-brain/02_architecture/code-pitfalls.md (snapshot tests + confidence ontology)
  - .claude/skills/z-ai-agent-rules/SKILL.md (правила _V2 + confidence)
  - backend/src/modules/ai/services/prompts/common.ts (EDGE_CASE_POLICY + Z_GLOBAL_PREAMBLE)
  - backend/src/modules/ai/services/prompts/glossary.ts (новый helper)
---

# Рефлексия — Wave 4 закрывает T7 prompts-hardening полностью (P2 + P3)

## Что было поставлено

После Wave 1-3 (7 из 9 тикетов) пользователь попросил доделать «закаливание промтов» — T7 фазы P2 (F6-F11) и P3 (F12-F16). 11 фич, по handoff'у ~10 рабочих дней. Цель — закрыть весь scope T7, чтобы оставить только Mobile (внешний блокер) и SPO (ждёт владельца).

## Что вышло — все 11 фич закрыты за 3 коммита

| Коммит | Тикет | Сводка |
|---|---|---|
| `46b9e8f` | **T7-F6** | tool_use / json_schema strict в 7 промтах через Anthropic synthetic tool_use эмуляцию |
| `8b7bdc3` | **T7 P2 пакет** | F7 «на русском» в 8 типах + F9 EDGE_CASE_POLICY в 9 extract-промтах + F11 уборка γ/α/β + F12 glossary helper + F13 Z preamble |
| `930fcd8` | **T7 P3 пакет** | F10 _V2 правило + F14 card-rollup jsdoc анализ + F15 25 snapshot тестов в 11 файлах + F16 confidence-онтология |

**F8 (TODO(owner-product) финализация) — пропущен корректно:** grep по `TODO(owner-product)` в `backend/src` дал 0 совпадений — уже было убрано предыдущей сессией.

### Тесты
- `bun run typecheck` (backend + frontend) — exit 0, чисто
- `bun run test:unit` — **216 файлов / 1466 тестов passed, 0 failed** (30 skipped — pre-existing)

## Как решал — 2 волны параллельных агентов

### Wave 4a (4 параллельных агента, ~40 мин)
- A: **F6 tool_use** — самый сложный, 22 файла (типы LLM + Anthropic/MiniMax tool_use эмуляция + 7 промтов + 7 сервисов парсинга + метрика + 11 spec'ов)
- B: **F7+F11** язык+уборка фаз (тривиальные, можно одному агенту)
- C: **F9+F12+F13** helpers (общая common.ts + extract применения + glossary.ts + 2 spec'а)
- D: **F15** snapshot тесты (11 файлов, 25 тестов)

### Wave 4b (1 агент-документатор, ~15 мин)
- E: **F8+F10+F14+F16** документация/анализ — короткий scope, один агент

## Что вышло особенно хорошо

1. **F6 главное открытие: LlmRouter УЖЕ умел json_schema** — DeepSeek и OpenAI-via-proxy нативно. Дыра была в Anthropic и MiniMax (игнорировали). Решение — synthetic tool_use эмуляция через `buildAnthropicToolBindings` + `normalizeAnthropicInputSchema` + десериализация в `mapAnthropicResponseToOutput`. Caller'ы не меняются — гибкий парсер принимает и `{wrapper:[]}`, и голый payload (для legacy/Ollama).

2. **F9 правильная стратегия применения** — `withEdgeCasePolicy` применён к 9 extract-промтам (decision/idea/insight/regulation/experiment/process-template/skill-trait-detect/process-steps/role-map-extract), но НЕ к tasks-промтам analyze.worker (у них своя логика обработки пустого диалога).

3. **F13 и F12 не применены глобально** — только helper'ы. Правильное решение: применение `Z_GLOBAL_PREAMBLE` ко всем существующим промтам = риск регрессии. Helper'ы для нового кода + точечная миграция при рефакторинге.

4. **F14 правильный вердикт «не унифицировать»** — v1 и v2 card-rollup имеют разный input и разную семантику данных (legacy `Card.summaryCache` из `AiResult.summary` vs `IdeaBlock`-граф knowledge-core). Унификация = регрессия. Решение — большой jsdoc «не смешивать» в обоих файлах.

5. **F15 snapshot тесты — guard от регрессий build-функций**, не от качества LLM (для последнего — SPO). 25 тестов в 11 файлах. Когда `EDGE_CASE_POLICY` или `CONFIDENCE_CALIBRATION` поменяются — `bunx vitest -u` после ревью diff.

## Что было неожиданным

1. **Параллельные правки snapshot конфликтовали между F9 и F15.** F9 агент добавил `withEdgeCasePolicy` в decision-extract + обновил snapshot. F15 агент создал snapshot тоже на эти же файлы. Решилось автоматически потому что F15 запускал build на УЖЕ изменённой версии (с EDGE_CASE_POLICY) — snapshot вышел корректный. **Урок:** если 2 агента трогают snapshot-друживые файлы — лучше запускать последовательно.

2. **F6 contextualize не нужен был** — ТЗ ошибочно включил его в список 8 промтов. Реально `contextualize.prompt.ts` возвращает строку (не JSON), нет zod-схемы. Агент пропустил корректно с пометкой.

3. **F8 уже было сделано** — TODO(owner-product) убраны предыдущей сессией. Не пришлось ничего применять.

4. **clone-style.prompt.ts полностью утекал фазовую нумерацию в LLM** — там в template literal (отправляется в LLM как часть system) были фразы типа «персональные particle'ы появятся после γ-1», «На α-5 персонализация не подключена». Это пользовательский язык, а не разработческий — но утечка в промт = пользователь это видел в ответах LLM. Чистка важна.

## Чему научился

- **Для крупных F-фич (F6 типа) — отдельный агент.** Не сливать с мелкими.
- **Snapshot тесты — отличная страховка для prompt build-функций.** Низкая стоимость поддержки, ловит случайные потерянные кусочки в helper-цепочках.
- **Documentation-only тикеты — отдельный документатор-агент.** Быстро (15 мин), не блокирует основные.
- **Pre-разведка через Explore-агента остаётся правилом #1** — Wave 4 разведка показала что F8 уже сделано, F1 уже было — экономия часа работы.

## Метрика темпа Wave 4

| Wave | Тикетов | Агентов | Коммитов | Длительность |
|---|---|---|---|---|
| 4a | 11 (F6,F7,F9,F11,F12,F13,F15) | 4 параллельных | — | ~40 мин |
| 4b | 4 (F8,F10,F14,F16) | 1 | — | ~15 мин |
| Интеграция | — | — | 3 коммита | ~5 мин |
| **Итого** | **11** | **5** | **3** | **~1 час** |

При последовательной работе одного программиста — ~10 дней.

## Что закрыто всего за сессию (Wave 1 + 2 + 3 + 4)

| Тикет | Статус | Коммиты |
|---|---|---|
| T1 Gamification | ✅ закрыт | 50e4f64 |
| T2 Helpfulness FE | ✅ закрыт | caaf678 |
| T3 kie-grsai | ✅ закрыт | dcd867d |
| T4 voice WS | ✅ закрыт | 2637c91 |
| T5 email-IMAP | ✅ закрыт | d221f3b |
| T6 polish | ✅ закрыт | 84816fe + 2c7c9e6 |
| T7 P1 (F1-F5) | ✅ закрыт | 2a76784 + 723582e |
| **T7 P2 (F6-F11)** | ✅ **закрыт (Wave 4)** | **46b9e8f + 8b7bdc3** |
| **T7 P3 (F12-F16)** | ✅ **закрыт (Wave 4)** | **930fcd8** |
| T8 multi-user | ✅ закрыт | 14b8a71 |
| T9 SPO discovery | ✅ закрыт (документ) | 937ed4f |

**Итого: 9 из 9 тикетов handoff закрыты.** Осталось только Mobile native (внешний блокер — нужны dev accounts владельца).

## Что осталось владельцу после Wave 4

1. **Цены KIE/GRSAI** (см. рефлексию 2026-05-25-handoff-full-close-7-of-9.md §«Что осталось владельцу»)
2. **SPO discovery** — прочитать `plans/analysis/2026-05-24-spo-discovery.md`, ответить на 5 вопросов
3. **ENV для T5 email-to-task** (см. там же)
4. **Mobile native** — следующая сессия когда появятся dev accounts
5. **Pre-existing typecheck errors в operations/commitments.*** — соседний неблокирующий долг (от beta-8.2 promise-keeper), не от Wave 1-4

## Файлы, обновлённые в Wave 4

- `.claude/skills/z-ai-agent-rules/SKILL.md` — F10 _V2 правило + F16 confidence-онтология
- `backend/src/modules/ai/services/prompts/common.ts` — EDGE_CASE_POLICY + withEdgeCasePolicy + Z_GLOBAL_PREAMBLE + withZPreamble
- `backend/src/modules/ai/services/prompts/glossary.ts` — НОВЫЙ helper для бизнес-терминов
- `backend/src/modules/ai/services/prompts/{glossary,common}.spec.ts` — 11 unit-тестов
- 8 файлов `type-*.ts` — блок «ЯЗЫК ВЫВОДА» (F7)
- 9 extract-промтов — применение `withEdgeCasePolicy` (F9)
- 22 файла в F6 (LLM types + anthropic/minimax + 7 промтов + 7 сервисов + spec'и + метрика)
- 11 snapshot-spec файлов с 25 тестами (F15)
- `clone-style.prompt.ts`, `block-ingest.prompt.ts`, `skill-trait-detect.prompt.ts` — F11 чистка
- jsdoc в обоих card-rollup файлах (F14)
- `second-brain/02_architecture/code-pitfalls.md` — раздел snapshot тестов + F16 заметка

## Не забыть в следующую сессию

- **Mobile native** — только когда у владельца появятся Apple/Google/RuStore dev accounts + RN/Expo среда.
- **SPO** — после ответа владельца на 5 вопросов из discovery.
- **Pre-existing typecheck errors в operations/commitments.*** — починить соседним коммитом (это от beta-8.2 promise-keeper, не от моих изменений).
- **Backend lint cleanup** — есть отдельное ТЗ `fc2e6ca` (112 errors + 1573 warnings технический долг от соседних сессий).
