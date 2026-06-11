---
title: Переписывание всех промптов Z «БЫЛО → СТАЛО» — индекс и прогресс
date: 2026-06-09
status: in-progress (пилот сдан, ждёт приёмки формата → дальше весь флот)
owner-task: plans/analysis/2026-06-09-prompt-rewrite-handoff-brief.md
source:
  - plans/analysis/2026-06-09-meeting-agents-catalog-prompts-and-models.md   # БЫЛО (дословно) + модели + taskType
  - plans/analysis/2026-06-09-prompt-fleet-audit.md                          # пробелы по каждому промпту (Прил. А/Б)
  - plans/analysis/2026-06-09-meeting-prompts-strengthening.md               # методология (рубрика A1–G1)
  - plans/tz/2026-06-09-prompt-fleet-strengthening.md                        # фазы внедрения + решения Р1–Р5
---

# Переписывание всех промптов Z «БЫЛО → СТАЛО»

> **Что это.** Выходной артефакт задачи из [хэндофф-брифа](../2026-06-09-prompt-rewrite-handoff-brief.md):
> полноценные переписанные тексты **каждого** промпта флота — «БЫЛО → СТАЛО», строго под
> существующий код-контракт вывода. Это **тексты промптов + пометки изменений схем**, НЕ код
> (реализация — отдельно по [ТЗ](../../tz/2026-06-09-prompt-fleet-strengthening.md)).
>
> **Папка из файлов по категориям** (решение владельца 2026-06-09): один мега-файл неподъёмен.

---

## 0. Как читать (формат каждой записи)

Каждый промпт оформлен по §7 хэндоффа:

```
### <taskType / promptName> — <короткая роль>
- Файл: <path>  | Контракт: <tool «name» | json_schema «name» | json_object | bare-array | free-text>
- Применимые измерения: <A1, B1, C2, …>

#### БЫЛО
<дословный текущий SYSTEM из кода>

#### СТАЛО
<полный переписанный SYSTEM — глубина эталона §8: роль · принципы · структура · правила · чего НЕ делать>

#### USER (если меняется)
#### ИЗМЕНЕНИЕ КОНТРАКТА (если нужно новое поле/схема)
#### Что изменили (1–3 строки)
```

### Сквозные правила переписывания (применяются ко всем файлам)

1. **Контракт не ломаем.** СТАЛО обязан давать вывод, валидный под **ту же** схему / тот же tool /
   тот же тип ответа. Имена tool/схем — реальные из кода (`submit_meeting_analysis`,
   `extract_sales`, `regulation_extract_v1`, `extract_tasks`, …), не выдуманные.
2. **Новое поле = блок «ИЗМЕНЕНИЕ КОНТРАКТА».** Указываем файл-схему (Zod + JSON-schema + TS-тип) и
   обновлённый фрагмент. Без пометки новое поле запрещено (валидатор отбракует).
3. **E1/E2 (ASR-нота, анти-инъекция) — обёрткой на call-site, НЕ текстом SYSTEM.** В переписанном
   SYSTEM их не дублируем — помечаем «обёртка на call-site» (`wrapUserData` + `withInjectionGuard`
   + опц. `withAsrNote` из `common.ts`). Это решение хэндоффа §4 и принцип ТЗ «гард конструкцией».
4. **Cache-friendly.** Стабильный текст → SYSTEM; переменные данные (транскрипт, участники, дата) →
   в КОНЕЦ user. Переменное в SYSTEM не вставляем (ломает prompt-cache провайдеров).
5. **Несколько каллеров — учитываем все** (напр. `tasks-unified` под 3 пути): СТАЛО не должен
   сломать ни один.
6. **Решения владельца Р1–Р5 (из ТЗ):**
   - **Р1** — v2-стек (`tasks-v2`/`summary-v2`/`chapters-v2`) на ретайр → **НЕ переписываем**.
   - **Р2** — «Инструкция» = first-class сущность (`kind='instruction'` в `regulation-extract` и
     `specialists-combined` + новая таблица). В этих промптах — изменение контракта.
   - **Р4** — `process-steps-extract` сирота → **НЕ переписываем** (ретайр).
   - **Р5** — `runTasks`/`AiResult.tasks` мёртвые → legacy `tasks.ts` усиливаем в общем builder,
     но помним, что путь будет убран.
7. **Перепроверка по коду (хэндофф §11).** Каждое «БЫЛО» сверяется с реальным файлом промпта,
   контракт — чтением вызывающего сервиса/воркера. Где находка аудита не подтвердилась — помечаем
   «не подтверждено кодом» и не применяем.

---

## 1. Карта файлов (категории флота)

Флот — 145 промптов. На ретайр (Р1/Р4) — 4 (не переписываем). Остаётся **~120 на усиление**,
разложены по категориям-файлам. Приоритет (🔴high / 🟡med / 🟢low) — из Приложения Б аудита.

Все файлы **сделаны и сверены по коду** (≈14 000 строк рерайтов). Фактическое разбиение — 21 файл (крупные категории разбиты на под-батчи ~6–10 промптов):

| Файл | Категория | Промптов | Статус |
|---|---|---|---|
| `01-pilot-exemplars.md` | **Пилот** (6 эталонов, все типы контракта) | 6 | ✅ принят |
| `10a-report-by-type-internal.md` | type-* внутренние (team/standup/plan_fact/project/review/retro/interview) | 7 | ✅ |
| `10b-report-by-type-client.md` | type-* клиентские (custdev/partner/customer_success) — дуальный сплит | 3 | ✅ |
| `11-main-report-and-summaries.md` | summary, follow-up, regenerate, custom-report, card-rollup v1 | 5 | ✅ |
| `12a-tasks-and-quality.md` | tasks (каллеры), extract-actions, quality-score, behavior-refine, transcript-clean | 5 | ✅ |
| `12b-smart-tables.md` | table-extract-rows/infer-schema/architect/entity-check/semantic-filter/auto-fill | 6 | ✅ |
| `20-graph-extractors.md` | block-ingest, axis-classify, distill, linker, entity-merge/link, reframing, theme | 8 | ✅ |
| `21a-specialists-decisions-insights-ideas.md` | decision/insight/idea (+supersede/link/cluster/status) | 7 | ✅ |
| `21b-specialists-skills-helpfulness-experiments.md` | skill-trait, helpfulness, experiment, practice-skill | 10 | ✅ |
| `21c-specialists-regulations-clone-arbiters.md` | regulation-dedupe, process-template, clone-knowledge, task-dedupe, fact-supersede | 6 | ✅ |
| `21d-specialists-goals-roles-persona-combined.md` | goal-*, role-profile/map, persona, specialists-combined | 8 | ✅ |
| `30-card-rollup-v2-rest.md` | card-rollup-v2 deal/project/topic/vendor/custom | 5 | ✅ |
| `40a-concierge-and-clones.md` | concierge(+PRM), clone-respond (factual/judgmental), chat-v2 clone-style | 5 | ✅ |
| `40b-chat.md` | chat-v2 (factual/synthetic/title/synthesize), chat v1 (single/cross) | 6 | ✅ |
| `40c-dialog-layer.md` | dialog-layer (summarize/classify/contextualize/confidence/multi-query×2) | 6 | ✅ |
| `50a-operations-digests.md` | daily/weekly/customer-risk/blocker/personal-brief/value-recap + checkin-sentiment×2 | 8 | ✅ |
| `50b-dashboard.md` | dashboard-summary, forecaster, goal-vector, team-health, decision-hygiene, hr-recommender, reflection-quality | 7 | ✅ |
| `50c-goals-tracker-proactive.md` | goals-pulse, sprint-digest×2, sprint-helper/review, recognition, proactive, goal-alignment | 8 | ✅ |
| `60a-inbound-tracker-classifiers.md` | commitment, checkin-parser, speaker-analyzer, intake-auto-triage, issue-infer/goal | 6 | ✅ |
| `60b-telegram-probe-feedback-ingest.md` | telegram×4, probe×2, feedback-cluster, brand-voice, chatbox-summary, autorule, doc-attribution | 11 | ✅ |
| `60c-debate-orchestrator.md` | debate (stance/curation), orchestrator (plan/synth/verify/subagent) | 6 | ✅ |
| `90-helpers.md` | glossary, participant-context, sanitize-custom-prompt | 3 | ✅ |

**Итого:** 6 (пилот) + ~126 промптов-единиц по 21 файлу. **Не переписаны (ретайр Р1/Р4):** `tasks-v2`, `summary-v2` (15 веток), `chapters-v2`, `process-steps-extract`.

---

## 2. Сводка типов контракта (что встречается во флоте)

| Тип | Что в коде | Примеры | Как переписывать |
|---|---|---|---|
| **tool-use** | `LlmTool` + `input_schema`, `tool_choice` | meeting-report-fast `submit_meeting_analysis`, type-* `extract_*`, tasks `extract_tasks`, behavior-refine, quality-score, specialists-combined `submit_all_8_entities` | СТАЛО даёт те же обязательные поля; «ВАЖНО: верни через инструмент X» оставить |
| **json_schema strict** | `responseFormat:{type:'json_schema',strict}` + `*_JSON_SCHEMA` + `*_SCHEMA_NAME` | regulation-extract `regulation_extract_v1`, chapters `chapters_v1`, block-ingest, decision/insight/idea/goal/skill-trait, axis-classify | «строго JSON по схеме X» оставить; root всегда object |
| **json_object** | «верни валидный JSON» без strict | regenerate-section `{value}`, table-extract-rows `{facts}`, card-rollup v1 | «только валидный JSON без markdown» оставить |
| **bare-array** | голый JSON-массив | tasks-unified при `responseAsBareArray`, behavior-refine USER | «ТОЛЬКО JSON-массив» оставить для этого пути |
| **free-text / Markdown** | без схемы | summary, follow-up(body), card-rollup-v2, дайджесты, чаты, clone-respond | свободный текст оставить свободным; структуру задавать разделами Markdown |

---

## 3. Прогресс — ЗАВЕРШЕНО

- [x] Прочитаны 4 опорных дока (каталог 1960 стр, аудит 1016 стр, методология, ТЗ).
- [x] **Пилот** (`01`, 6 эталонов) — принят владельцем (формат/глубина/дуальный сплит/call-site).
- [x] **Весь флот** (21 файл, ~126 промптов) — переписан оркестрацией (Workflow `wf_57af514e`,
      42 агента: переписывание → независимая сверка по коду).
- [x] **Ремонт** (Workflow `wf_09d621e0`, 8 агентов) — устранены 11 значимых находок сверки
      (1 high + 10 medium), включая ложную посылку про спикеров в chat v1 и гейт `kind=instruction`.
- [x] Мастер-список изменений контракта/кода — §4. Call-site (Фаза 2) — §5. QA-сводка — §6.

> **Как делалось:** суб-агент на категорию-файл сперва читал реальный промпт-файл + каллер
> (фиксировал НАСТОЯЩИЙ контракт), затем писал «БЫЛО → СТАЛО» по эталону пилота; отдельная стадия
> адверсариально сверяла контракты и цитаты «БЫЛО» с кодом. Сверка поймала и баги самого кода
> (см. §4 «попутно найдено»), и дефекты собственного вывода (исправлены ремонтом).

---

## 4. Мастер-список изменений контракта/кода (для реализации по ТЗ)

> Подавляющее большинство промптов — **контракт прежний**, усиление только в тексте SYSTEM.
> Ниже — те, что требуют правки **схемы/кода** (помечать «ИЗМЕНЕНИЕ КОНТРАКТА» в ТЗ).

**A. Изменение схемы (Zod + JSON-schema + миграция):**
1. `regulation-extract` (`regulation_extract_v1`): `kind += 'instruction'` (Р2) + новое поле
   `status ∈ {confirmed|proposed|needed|discussed}` (I5). → миграция, `Instruction`-таблица (Фаза 10).
2. `specialists-combined` (`submit_all_8_entities`): `regulations[].kind += 'instruction'` —
   **синхронно** с п.1. **Гейт:** не вводить в SYSTEM до обновления схемы (иначе Zod-reject).
3. `type-customer_success` (`extract_customer_success`): новое поле `churn_risk_quote: string|null`.
4. `type-sales` (`extract_sales`): новые internal-поля `decision_criteria[] · what_hooked · competitors[]
   (вкл. «ничего не делать») · main_blocker` (пилот §2).
5. *(опц., решение владельца)* `role-profile-build`: новое поле `open_questions[]` (G1).
6. *(опц.)* `debate-curation`: отдельная схема `debate_curation_vote_v1` с `verdict ∈ {accept|reject}`.

**B. Новые агенты (конструкция B3 — нейтральный протокол наружу):**
7. `client-meeting-split` / `partner-meeting-split` / `cs-meeting-split` — free-text Markdown,
   отдельные `taskType`; протокол физически без internal-полей (Фаза 3 ТЗ).

**C. Изменение USER/builder (не схема, но правка кода):**
8. `intake-auto-triage`, `issue-infer-fields` — прокинуть «текущую дату» в user (E3).
9. `follow-up` — прокинуть участников + дату встречи в user (A4/E3).
10. `goal-alignment` — убрать мутацию SYSTEM при `daysUntilTarget≤7` (значение уже в user) → cache-friendly (F1).
11. `clone-respond` (factual/judgmental) — вынести `roleName/bearerName/persona` из SYSTEM в user (F1).
12. `tasks-unified` — вынести анти-«надо бы» в `BASE_SYSTEM`/`STRUCTURED_BASE_SYSTEM` (пилот §5).
13. `card-rollup-v2` (все kind) — подать текущий `summaryCache` в user (режим накопления F2).
14. `decision-extract` — убрать безусловный дефолт `status='approved'` (C2).
15. `telegram-create/forward-task` — merge в один builder `mode=own|forward`; `today` из SYSTEM → user.

**D. КРИТИЧНО — без этого СТАЛО нефункционален:**
16. `commitment-extract-status` — добавить статус `'unclear'` в union `ExtractedStatus` +
    `parseExtractedJson`; при `unclear` НЕ писать `missed` (иначе «не понял ответ» необратимо ломает метрику).

**E. Попутно найдено в коде (баги/устаревшее — правка вне промптов):**
17. `insight-extract` USER ссылается на `insight_extract_v1`, а имя схемы — `insight_extract_v2` (правка файла).
18. `sprint-helper-suggest` SYSTEM: опечатка `due_due_at_risk` → `due_date_at_risk` (enum).
19. `fact-supersede-detect`: устаревший комментарий «caller ИГНОРИРУЕТ confidence» — на деле это **вес ребра графа**; нужны якоря C1.
20. `regulation-dedupe`: описание `extension` врёт про «новую версию» — код делает plain `update`.
21. `idea-status-summarize`: SYSTEM «≤80 симв», схема `maxLength:200` — выровнено.
22. `intake-auto-triage`: якорь `0.92` в промпте ≠ реальный порог `0.75` (`AdminSetting`) — синхронизировать.

---

## 5. Call-site работа (Фаза 2 ТЗ) — E1/E2 обёртки

Сверка подтвердила (или пометила «проверить»), что у **многих** сервисов нет `wrapUserData` +
`withInjectionGuard` (+ опц. `withAsrNote`) на call-site. Это **не дефект рерайта** — по методологии
E1/E2 держатся обёрткой кода, а не текстом SYSTEM. Список «добавить обёртку» (Фаза 2), по сервисам:
`ChapterExtractionService`, `TaskExtractionService`, `RegenerateService`, `quality-score.worker`,
`CardRollupService`(v1), `transcript-clean-refine`, `process-extraction.service`, `probe-formulate`,
`role-profile/role-map-builder`, `meeting-speaker-analyzer`, `custom-report.worker`, `table-*`,
operations-дайджесты (6), `dashboard-summary/goal-vector/decision-hygiene/reflection-quality`,
`goals-pulse/sprint-*-digest/recognition/proactive/goal-alignment`, `concierge`(мутирующие tools!),
`intake-auto-triage`(внешний канал!), `telegram-*`, `feedback-cluster`, `brand-voice-extract`,
`chatbox-summary`, `chat v1` (single/cross/card), `checkin-parser/sentiment`, `practice-skill`,
`specialists-combined`, `entity-merge/block-distill/block-linker/reframing` (проверить).
**Уже есть обёртка** (повторно не нужно): `analyze.worker`, `regulation-extract`(по флагу),
`experiment-extract`(specialist-3-9), `helpfulness-trait-merge`(specialist-3-8), `chat-v2.ask`(по флагу),
`card-rollup-v2`, `sprint-helper/review`(частично — нужен `wrapUserData`).

---

## 6. QA-сводка (как сверяли)

- **Метод:** каждый батч — переписывание + **независимый** адверсариальный verify (другой агент
  перечитывал реальный код, проверял: верно ли назван контракт, нет ли «тихих» новых полей,
  не дублируется ли E1/E2 в тексте, правдиво ли «БЫЛО», есть ли дуальный сплит у клиентских).
- **Найдено:** 1 high + 10 medium + 42 low проблемы качества; **0 упавших записей**. Все high/medium
  устранены ремонтом. Low — косметика (оформление code-block, мелкие неточности «БЫЛО»).
- **Ценность сверки по коду:** опровергнуты находки аудита, которые код не подтвердил (напр.
  `chapters` — это `json_schema`, не `json_object`; `feedback-cluster` — `json_object`, не `json_schema`;
  guard у experiment/helpfulness-merge **уже есть**; провенанс спикера в chat v1 **невозможен** — нет `speakerName`).
- **Остаточные «проверить перед Фазой 2»:** номера строк call-site в части сервисов даны ориентировочно
  (агент не во всех читал тело метода) — верифицировать при реализации обёрток.
