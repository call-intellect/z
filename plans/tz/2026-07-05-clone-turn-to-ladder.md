---
type: tz
date: 2026-07-05
feature: clone-turn-to-ladder
status: in-progress
owner_decision: одобрено владельцем 2026-07-05 (ЭТАП-2, автономная реализация до петли)
analysis: plans/analysis/2026-07-05-clone-baseline-findings.md
depends_on: plans/tz/2026-07-03-clone-stand-and-baseline.md
---

# ТЗ ЭТАП-2 — «Разворот на лестницу опоры»

Baseline доказал числом: клон построен (43 черты, 9 персон), но политика ответа
refusal-first душит его фактуру → EXPERT_PASS 0/96, REFUSED 96/96 (все `topic_starved`).
Диагноз с якорями — `plans/analysis/2026-07-05-clone-baseline-findings.md §3`.

Цель ТЗ: развернуть ответный путь так, чтобы клон **отвечал экспертом там, где у оригинала
есть релевантный опыт**, и честно отказывался только там, где опыта нет. Инвариант, который
нельзя сломать: **FABRICATED = 0**.

## Решения (выбрано лучшее, доказано, почему не альтернативы)

### D1 — Ретрив по вопросу (pgvector-ранжирование), а не последние-20-по-дате

**Выбрано:** в `loadPersonSubgraph`/`loadRoleSubgraph` кандидаты блоков-субъектов
ранжируются по близости к вопросу (`embedding <=> qvec`), берётся top-K; на сбое эмбеддинга —
graceful fallback на прежний `createdAt desc`.

- ❌ *Альт-A: оставить последние-N, только опустить порог.* Отвергнуто: последние-N
  **структурно ограничивают recall** — если релевантные блоки старше 20-го по дате, они не
  попадают в subgraph ни при каком пороге, клон отвечает мимо/пусто. Порог лечит симптом
  (0.7 высок), не причину (не те блоки).
- ❌ *Альт-C: BM25/полнотекст.* Отвергнуто: хуже на перефразировках/семантике, а эмбеддинги
  блоков уже лежат в `IdeaBlock.embedding` (их уже читает `loadBlockEmbeddings`
  [clones.service.ts:2510](../../backend/src/modules/clones/services/clones.service.ts#L2510)) —
  вводить второй индекс дороже и без выигрыша.
- ✅ pgvector-ранжирование ставит релевантные блоки в начало subgraph → гейт плотности
  проходит там, где знание реально есть, и корректно отказывает, где его нет.

### D2 — Порог плотности + minBlocks + topK → AdminSetting, дефолт калибруется замером

**Выбрано:** три крутилки в `AdminSetting` (принцип 9), чтение через `getDynamic`
(async, в `assertTopicDensity`/загрузчиках) и `resolveSync` (sync, во флаге V2) с
ENV-мостом (`CLONE_TOPIC_*`) и code-fallback. Дефолт порога — по эмпирическому замеру
косинусов релевантных пар на данных стенда (header-less пространство; прецедент — порог
склейки 0.72→0.60).

- ❌ *Оставить в ENV.* Нарушает принцип 9 и не даёт калибровать петлю без редеплоя —
  ровно то, что нужно для доводки.
- ✅ AdminSetting + getDynamic: `configure`-режим стенда выставляет значения до boot,
  петля тюнит порог не пересобирая backend.

### D3 — Включить V2 (judgmental) как экспертный путь

**Выбрано:** `clone.v2.enabled = true` (ship-on, kill-switch).

- ❌ *Оставить V1 factual.* Отвергнуто: factual **структурно не даёт экспертного ответа** —
  `isUngrounded` [clones.service.ts:1259](../../backend/src/modules/clones/services/clones.service.ts#L1259)
  отказывает без цитаты `[BLOCK:id]` в тексте; промпт factual — «лучше отказ, чем выдумка».
  «Позиция→совет→план по аналогии» (то, что меряет E-ось) — это judgmental: `isUngrounded`
  для judgmental → `false`, промпт `CLONE_RESPOND_SYSTEM_PROMPT_JUDGMENTAL` разрешает ответ
  по аналогии с сохранением анти-deepfake-запретов (обещания/оценки/прогнозы).
- ✅ V2 роутит рассуждающие вопросы в judgmental (по классификатору диалога), фактические —
  в factual; ретрив/гейт общие с V1 → фикс D1/D2 работает на оба пути.

### D4 — minBlocks остаётся малым (дефолт 1–2), тяжесть на retrieval-by-question

При ретриве-по-вопросу гейт из «есть ли ≥2 релевантных среди последних-20» превращается в
«on-topic ли ЛУЧШИЙ блок». Достаточно minBlocks 1–2 с калиброванным порогом; поднимать —
только если петля покажет рост FABRICATED.

## Изменения по файлам

### 1. Реестр AdminSetting — `backend/src/modules/admin/settings/admin-setting-schema-registry.ts`

Добавить в `registry` (рядом с `clone.regulations.*`, ~L141):
```
['clone.topic.similarityThreshold', UNIT_INTERVAL],
['clone.topic.minBlocks', NON_NEGATIVE_INT],
['clone.retrieval.topK', POSITIVE_INT],
['clone.v2.enabled', z.boolean()],
```
`minBlocks` = `NON_NEGATIVE_INT` (0 = гейт выключен, как трактует код L2447).

### 2. `backend/src/modules/clones/services/clones.service.ts`

**2a. Проброс вопроса в загрузчики.** Сигнатуры `loadPersonSubgraph`/`loadRoleSubgraph`
получают `question: string`. Все 4 вызова (askPerson L198, askRole L442, askPersonV2 L706,
askRoleV2 L933) передают `args.question` / `dialog.standaloneQuestion`.

**2b. Ранжирование кандидатов по вопросу.** Новый приватный
`rankBlockIdsByQuestion(candidateIds, question, topK): Promise<string[]>`:
- `embedQuery(question)`; при null/исключении → вернуть `candidateIds.slice(0, topK)` (fallback);
- pgvector: `SELECT id FROM "IdeaBlock" WHERE id IN (...) AND embedding IS NOT NULL ORDER BY embedding <=> $qvec::vector LIMIT $topK` (через `$queryRaw`, как `loadBlockEmbeddings`);
- дописать в хвост кандидатов без эмбеддинга, чтобы не терять блоки (до topK).
В загрузчиках: получив `blockIds` из `ideaBlockEntity`, вызвать `rankBlockIdsByQuestion` и
далее `ideaBlock.findMany({ where: { id: { in: rankedIds } } })` **без** `orderBy createdAt`
(сохранить ранг: пересортировать результат по позиции в `rankedIds`). `topK` = крутилка
`clone.retrieval.topK` (дефолт 20).

**2c. Гейт из крутилок.** В `assertTopicDensity` заменить
`this.cfg.skill.cloneTopicSimilarityThreshold`/`cloneTopicMinBlocks` на:
```
const similarityThreshold = await this.cfg.getDynamic<number>('clone.topic.similarityThreshold', 'CLONE_TOPIC_SIMILARITY_THRESHOLD', <калиброванный дефолт>);
const minBlocks = await this.cfg.getDynamic<number>('clone.topic.minBlocks', 'CLONE_TOPIC_MIN_BLOCKS', 2);
```

**2d. Флаг V2 из крутилки.** `isCloneV2Enabled()`:
```
return this.cfg.resolveSync<boolean>('clone.v2.enabled', 'CLONE_V2_ENABLED', true);
```
(ship-on: code-fallback true; kill-switch через AdminSetting/ENV).

### 3. ENV-дефолт — `backend/src/common/config/env.schema.ts`

`CLONE_V2_ENABLED: zBool(false)` → `zBool(true)` (ship-on; ENV остаётся мостом/kill-switch).
`CLONE_TOPIC_SIMILARITY_THRESHOLD` дефолт синхронизировать с калиброванным (см. петлю).

### 4. Стенд — `backend/scripts/clone-stand/` (configure-режим)

Добавить STAND_KNOBS (upsert AdminSetting до boot, паттерн CHANNELB_KNOBS):
`clone.v2.enabled=true`, `clone.topic.similarityThreshold=<калибр>`, `clone.topic.minBlocks=<1..2>`,
`clone.retrieval.topK=20`.

### 5. Тесты — `clones.service.spec.ts`, `clones-query-log.spec.ts`

Мок `cfg` дополнить `getDynamic`/`resolveSync`, возвращающими значения из существующего мока
`skill`/`cloneV2`. Существующие проверки гейта (порог 0.7, minBlocks 2) сохранить через мок.

## Вне разворота (отдельные гипотезы, не блокируют петлю)

- **H-версион (Елена frozen):** починить снятие frozen-снимка при увольнении так, чтобы v1
  оставался за уволенным носителем, а не переезжал на Игоря. Разбор — findings §4. Если
  объём > правки одного метода — строка в `second-brain/04_не-сделано/README.md`, не тормозить петлю.
- **H-motiv:** наполнить motivation-слой (Канал Б группу motivation). Отдельная петля.

## Приёмка

- Сборка: `bun run typecheck` · `bun run lint` — зелёные.
- Тесты: `bunx vitest run src/modules/clones` — зелёные (49/49 + новые).
- Поведение: перепрогон стенда `stand.ts all` показывает **сдвиг EXPERT_PASS 0 → >0** и
  **FABRICATED = 0** (инвариант). Числа и вывод — в findings §7 (журнал петель) и
  `docs/testing/clone-stand-runs/<дата>-L1/`.

## Prod-deploy

- Шаг 1 (ENV): `CLONE_V2_ENABLED` дефолт true.
- Флаги: `clone.v2.enabled` (kill-switch) → реестр `docs/operations/feature-flags.md`.
- Крутилки `clone.topic.*`, `clone.retrieval.topK` — сид AdminSetting (apply-prod-deploy).

---

# Аддендум L3 — «Умный гейт» (support-aware + mode-aware)

Результат L1+L2: EXPERT_PASS 0→31→55%, FABRICATED 0 ✅, BOUNDARY 13/14. Остаток — **gate-refusal=24** на
отвечаемых (доказано БД: топ-косинус блока 0.147–0.348 < порог 0.35; у отвеченных ~0.56). Гейт учитывает
ТОЛЬКО reasoning-блоки, игнорируя регламенты/навыки, и одинаково строг к рассуждающим вопросам (аналогия).

### Решения (лучшее, доказано)

**D-L3a — support-aware гейт (H10b).** Гейт отказывает, только если НЕТ никакой опоры: ни блоков (плотность),
ни релевантного регламента, ни навыка. Регламенты (`retrieveRoleRegulations`, порог 0.3) и навыки
(`retrievePracticeSkills`) уже фильтруются по вопросу → их наличие = валидная опора.
- ❌ *Оставить block-only.* regulation(6)/procedure(2) отказывают, хотя нужный регламент/навык ЕСТЬ.
- ✅ Реордер: retrieve навыки+регламенты ДО гейта; `refused = density.refused && regs=0 && skills=0`.

**D-L3b — mode-aware порог (H10c).** В judgmental (рассуждающий/аналогия) порог ниже
(`clone.topic.similarityThresholdJudgmental`, дефолт 0.25 стенд / 0.3 прод), т.к. аналогия применяет принципы
к НОВОЙ ситуации без точного прецедента. factual — прежний порог. Анти-фабрикацию держит промпт (H9) + инвариант.
- ❌ *Один порог 0.35.* analogy_transfer/expert_advice (11) отказывают на тонких блоках, хотя должны отвечать по аналогии.
- ✅ Порог по режиму; `mode` в V2 известен ДО гейта (`intentToMode(dialog.intent)`), V1 всегда factual.

**D-L3c — усиление формы (H11).** judgmental-промпт: даже при тонкой опоре давать позиция→принцип→шаги→риски
(без выдумывания конкретики). Адресует prompt-weak(E)=14.

### Изменения
1. Реестр: `clone.topic.similarityThresholdJudgmental` (UNIT_INTERVAL).
2. `assertTopicDensity` — параметр `mode`; judgmental → judgmental-порог.
3. 4 ветки ask: retrieve навыки(+регламенты для role) ДО гейта; `refused && regs=0 && skills=0`; передать `mode` в гейт.
4. Стенд STAND_KNOBS: `clone.topic.similarityThresholdJudgmental=0.25`.
5. Промпт judgmental: H11-усиление формы.

### Инвариант
FABRICATED=0 — жёсткий контроль. Если L3 даёт FABRICATED>0 — откат D-L3b (порог judgmental вверх) в следующей петле.

### Приёмка
REFUSED на отвечаемых ↓ (было 26), EXPERT_PASS ↑ (было 55%), **FABRICATED=0**; typecheck+lint+тесты клонов зелёные;
перепрогон стенда stamp `2026-07-05-L3`.
