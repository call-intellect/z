---
title: Линейка измерения recall — надёжный постадийный замер (Волна 1)
date: 2026-07-03
type: tz
status: ready-to-implement
area: recall / eval
relates_to:
  - plans/architecture/2026-07-03-recall-eval-ruler.md
  - plans/analysis/2026-07-03-recall-ceiling-hypotheses.md
owner_decisions:
  - "gold-набор ~40-60 выверенных (одобрено)"
  - "судья majority-of-3 LLM встроен в прогон (одобрено)"
  - "провенанс — отдельным фикс-ТЗ (см. 2026-07-03-chat-v2-citation-provenance-gap.md)"
---

# ТЗ: Линейка измерения recall (Волна 1)

## Зачем

Двигать recall к 95 нельзя, пока сигнал замера врёт: из 12 «пустых» прогона-111 семь — ложные
(перечни/анафора/перефразированный отказ). Строим **изолированный eval-слой**, который выдаёт честную
постадийную картину и список РЕАЛЬНЫХ провалов без артефактов. Обоснование и данные —
`plans/analysis/2026-07-03-recall-ceiling-hypotheses.md`. Замысел — блюпринт (approved).

## Границы

- **В scope:** eval-слой (`backend/scripts/eval/*` + `batch-recall-trace.ts`), gold-набор, встроенный судья,
  постадийные метрики, unit-тесты классификатора на фикстурах.
- **НЕ в scope:** правки горячего recall-пути (`chat-v2.service.ts` синтез/retrieval — не трогаем);
  провенанс-фикс (отдельное ТЗ); запуск полного прогона под стендом (стенд занят — прогон позже).
- **Ship:** dev-only инструмент, **прод-операций нет** (не деплоится).

## REALITY-CHECK (что уже есть — переиспользуем)

- ✅ `batch-recall-trace.ts` поднимает AppModule + реальный LLM, пишет `results-*.json`, собирает
  `retrievalTrace` (`collectTrace:true`): `perQuery` (semanticHits/structuralHits), `poolAfterFusion`,
  `afterRerank`, `resolvedEntityIds/PersonIds`, `graphExpansion`.
- ✅ Харнесс УЖЕ умеет цепочки (`chain`/`turn`, накопление истории) — но только при `LIMIT===∞` (баг Ф2).
- ✅ Панель судей существует как ad-hoc `judge-*.mjs` (majority-of-3) — переносим в eval-слой.
- ✅ Банк-формат `strela-recall-questions.json`: `id/angle/question/expectedAnswer/expectedEntities/chain/turn`.
- ⚠️ `honest`-эвристика (`batch-recall-trace.ts:57-61`) сломана — заменяем (Ф1).

## Фаза 0 — Gold-набор с заземлением на сигнатуры `[x]`

- Собран `backend/scripts/eval/gold/recall-gold.json` — **50 выверенных вопросов** (45 answerable + 5 honest_empty),
  поля: `id, angle, question, chain?, turn?, expectedEntities[], mustMention[], expectedBlockSignatures[], expectedKind`.
- **Отклонение от ТЗ (обосновано): вместо `expectedBlockIds[]` → `expectedBlockSignatures[]`** (`{entity?, phrases[]}`).
  Причина: block-id нестабильны при пере-севе «Стрелы» (наблюдалось 299→321) → замораживать id хрупко и тавтологично.
  Сигнатуры резолвятся к активным блокам (`status=canonical, mergedIntoId=null`) в рантайме метрикой (Ф3).
- **Пин org:** заземлено на канонический `cmr1qbvpx0001pwbwxbgmh1jl` (`eval-config.ts` `RECALL_EVAL_ORG`).
  Вскрыто: `.env` содержит `STRELA_ORG` ДРУГОГО тенанта (свежая «Стрела» соседней фичи) → eval-скрипты НЕ читают
  `STRELA_ORG`, пинят канонический явно (как `batch-recall-trace.ts`).
- Источник — отобраны из банка-111 (`docs/testing/strela-recall-questions.json`) вопросы с однозначным эталоном.
- Read-only верификация `recall-gold.verify.ts`: **0 unresolved entities, 0 weak signatures** — весь эталон
  реально резолвится к «Стреле».
- Валидатор `recall-gold.spec.ts`: id уникальны; answerable имеет ≥1 сигнатуру+mustMention; honest_empty пуст;
  цепочки ≥2 turn = 1..N без пропусков; follow-up «А…/И…» только с chain.
- Приёмка: `bunx vitest run scripts/eval/gold/recall-gold.spec.ts` — **11 тестов зелёные**; typecheck+lint зелёные.

## Фаза 1 — Честный классификатор исхода (замена `honest`) `[x]`

Новый чистый модуль `backend/scripts/eval/verdict/classify-outcome.ts`, функция
`classifyOutcome(rec, gold): 'answered' | 'honest_empty' | 'real_fail'` — БЕЗ обращения к `usedBlockIds`
как признаку пустоты:
- «honest_empty» — если ответ семантически = отказ (маркер ИЛИ короткий LLM-классификатор «это отказ?»)
  **и** `gold.expectedKind==='honest_empty'` → верно; если отказ, а ждали ответ → `real_fail`.
- «answered» — есть содержательный ответ; заземлённость считаем **корректным** парсом `[BLOCK:id]` из
  сырого текста по ОБЪЕДИНЁННОМУ набору показанных блоков (не только `contextBlocks`; см. провенанс-ТЗ),
  плюс покрытие `gold.mustMention`.
- «real_fail» — ответ не покрывает эталон / противоречит.
- Перефразированный отказ (q074) → `honest_empty`; refusal-когда-есть-факт (q008) → `real_fail`;
  перечни/анафора (q054/q055/q109) → `answered`.

Приёмка (unit, детерминизм, БЕЗ стенда) — **сделано, 21 тест зелёный**:
- `classify-outcome.spec.ts` на фикстурах реальных записей прогона-111
  (`verdict/__fixtures__/classify-cases.json`, из results-111-v2): q008→real_fail, q054/q055/q088/q109/q110→answered,
  q068/q074→honest_empty; негативные пути (пустой ответ, галлюцинация на honest_empty, clarification, refusalOverride).
- **Реализация вместо `usedBlockIds`:** `isRefusal(text)` — кириллице-безопасный маркер-детект отказа
  (`\w`/`\b` в JS-regex НЕ матчат кириллицу → `[а-яё]`+lookaround) + `refusalOverride` для внешнего LLM-сигнала.
  Заземлённость `[BLOCK:id]`/mustMention-покрытие вынесены в метрики/судью (Ф3/Ф4); здесь — класс исхода.
- Экспорт `mustMentionCoverage(text, mustMention)` для Ф3/Ф4.

## Фаза 2 — Прогон follow-up как диалога (всегда) `[x]`

- Логика разбора банка вынесена в **чистый модуль** `backend/scripts/eval/bank/parse-bank.ts`
  (`splitBank`/`validateBank`/`totalToRun`/`isFollowUpShaped`) — тестируется БЕЗ бута AppModule.
- `batch-recall-trace.ts`: гейт `LIMIT===∞` **убран** — цепочки прогоняются ВСЕГДА (`for (const chain of chains)`),
  `LIMIT` режет только одиночки; в начале — `validateBank` с предупреждением. Diff 21+/24−, `any` не введён.
- Валидатор банка отклоняет follow-up (`«А…/И…»`/голое местоимение как первый токен, кириллице-безопасно) без `chain`;
  цепочку из одного хода; turn с пропуском/дублем; chain без turn.
- Приёмка (unit, БЕЗ стенда) — **сделано, 10 тестов зелёные** (`parse-bank.spec.ts`): chain из 2 turn → 2 записи
  сортированы по turn; LIMIT режет одиночки, цепочки остаются; одиночный follow-up без chain → ошибка;
  **реальный банк-111 валиден (0 ошибок)**. Полный прогон цепочек — «под стендом позже».
- Пред-существующие 9 `no-explicit-any` в теле `processOne` — вне scope (dev-скрипт, не мои строки).

## Фаза 3 — Постадийные метрики `[ ]`

Новый `backend/scripts/eval/metrics/stage-metrics.ts` — из `retrievalTrace` + gold считает на вопрос и агрегат:
- **retrieval recall@k**: `gold.expectedBlockIds ⊆ poolAfterFusion` (и отдельно топ-k afterRerank).
- **resolve hit-rate**: `gold.expectedEntities ⊆ resolvedEntityIds/PersonIds`.
- **sub-question lift**: recall@k пула, построенного из расширенных под-вопросов, vs из одного исходного
  (режим `--no-expansion` на прогоне — прокинуть флаг до `MultiQueryExpansionService` через тестовый конфиг,
  НЕ трогая прод-логику; если недоступно — считать по трассе `doorPerQuery`).
- **synthesis faithfulness** — линза судьи (Ф4), не эвристика.
- Приёмка: unit на `stage-metrics` с синтетическими трассами (gold-блок в пуле → recall=1; отсутствует → 0;
  резолв-hit; lift ≥0 при расширении).

## Фаза 4 — Судья встроен в прогон `[ ]`

- Перенести панель majority-of-3 в `backend/scripts/eval/judge/panel.ts` — 3 линзы
  (буквальное соответствие / полнота охвата `mustMention` / честность-против-выдумок), вердикт по большинству;
  вход — из результатов прогона + gold (данные НЕ хардкодятся в скрипт).
- Оркестратор `backend/scripts/eval/run-recall-eval.ts`: прогон → классификатор (Ф1) → метрики (Ф3) →
  судья (Ф4) → отчёт (Ф5), одной командой.
- Приёмка: unit на агрегацию вердиктов (2 из 3 «верно» → верно; расхождение линз логируется). Реальный
  прогон судьи — «под стендом позже».

## Фаза 5 — Отчёт + acceptance `[ ]`

- `run-recall-eval.ts` пишет `eval-report-<runId>.md`: итог (верно/частично/честно-пусто/**реальный провал**
  %), постадийно (recall@k · резолв-hit · faithfulness · sub-question lift), и **список реальных провалов**
  (id + причина-стадия), без артефактов.
- Приёмка всего ТЗ:
  - typecheck (вкл. `.spec`) · lint · build зелёные;
  - `bunx vitest run scripts/eval` — все unit зелёные (классификатор, валидатор банка, метрики, агрегация судьи);
  - «сухой» прогон отчёта на замороженных фикстурах (`results-111-v2.json` как вход, без стенда) →
    7 ранее-ложно-пустых классифицируются верно (q074 honest_empty · q008 real_fail · q054/q055/q088/q109/q110 answered);
  - **под стендом (позже, когда освободится):** полный свежий прогон gold-набора + отчёт.

## Прод-деплой
**Прод-операций нет** — dev-only eval-инструмент, не деплоится.

## Итог
Реализовано: —. Осталось: Ф0–Ф5. Полный прогон под стендом — отложен до освобождения локального стенда
(логика проверяется unit-тестами и «сухим» прогоном на замороженных данных без стенда).
