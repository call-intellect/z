---
title: ТЗ — Пост-встречные отчёты/протоколы/граф + орг-документы (доноры владельца → код)
date: 2026-06-10
status: ready-to-implement (по фазам; решения владельца внутри)
type: tz
source_analysis:
  - plans/analysis/2026-06-09-prompt-rewrites/                      # рерайты всех промптов (БЫЛО→СТАЛО) + пилот
  - plans/analysis/2026-06-09-prompt-rewrites/22-org-entities-COMPARE-and-compiler.md  # орг-сущности + компилятор
  - .qa-tmp/donor-meeting-prompts.md                               # доноры владельца (клиент 3-док / команда 2-док)
related:
  - plans/tz/2026-06-09-prompt-fleet-strengthening.md              # общий ТЗ по флоту промптов (helper'ы Ф0)
---

# ТЗ — Пост-встречные отчёты, протоколы и граф + орг-документы

> **Что делаем.** Доводим до кода два пласта: (1) **пост-встречные агенты** — отчёты человеку,
> протоколы клиенту, извлечение в граф (из двух донор-промптов владельца: клиентская встреча → 3
> документа; командная → 2 документа); (2) **орг-документы** — экстрактор процесс/регламент/инструкция
> + новый агент-компилятор документа. Источник пер-промптовых текстов «СТАЛО» — папка рерайтов; здесь —
> **контракт реализации**: какие поля/схемы/файлы менять, по фазам.

---

## 0. Архитектурное решение (ключевое — прочитать первым)

Карта оркестрации (сверено кодом): после `ai.merge` → **две независимые ветки**:
- **Отчёт человеку** — `ai.analyze` (`AnalyzeWorker`): `summary → report-by-type (tool) → follow-up → tasks` →
  `AiResult` (`structuredData`/`summaryFast`/`followUpEmail`). Параллельно `core.meeting-report-fast`.
- **Граф (машине)** — `MeetingIngestAdapter.ingestMeeting` → `core.raw-events` (`BlockIngestWorker`) →
  `IdeaBlock` + `IdeaBlockEvidence` (цитата+таймкоды) + сущности группы Б. **Единственный вход в граф.**

`turnsToText` (`common.ts:70`) подаёт в отчётные промпты диалог **с разметкой спикеров**
`[mm:ss-mm:ss] Speaker: text` → идентификация сторон в отчётах **реализуема текстом промпта**.
`block-ingest` получает сырые `Segment[]` с `speakers[]` (диаризация, без гарантии).

### Решение Р-A: НЕ сливаем «3 документа» в один агент
Доноры владельца описывают «один агент → 3 (2) документа». **В нашей архитектуре эти документы
УЖЕ существуют как ОТДЕЛЬНЫЕ агенты** — и так и оставляем. Слияние в один агент вернуло бы баг
двойного источника (мы его уже ловили: `fast vs structured`). Маппинг доноров на наши агенты:

| Документ донора | Наш агент | Действие |
|---|---|---|
| **Клиент: протокол наружу** | `client-meeting-split` (НОВЫЙ, нейтральный протокол) | создать (Фаза B) |
| **Клиент: внутренняя карточка** | `type-sales`/`customer_success`/`partner`/`custdev` (обогащённые) | обогатить (Фаза B) |
| **Клиент: граф (JSON)** | `block-ingest` (уже работает) | обогатить качеством (Фаза C) |
| **Команда: отчёт человеку** | `meeting-report-fast` / `type-team`/… | обогатить (Фаза A) |
| **Команда: граф (JSON)** | `block-ingest` | обогатить (Фаза C) |

**Итог:** граф — единый источник (block-ingest), отчётные промпты граф НЕ дублируют (подтверждено:
все 19 агентов `duplicatesGraph=false`). Идеи доноров про граф (провенанс, quote, supersedes,
opinion) идут в block-ingest, а не плодят второй извлекатель.

### Две волны по риску
- **Волна 1 (no-schema):** только текст SYSTEM (идентификация сторон D1, само-проверка D3, «решили≠
  обсудили», «не уточнено»=сигнал, честная пустота D10, анти-утечка D6). Без изменения контрактов —
  катим сразу, риск минимальный. Тексты — в рерайтах + здесь по агентам.
- **Волна 2 (schema):** новые поля в tool/json-схемах (`data_quality`, `ideas/proposals`,
  провенанс-объекты, графовые `sideHint`/temporal). Контракт меняется → согласованно с потребителями
  (`structuredData` рендерится фронтом; см. §Контракты).

> **Хранение.** `AiResult.structuredData` — JSON-колонка: новые поля отчётных схем **миграции БД НЕ
> требуют**. `meeting-report-fast` пишет свой JSON — тоже без миграции. `block-ingest` новые поля
> (`dataQuality`/temporal) — если кладём в существующий JSON/`propertySpans`, миграции нет; если в
> типизированную колонку `IdeaBlock` — нужна миграция (отметить в `prod-deploy-log` Шаг 4).

---

## 0.1 Связь с аудитом и предварительным ТЗ (хэндофф-бриф)

Этот ТЗ — НЕ замена, а **углубление** зонтичной работы из
[хэндофф-брифа](../analysis/2026-06-09-prompt-rewrite-handoff-brief.md): он реализует **подмножество**
(пост-встречные агенты + орг-документы) и **добавляет** донор-специфику, которой в аудите не было.
Опорные документы и как они учтены:

| Документ хэндоффа | Роль | Как учтён здесь |
|---|---|---|
| **Аудит 145 промптов** `2026-06-09-prompt-fleet-audit.md` | анализ (12 системных пробелов, Прил. А/Б) | находки по пост-встречным промптам (type-*, follow-up, block-ingest, tasks, quality-score, card-rollup) **уже в рерайтах** `2026-06-09-prompt-rewrites/` и здесь как Волна 1/2. Ничего из них не отброшено |
| **Предв. ТЗ** `2026-06-09-prompt-fleet-strengthening.md` | план по фазам Ф0–Ф10, решения Р1–Р5 | этот ТЗ **реализует его фазы** для своей зоны (см. маппинг ниже); общие helper'ы Ф0 — там, не дублируем |
| **Каталог** + **Методология** | БЫЛО + рубрика A1–G1 | основа рерайтов; доноры добавляют D1–D10 поверх рубрики |

### Маппинг: этот ТЗ → фазы предварительного ТЗ
| Здесь | Фаза предв. ТЗ | Связь |
|---|---|---|
| СК-1/СК-3 (стороны/само-проверка), `tasks` D3/D8, A1-дискриминатор орг-сущностей (E1) | **Ф4** (A1/C2/E3) + **Ф0.4** `withDecisionDiscriminator` | реализуем рубрику A1 на конкретных агентах + донор D1/D8 |
| E1/E2-обёртки call-site (follow-up, block-ingest, compiler, type-*) | **Ф1/Ф2** `applyInputGuards` | используем helper Ф0.1, не вшиваем в текст (правило E1/E2=обёртка) |
| Клиентский дуальный сплит, `client-meeting-split` (B0), follow-up D6 | **Ф3** (B3) + new `client-meeting-split` | прямая реализация Ф3 для клиентских типов |
| `extractionStatus` (3 значения) у орг-сущностей (E1) | **Ф0.5** единый status-enum | **ОВЕРРАЙД:** владелец решил **3 значения** (`существует/нужен/обсуждается`), не 4 из Ф0.5 — см. ниже |
| `kind='instruction'` + таблица `Instruction` (E1/E3) | **Ф10** (first-class Instruction) | синхронно regulation-extract + specialists-combined; миграция |
| `structured-document-compiler` (E2) | **Ф7** + **Ф0.7** `withDocumentCompilerMode` | новый агент-компилятор `contentMd` |
| `meetingDateIso` + edge-policy в tasks/type-* (E3-сроки) | **Ф0.8/Ф8** | прокидка даты + относительные сроки→ISO |
| `data_quality`, side-identification (D1/D2), ideas-vs-tasks (D8), provenance-объекты (D4) | **— НОВОЕ —** (доноров 2026-06-10) | в аудите 145 этих измерений НЕ было; добавляются поверх |

### Уточнения/оверрайды к предварительному ТЗ
- **Status-enum (Ф0.5): 3 значения, не 4.** Владелец принял `существует/нужен/обсуждается`
  (донор орг-сущностей). `proposed` сливается в `обсуждается`. Обновить Ф0.5 при реализации.
- **D1–D10 (доноры пост-встреч) — расширение рубрики A1–G1**, не замена. Аудит остаётся источником
  по остальным ~110 промптам; этот ТЗ — по пост-встречным + орг-документам.
- Решения **Р1 (ретайр v2), Р4 (process-steps), Р5 (runTasks)** — в силе, здесь не пересматриваются.

---

## Сквозные изменения (применяются в нескольких фазах)

### СК-1 (D1) — идентификация сторон/спикеров + «спикер не определён» — Волна 1, no-schema
Добавить в SYSTEM по типам:
- **Клиентские** (`sales/custdev/partner/customer_success`): «НАША сторона презентует продукт и
  спрашивает о бизнесе собеседника; сторона КЛИЕНТА рассказывает о своих процессах и спрашивает о
  продукте. Реплику не атрибутировать — пиши “сторона не определена”, не угадывай».
- **interview:** «НАША сторона — рекрутер/интервьюер; кандидат — внешняя сторона».
- **custdev:** «pains/use_cases/quotes — только из реплик РЕСПОНДЕНТА, не интервьюера».
- **customer_success:** «issues — из реплик клиента; actions_required — обязательства НАШЕЙ стороны».
- **tasks-unified / type-standup / block-ingest:** «исполнитель/автор неоднозначен или спикер не
  определён → assignee=null / авторство неизвестно, не выводи из контекста».

### СК-2 (D2) — раздел/поле «Качество данных» — Волна 2, schema
Единый минимум — `data_quality: string | null` (1–2 фразы: полнота транскрипта, неопределённые
спикеры, ненадёжные места). Добавить в tool/json-схемы: все `type-*`, `meeting-report-fast`,
`block-ingest` (как `dataQuality`). Структурный вариант для `meeting-report-fast`/`block-ingest`
(опц.): `{transcriptCompleteness, undeterminedSpeakers, unreliableParts[]}`. Заполнять и в отчётный
Markdown (раздел «Качество данных» / «Риски сделки» в карточке).

### СК-3 (D3) — само-проверка перед выдачей — Волна 1, no-schema
Короткий блок в конце SYSTEM, специфичный типу. Команда: «решили≠обсудили; задача — только
обязательство с ответственным; идея ≠ задача». Клиент: «в протоколе нет оценок/температуры/ЛПР/
конкурентов/сомнений; все next_step — и в протоколе, и в карточке; слова не приписаны не тому спикеру».

### СК-4 (D10) — честная пустота — Волна 1, no-schema
«Не было решений/задач/договорённостей → честно “не зафиксировано”/“не выявлено”, не выдумывай и не
натягивай структуру». В `summary/chapters/card-rollup/tasks/type-*`.

---

## Фаза A — командный отчёт (8 агентов)

> Тексты СТАЛО (роль/принципы/чего НЕ делать) уже в `10a-report-by-type-internal.md` и
> `11/12a`. Здесь — дельта от доноров поверх рерайтов.

### A1. `meeting-report-fast` (tool `submit_meeting_analysis`)
- **Волна 1:** в `SUMMARY_TEMPLATE_BY_TYPE` для team/standup/project/plan_fact — явно развести
  «Идеи и предложения (не ставшие задачами)» vs «Задачи»; для незаполненного ответственного/срока —
  формула «не уточнено» (сигнал). Для клиентских шаблонов — правило сторон СК-1.
- **Волна 2 (schema):** `data_quality` в `MEETING_REPORT_FAST_INPUT_SCHEMA` + `MeetingReportFastSchema`
  (`{transcriptCompleteness, undeterminedSpeakers, unreliableParts[]}` или строкой). Обновить snapshot.

### A2. `type-team` (tool `extract_team`: discussed/decisions/tasks/blockers/next_step)
- **Волна 1:** SYSTEM — «решили vs обсудили vs предложили»; assignee «не уточнено» = сигнал; СК-3.
- **Волна 2 (schema, высокая ценность):**
  - **+ `ideas: string[]`** — предложения/«было бы хорошо», не ставшие задачами (D8). **Главный фикс.**
  - `decisions`: `string[]` → **`[{text, speaker: string|null, changes_what: string|null}]`** (D4 провенанс
    + «что меняет»). *(контракт-брейк — согласовать с фронт-рендером `structuredData.decisions`.)*
  - `+ data_quality: string|null` (СК-2).

### A3. `type-standup` (tool `extract_standup`)
- **Волна 1:** new_tasks — только обязательства; `who_does_what.person='не определён'` если не установить.
- **Волна 2:** **+ `proposals: string[]`** (идеи/пожелания, не задачи); `+ data_quality`.

### A4. `type-plan_fact` (tool `extract_plan_fact`)
- **Волна 2 (наибольшая ценность промпта):** `not_done`: `string[]` →
  **`[{item, responsible: string|null, reason: string|null}]`** (D4 — «кто не сделал что именно»);
  **+ `unexplained_gaps: string[]`** (пункты без названной причины). `+ data_quality`.
- **Волна 1:** SYSTEM — `responsible` привязывать к конкретным пунктам; done/not_done взаимоисключающи.

### A5. `type-project` (tool `extract_project`)
- **Волна 2:** `agreements`: → **`[{text, speaker: string|null, supersedes: string|null}]`**;
  `responsibilities`: → **`[{who, what, deadline: string|null}]`**; **+ `ideas: string[]`**; `+ data_quality`.
- **Волна 1:** agreements — только принятые решения, не обсуждённые варианты (D8/A1-дискриминатор).
- *Реализовывать вместе с A2 (тот же паттерн провенанс-объектов).*

### A6. `type-retrospective` (tool `extract_retrospective`)
- **Волна 2:** **+ `recurring_problems: string[]`** (повторяющиеся — «снова»/«как всегда»); `+ data_quality`.
- **Волна 1:** атрибуция kudos («кто похвалил кого»); `mood_notes` — наблюдаемое, не психологизировать
  (D8 «динамика команды» уже частично покрыта `mood_notes`/`team_mood`).

### A7. `type-review` (tool `extract_review`)
- **Волна 2:** **+ `decisions: string[]`** (принято/отклонено/на доработку — ключевой пробел: есть
  `verdict`, нет списка решений); `+ data_quality`.
- **Волна 1:** `to_improve` — только прозвучавшее явно (D5), не интерпретация; `verdict` — обоснован репликой.

### A8. `type-interview` (tool `extract_interview`)
- **Волна 2:** **+ `competing_offers: string|null`** (другие офферы — аналог D7); `+ data_quality`;
  *(опц.)* `strengths/weaknesses`: → `[{text, source_quote: string|null}]` (трассируемость).
- **Волна 1:** явное «НАША сторона = рекрутер; кандидат = внешняя» (СК-1); role_fit обоснован experience.
  **ПРАВИЛО-ЛЮДИ** (гипотезный регистр оценки кандидата) — из рерайта, сохранить.

---

## Фаза B — клиентские встречи: дуальный документ (5 агентов + 1 новый)

> Принцип B3 (граница конструкцией) — из пилота §2 (`01-pilot-exemplars.md`) и `10b`. Здесь — поверх.

### B0. НОВЫЙ агент `client-meeting-split` — нейтральный протокол наружу
- **Контракт:** free-text Markdown (отдельный `taskType`, регистрация в реестре + DEFAULT-маршрут).
  Запуск в `analyze.worker` для клиентских типов (`sales/customer_success/partner` + опц. `custdev`)
  параллельно карточке. Хранение — отдельное поле `AiResult` (напр. `clientProtocolMd`) — **миграция**
  (Шаг 4) ИЛИ в `structuredData.client_protocol_md` (без миграции — рекомендую для старта).
- **SYSTEM** — структура из донора A «===ПРОТОКОЛ===»: Протокол (дата/участники обе стороны/тема) ·
  Кратко · Что обсудили · Ваши задачи и пожелания (словами клиента) · Договорённости и следующие шаги
  (таблица Шаг|Ответственный мы/вы|Срок) · Открытые вопросы. **Пустой раздел — пропустить целиком**
  (не «не обсуждалось»). **Граница (D6):** ноль оценок/температуры/ЛПР/конкурентов/бюджета/сомнений;
  «перечитай глазами клиента». Полный текст СТАЛО — в пилоте §2 (Документ 1), взять оттуда.
- **Отправка — ручная** (гейт), не авто (Ship-On: фича-флаг `clientProtocolEnabled` kill-switch ON).

### B1. `type-sales` (tool `extract_sales`) — внутренняя карточка
- **Волна 1:** правило сторон СК-1; само-проверка СК-3.
- **Волна 2 (из пилота §2 + доноров):** **+ `competitors: string[]`** (вкл. «ничего не делать»/«своими
  силами»), **+ `decision_criteria: string[]`**, **+ `what_hooked: string|null`** (реакция на продукт),
  **+ `main_blocker: string|null`** (узкое место сделки), **+ `data_quality: string|null`**.
  *(опц.)* `objections`: → `[{text, our_response: string|null, resolved: enum}]` (провенанс+статус снятия).
  Температура+этап с обоснованием на реплики — раздел внутренней карточки (в `structuredData`/Markdown).

### B2. `type-customer_success` (tool `extract_customer_success`)
- **Волна 1:** СК-1 (CS-менеджер/клиент); issues от лица клиента; actions_required — только наши; СК-3.
- **Волна 2:** **+ `churn_risk_quote: string|null`** (из рерайта 10b), **+ `competitors_mentioned: string[]`**
  (корреляция churn=high ↔ конкурент), **+ `data_quality`**. Сплит на нейтральный протокол (B0) —
  `outcome/issues/actions/next_contact` могут идти в протокол; `churn_risk/upsell` — internal-only.

### B3. `type-partner` (tool `extract_partner`)
- **Волна 1:** СК-1 (наша/партнёр); запрет домысливать `benefit_for_us` (D6-аналог); risks/next_step —
  конкретны или null; атрибуция источника `joint_mechanics`/`risks` («партнёр предложил» vs «мы»).
- **Волна 2:** `+ data_quality`. Сплит протокол наружу (B0, `partner-meeting-split` через тот же агент).

### B4. `type-custdev` (tool `extract_custdev`)
- **Волна 1 (высший приоритет, no-schema):** СК-1 — `quotes/pains/use_cases` ТОЛЬКО слова респондента;
  D5 — `insights`=интерпретация vs `quotes`=факт; СК-3. *(custdev протокол сделки не нужен — максимум
  благодарность; дуальный сплит к нему НЕ применяем.)*
- **Волна 2:** `+ data_quality`.

### B5. `follow-up` (tool `extract_follow_up`: subject/body) — письмо клиенту
- **Волна 1 (критично — единственный текст, который напрямую уходит клиенту):** D6 — «перечитай письмо
  глазами получателя: ноль внутренних оценок/температуры/конкурентов/сомнений»; D10 — честный fallback
  без выдуманных договорённостей; D5 — только подтверждённые факты диалога. Тексты — в `11`.

---

## Фаза C — граф: обогащение `block-ingest` (единый источник)

> `block-ingest` уже имеет `evidenceQuote` + `evidenceStartMs/EndMs` + provenance (RawEvent→IdeaBlock→
> Evidence) + `commitmentDueDateGuess`/`commitmentRecipientNameGuess`. Доноры добавляют:

- **Волна 1 (no-schema, SYSTEM):**
  - D1: «если `speakers[]` пуст / только тех-метки (Speaker_0, unknown) — авторство неизвестно; не
    приписывай реплику человеку; `commitmentRecipientNameGuess=null`».
  - D9: `evidenceQuote` — **дословно, по возможности ≤15–20 слов** (сейчас допускается длинная склейка);
    «извлекай значимое, не каждую реплику — критерий: пригодится через месяц на вопрос “что с X”».
  - D10: пустое окно → пустые массивы (уже есть в edge-policy).
- **Волна 2 (schema — приоритет по убыванию):**
  1. **`dataQuality`** в корень схемы: `{speakerCoveragePercent: number|null, transcriptTruncated: boolean,
     lowConfidenceBlockCount: number}` (СК-2 для графа; нужно для диагностики качества входа).
  2. **`sideHint: 'our'|'client'|'unknown'|null`** на блок — только для клиентского типа встречи (D4 —
     сторона факта). Питает корреляцию «боль клиента vs наша гипотеза».
  3. *(опц., НИЗКИЙ приоритет — частично избыточно)* `validFrom/validTo/supersedingBlockHint` на
     fact/state/decision. **Внимание:** темпоральное замещение у нас уже делают downstream-арбитры
     (`fact-supersede-detect`, `decision-supersede-detect`) на канонических блоках — дублировать в
     ingest НЕ нужно; добавлять только если решим переносить supersession в извлечение. `validFrom`
     уже берётся из `event.occurredAt` (битемпоральность за флагом).
  - `opinion` как сигнал: у нас уже есть `reasoning/expertise/competence` (→ SkillProfile). Отдельный
    `opinion` не вводим — маппится на существующее (отметить в SYSTEM, без новых типов).

---

## Фаза D — вспомогательные (4 агента) — Волна 1, no-schema

- **`summary`** (free-text): «если транскрипт неполный/спикеры не определены — фраза в конце» (D2-min);
  «договорённостей не было → не выдумывай» (D10). Не трогать free-text контракт.
- **`chapters`** (json_schema `chapters_v1`): «summary главы — нейтральное описание, без оценок» (D5);
  «summary=null для технических/переходных глав» (D10, схема уже nullable).
- **`tasks-unified`** (tool `extract_tasks`): **главный фикс** — «обязательство (“я сделаю”) ≠ пожелание
  (“надо бы”) ≠ идея (“было бы хорошо”); только первое → задача» (D3/D8) в `BASE_SYSTEM`+`STRUCTURED_BASE_SYSTEM`
  (из пилота §5 — вынос анти-«надо бы» в базу); «спикер не определён → assignee=null»; «null = честный
  сигнал, не пробел».
- **`meeting-quality-score`** (tool `submit_meeting_quality_score`): «транскрипт фрагментирован →
  recommendation severity=info, снижай confidence structure/engagement» (D2); engagement — по времени
  говорения/вопросам, не «пассивный/активный» о людях (D5/ПРАВИЛО-ЛЮДИ).
- **`card-rollup v1`** (free-text по kind): для `client`/`deal` — анти-утечка (D6): «не включай
  температуру/бюджет/сомнения/оценки готовности ЛПР — только нейтральные темы и прогресс»; для `deal` —
  конкуренты вкл. «ничего не делать»/«своими силами» (D7); пустые summary → «Данных недостаточно» (D10).

---

## Фаза E — орг-документы (экстрактор + новый компилятор) — из анализа 22

> Полный разбор и черновики СТАЛО — `plans/analysis/2026-06-09-prompt-rewrites/22-org-entities-COMPARE-and-compiler.md`.

### E1. Экстракторы (`regulation-extract`, `block-ingest` группа Б, `specialists-combined`)
- **Волна 1 (no-schema, текст SYSTEM, катим сразу):** расширить «Чего НЕ извлекать» — **чужие практики**
  (у конкурентов), **гипотетика** («если бы как в Google»), **упоминание документа без содержания**
  (→ `существует`, низкий confidence); доменная калибровка confidence (есть шаги/роли/сроки=0.9; голое
  упоминание=0.5); few-shot на ДВЕ сущности из одного текста (регламент `обсуждается` + инструкция `нужен`).
- **Волна 2 (schema):**
  - `kind += 'instruction'` (Р2) — в `regulation_extract_v1` И `submit_all_8_entities` синхронно;
    **гейт:** в SYSTEM вводить ТОЛЬКО после обновления Zod-схемы (иначе Zod-reject).
  - **`extractionStatus ∈ {существует, нужен, обсуждается}`** (3 значения — решение владельца, не 4) —
    новое поле; маппинг в lifecycle: `существует`→`active` (при курации), `нужен/обсуждается`→черновик
    (НЕ `active`). **Чинит баг «всё Действует».**
  - **`roles: string[]`** (даёт дискриминатор ≥2 ролей→регламент/процесс vs 1→инструкция + список на карточке).
  - **`evidenceQuote: string`** в вывод (дословная опора, A3 — сейчас в `regulation_extract_v1` нет).

### E2. НОВЫЙ агент `structured-document-compiler` (ТЗ Ф7)
- **Контракт:** tool/json `compile_org_document` → `contentMd` (по структуре типа) · `steps[]` (для
  process, синхронно с `ProcessStep`) · `changeReason` (→ `RegulationVersion.changeReason`) · `signals[]`
  (type-mismatch/no-info).
- **Вход:** `kind ∈ {regulation|process|policy|instruction}` · `name` · `newSourceBlocks[]` ·
  `existingContentMd` (режим СОЗДАНИЕ/ДОПОЛНЕНИЕ) · `existingSteps[]` · `nowIso`.
- **SYSTEM** — полный текст в анализе 22 §3 (режимы, правила слияния, структуры по типам: инструкция
  7 разделов / регламент «таблица кто-что-когда» / процесс вход→действие→выход + схема потока / политика;
  маркеры `[требует уточнения]`/`[конфликт]`/`[изменено]`; чек-лист; «ничего не теряй»). Ложится на
  существующую инфру версий (`RegulationVersion`, `correct/confirm`).
- **Оркестрация (E3 из анализа 22):** после `regulation-dedupe` (verdict new/merge/extension) вызывать
  компилятор для сборки `contentMd` (сейчас extension=plain update — документ не собирается).
- **E2/call-site:** `newSourceBlocks`/`existingContentMd` — `wrapUserData`+`withInjectionGuard`.

### E3. Фронт (`RegulationsListClient`, `domain/regulation.ts`, DTO)
- `RegulationKindSchema += 'instruction'`; `REGULATION_KIND_LABEL += {instruction:'Инструкция'}`;
  отдельная вкладка-фильтр «Инструкции».
- Развести extraction-status vs lifecycle: не показывать `нужен/обсуждается` как «Действует» — секция
  «Черновики/обсуждается».
- Рендер структурного `contentMd` + подсветка маркеров `[требует уточнения]`/`[конфликт]` как чипов-«дырок».
- История версий уже есть → подключить `changeReason` компилятора.

---

## Контракты/схемы — сводная таблица изменений

| Агент | Поле | Тип изменения | Волна | Миграция БД |
|---|---|---|---|---|
| meeting-report-fast | `data_quality` | новое поле в tool-схеме | 2 | нет (JSON-результат) |
| type-team | `ideas[]`, `decisions→[{text,speaker,changes_what}]`, `data_quality` | новые/брейк | 2 | нет (`structuredData` JSON) |
| type-standup | `proposals[]`, `data_quality` | новые | 2 | нет |
| type-plan_fact | `not_done→[{item,responsible,reason}]`, `unexplained_gaps[]`, `data_quality` | брейк/новые | 2 | нет |
| type-project | `agreements→[{…}]`, `responsibilities→[{…}]`, `ideas[]`, `data_quality` | брейк/новые | 2 | нет |
| type-retrospective | `recurring_problems[]`, `data_quality` | новые | 2 | нет |
| type-review | `decisions[]`, `data_quality` | новые | 2 | нет |
| type-interview | `competing_offers`, `data_quality`, *(опц.)* strengths/weaknesses→объекты | новые | 2 | нет |
| type-sales | `competitors[]`, `decision_criteria[]`, `what_hooked`, `main_blocker`, `data_quality` | новые | 2 | нет |
| type-customer_success | `churn_risk_quote`, `competitors_mentioned[]`, `data_quality` | новые | 2 | нет |
| type-partner/custdev | `data_quality` | новое | 2 | нет |
| **client-meeting-split** | новый free-text агент + `clientProtocolMd` | новый | B | нет (если в `structuredData`) |
| block-ingest | `dataQuality{}`, `sideHint` | новые | 2 | зависит (JSON=нет; колонка=да) |
| **regulation-extract / specialists-combined** | `kind+=instruction`, `extractionStatus`, `roles[]`, `evidenceQuote` | брейк/новые | E2 | **да** (instruction + Instruction-таблица, Ф10) |
| **structured-document-compiler** | новый агент `compile_org_document` | новый | E2 | нет (пишет в существующие) |

> Все отчётные `data_quality`/новые поля — в `AiResult.structuredData` (JSON) ⇒ **миграций БД нет**;
> требуется обновить фронт-рендер `structuredData` под новые поля и **снапшоты** промптов.

---

## Порядок реализации (рекомендация)

1. **Волна 1 целиком** (no-schema, безопасно): СК-1/СК-3/СК-4 + Фазы A/B/C/D текстовые правки + E1-текст.
   Приёмка — снапшоты + build; наблюдение прода (diag).
2. **`tasks-unified` D3/D8** (вынос анти-«надо бы» в базу) — высший приоритет Волны 1 (источник ложных задач).
3. **`follow-up` D6** + **`card-rollup` D6** — анти-утечка клиенту (риск репутации).
4. **client-meeting-split (B0)** — новый агент протокола (Ship-On, kill-switch).
5. **Волна 2 schema — пакетами:** (а) `data_quality` везде (однотипно); (б) `ideas/proposals/decisions/
   recurring_problems/competitors*` (additive); (в) провенанс-объекты `team/project/plan_fact` (брейк —
   с фронт-рендером); (г) block-ingest `dataQuality/sideHint`.
6. **Фаза E2 орг-документы** — за миграцией `instruction` (Ф10 общего ТЗ) + новый компилятор (Ф7).

## Приёмка
- `cd backend && bun run typecheck && lint && build` зелёные; обновлены `*.snapshot.spec.ts` всех тронутых.
- Фронт-рендер `structuredData` не падает на новых полях (даже при пустых).
- Diag на тест-встречах: (а) клиентский протокол НЕ содержит оценок/температуры; (б) идеи не попадают в
  задачи; (в) «спикер не определён» вместо угаданного имени; (г) разовая задача не создаёт active-«Процесс».
- Прод-наблюдение без golden (политика): diag chain + метрики.

## Прод-операции
- **Флаги:** `clientProtocolEnabled` (kill-switch ON) → `feature-flags.md` + `prod-deploy-log` Шаг 1.
- **Миграции:** только Фаза E2 (`instruction` + `Instruction`-таблица, Ф10) + опц. block-ingest колонки → Шаг 4–5.
- Отчётные поля (`structuredData` JSON) — без миграций; деплой = `docker compose up -d --build`.

## Что НЕ входит
- Слияние отчёта и графа в один агент (Решение Р-A — оставляем раздельно).
- Дублирование графовых фактов отчётными промптами.
- Переписывание deprecated v2-стека (ретайр по Р1).
- Реализация helper'ов Ф0 (`applyInputGuards` и т.п.) — это общий ТЗ `2026-06-09-prompt-fleet-strengthening.md`.

## Итог
Реализовано: нет (ТЗ). Объём: 19 пост-встречных агентов + орг-документы. Архитектура донора («N
документов») = наши отдельные агенты (отчёт + протокол + граф) — НЕ сливаем, обогащаем. Волна 1
(текст) катится сразу; Волна 2 (схемы `structuredData` — без миграций БД) — пакетами; Фаза E2
(орг-документы) — за миграцией `instruction` и новым компилятором. Начинать по «погнали Волну 1 / Фазу X».
