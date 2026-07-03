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

## Фаза 3 — Постадийные метрики `[x]`

Новый `backend/scripts/eval/metrics/stage-metrics.ts` — чистые функции, из нормализованной трассы + gold:
- **retrieval recall@k** (`retrievalRecall(signatures, poolTexts)`): доля gold-сигнатур, чей `entity`/`phrases`
  находятся в текстах пула. **Сигнатурный резолв** вместо `⊆ blockId` (см. Ф0: id нестабильны). На замороженной
  записи пул = `rerankTop`-имена (полный `poolAfterFusion` по именам харнесс пока не пишет → под стенд).
- **resolve hit-rate** (`resolveHitRate(expectedNames, resolvedNames)`): доля ожидаемых сущностей, совпавших по
  имени/подстроке. Id→имя маппинг — в оркестраторе (под стенд), в сухом прогоне — прокси по `rerankTop`/answerText.
- **sub-question lift** (`subQuestionLift(recallExpanded, recallSingle)`): разница recall с экспансией и без.
- **synthesis faithfulness** — линза судьи (Ф4), не эвристика (поле в `PerQuestionMetrics`, заполняет Ф4).
- `aggregate(rows)` — средние по корпусу, null-строки пропускаются.
- Приёмка (unit, БЕЗ стенда) — **сделано, 12 тестов зелёные**: сигнатура в пуле → recall=1; отсутствует → 0.5/0;
  resolve полный/частичный/0; lift; агрегация с null.

## Фаза 4 — Судья встроен в прогон `[x]`

- Панель majority-of-3 в `backend/scripts/eval/judge/panel.ts` — 3 линзы
  (буквальное соответствие / полнота `mustMention` / честность-против-выдумок), вердикт по большинству;
  gold (эталон/mustMention/тип) передаётся в промпт, **не хардкодится**. `judgeOne(input, gold, call)` с
  инъекцией `LlmCall` → мок в unit; живой клиент `makeLlmCall()` (OpenAI SDK → DeepSeek, `temperature:0`,
  `json_object`) — под стенд. `parseVerdict` отделяет «incorrect» от «correct» (подстрока).
- Оркестратор `backend/scripts/eval/run-recall-eval.ts` (`evaluateCorpus`): прогон → классификатор (Ф1) →
  метрики (Ф3) → судья (Ф4, опц. `--judge`) → отчёт (Ф5), одной командой. Судья опционален (сухой прогон без него).
- Приёмка (unit) — **сделано, 7 тестов**: 2 из 3 «верно» → верно; единогласие; null-голос → incorrect;
  gold в промпте; parseVerdict. Реальный прогон судьи — «под стендом позже».

## Фаза 5 — Отчёт + acceptance `[x]`

- `run-recall-eval.ts` `renderReport` пишет `eval-report-<runId>.md`: итог (отвечено/честно-пусто/**реальный
  провал** %), постадийно (recall@k · резолв-hit · faithfulness), **список реальных провалов** (id + стадия-причина).
- Замороженная фикстура `__fixtures__/results-gold-subset.json` (50 gold-записей из results-111-v2, обрезаны).
- Приёмка всего ТЗ — **сделано**:
  - typecheck (вкл. `.spec`) · lint зелёные;
  - `bunx vitest run scripts/eval` — **6 файлов, 67 unit зелёные**;
  - «сухой» прогон на замороженной фикстуре (без стенда): q008→real_fail, q054/q055/q088→answered,
    q068/q074→honest_empty (q109/q110 покрыты в classify-outcome.spec Ф1); подтверждено, что oldHonest=true
    у q054/q055/q088 — сломанный флаг. Живой отчёт: отвечено 84% · честно-пусто 10% · **реальный провал 6%**
    (q002/q008/q098), retrieval 0.81 · резолв 0.90, атрибуция q008→retrieval=0.
  - **под стендом (позже, когда освободится):** полный свежий прогон gold-набора + отчёт + судья.

## Прод-деплой
**Прод-операций нет** — dev-only eval-инструмент, не деплоится.

## Итог
**Реализовано Ф0–Ф5** (коммиты 30fb4dcc · 2247055d · 723ee3ce · 69d19c83 · + Ф4–Ф5). Линейка готова «в холодную»:
честный классификатор исхода (замена сломанного `honest`), цепочки-диалоги, постадийные метрики с сигнатурным
заземлением, судья majority-of-3, отчёт с атрибуцией. **Осталось (под стенд):** живой прогон gold-набора + судья
+ атрибуция реального recall, когда освободится локальный стенд. 67 unit + сухой прогон это НЕ заменяют, а готовят.
