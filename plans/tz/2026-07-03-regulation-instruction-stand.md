---
type: tz
feature: regulation-instruction-stand
title: "Стенд качества агентов регламентов/инструкций (extractor → arbiter → compiler)"
status: ready-to-implement
date: 2026-07-03
owner: владелец (sergrv80@gmail.com)
situation_matrix: plans/analysis/2026-07-03-regulation-instruction-stand-situation-matrix.md
methodology: docs/methodology/synthetic-fidelity-eval-method.md
handoff: docs/testing/regulation-stand-agent-prompt.md
code:
  - backend/src/modules/knowledge-core/services/specialist-3-1-regulations.service.ts
  - backend/src/modules/knowledge-core/prompts/regulation-extract.prompt.ts
  - backend/src/modules/knowledge-core/prompts/regulation-dedupe.prompt.ts
  - backend/src/modules/knowledge-core/prompts/structured-document-compiler.prompt.ts
  - backend/src/modules/knowledge-core/services/regulation-consolidator.service.ts
  - backend/src/modules/knowledge-core/workers/specialist-routing-dispatcher.worker.ts
---

# ТЗ — Стенд качества агентов регламентов и инструкций

> Контракт для реализации (скилл `tz-orchestrator`, фаза за фазой). Ситуации, которые покрываем, —
> [карта 360°](../analysis/2026-07-03-regulation-instruction-stand-situation-matrix.md). Строки кода дрейфуют
> — при реализации досверяться по символу. Прод не трогаем: стенд — на **throwaway-тенанте**, `assertNotProd`
> первым вызовом каждого скрипта.

## 0. Цель, границы, инварианты

**Цель:** измерительный стенд, который на синтетическом корпусе (все ситуации из карты 360°) прогоняет
реальный конвейер трёх агентов Специалиста 3.1 и сверяет фактический выход с **эталоном** (ground truth):
правильно ли экстрактор понял вид/суть/фильтры, правильный ли исход у арбитра (дубль/дополнение/противоречие/
distinct), корректно ли компилятор собрал и **дополнил** текст без потери старого. Итог — scorecard по агентам
с атрибуцией провалов к конкретному агенту.

**Границы:**
- Тестируем **только** Специалист 3.1 (3 агента) + консолидатор. Block-ingest (нарезка/тегирование сигнала) —
  **не** в scope: подаём готовые `IdeaBlock` с заданным `signalType` (изоляция агентов под тестом).
- Поведение прод-кода **не меняем**. Стенд — только чтение + отдельный тенант. Правки прод-кода нет.
- Всё на одном локальном стенде (Postgres :55435 dev), реальный LLM (ключи в `.env`).

**Инварианты линейки (целятся петлёй ПОСЛЕ baseline, здесь замеряются):**
kind-accuracy ≥90% · org-norm filter precision=1.0 (0 мусора материализовано) · no_false_merge=100% (0 ложных
слияний) · preservation=100% (0 потерь старого при дополнении) · contradiction recall ≥90% на явных.

## 1. Файлы (контракт)

```
backend/scripts/regulation-stand/
  stand.ts            диспетчер: prepare | build | annotate | run | judge | report | all
  seed-reg-feed.ts    Фаза 0: throwaway-тенант + Person/роли (для ownerHint) + конфиг + посев блоков корпуса (ПО ПОРЯДКУ)
  annotate.ts         Фаза 2: слепые разметчики корпуса → манифест ожидаемого (партиями ~10)
  match.ts            Фаза 3: read-only сверялка БД ↔ эталон (все 4 таблицы + версии + конфликты + deprecated)
  judge.ts            Фаза 4: панель majority-of-3 (смысловая сверка полей + исходов) через directLlmCall
  report.ts           Фаза 5: scorecard по агентам + confusion-матрицы + ловушки + финальные счётчики + идемпотентность
docs/testing/
  regulation-stand-corpus.json   синтетический корпус: сценарии (сырьё-блоки, с порядком подачи)
  regulation-stand-ruler.json    эталон: ожидаемый выход на каждый сценарий (авторский, кросс-проверяется слепой разметкой)
  regulation-stand.md            README стенда (по образцу clone-stand.md / probe-stand.md)
  regulation-stand-report.md     отчёт (scorecard + матрицы + диагнозы) — генерит report
  regulation-stand-agent-prompt.md  хэндофф-промпт свежему агенту-исполнителю
```

Образец диспетчера/бутстрапа — `backend/scripts/clone-stand/stand.ts` (`assertNotProd`, `NestFactory.createApplicationContext(AppModule)`), `_lib/{combat-harness,llm-direct,prisma}.ts`.

## 2. Предусловия окружения

- `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435, Redis :56381, MinIO).
- **Живой backend с воркерами** (`cd backend && bun run dev`) — для Фазы 1 (build), если триггерим специалист
  через очередь `specialist-routing-dispatcher`. Раннеры annotate/run/judge/report сами бутстрапят AppModule.
- Один свежий backend (нет орфанов `bun run dev` — залипшая очередь стопорит; урок clone-stand).

## 3. Конфигурация стенда (среда замера, не поведение)

Выставить ПЕРЕД build (tenant-scoped на throwaway-тенант, чтобы не трогать прод-поведение глобально):
- `aiFeatures.regulationConsolidatorEnabled = true` (консолидатор включён — иначе A2 не сработает);
- **компилятор документа включён** — досверить флаг (`docCompiler` опционален; выключен → `contentMd=statement`,
  A3 не проверить). Зафиксировать фактическое состояние флага в отчёте;
- **LlmTaskRoute** для `regulation-extract`, `regulation-dedupe`, `compile-org-document` — снять реально
  применённые модели (`diag-llm-routes.ts`), зафиксировать в отчёте (детерминизм замера);
- пороги кандидатной выборки (консолидатор `CANDIDATE_COSINE_MIN=0.82` хардкод; арбитр KNN) — зафиксировать
  как есть, отметить в отчёте (влияет на «дубль не дошёл до арбитра»);
- эмбеддер живой (fail-open логировать — иначе KNN деградирует на name-like).

## 4. Формат корпуса (`regulation-stand-corpus.json`)

Массив сценариев. Каждый = один или несколько блоков-источников, подаваемых **по порядку** (`order` управляет
merge/extension/contradicts — дубль приходит ПОСЛЕ оригинала).

```jsonc
{
  "id": "A2.4-contradicts-signer",       // ячейка карты + краткое имя
  "agentFocus": "arbiter",                // extractor | arbiter | compiler | cross
  "cell": "A2.4",                          // ссылка на карту ситуаций
  "channel": "planerka",                   // planerka|chat|document|interview (ось 360°)
  "trap": true,
  "boundaryPair": "extension|contradicts", // для граничных — что рядом
  "blocks": [
    {
      "order": 1,
      "signalType": "regulation",          // regulation|process_step|policy
      "name": "Подписание договоров",
      "criticalQuestion": "Кто подписывает договоры?",
      "trustedAnswer": "Договоры подписывает только директор.",
      "evidenceQuotes": ["Договоры подписывает только директор"],
      "tags": ["договоры","подпись"],
      "ownerCompanyPrior": "неизвестно",   // приор для экстрактора
      "meetingExternalLikely": false
    },
    { "order": 2, "signalType": "regulation", "name": "Подписание договоров",
      "trustedAnswer": "Договоры подписывает руководитель проекта.", "...": "..." }
  ]
}
```

**Изоляция входа:** блоки создаём напрямую в БД (`IdeaBlock` + `IdeaBlockEvidence`), `signalType` задаём мы
(не полагаемся на block-ingest). Триггер специалиста — штатным путём через `specialist-routing-dispatcher` ИЛИ
прямым вызовом `Specialist31Service.processRegulationBlock/processProcessStepBlock/processPolicyBlock` (детерминистичнее).

## 5. Формат эталона (`regulation-stand-ruler.json`) — «линейка»

На каждый сценарий — ожидаемый выход, разложенный по агентам:

```jsonc
{
  "id": "A2.4-contradicts-signer",
  "expected": {
    "extractor": {                         // на каждый блок
      "byOrder": {
        "1": { "kind": "regulation", "isOrgNorm": true, "ownerCompany": "наша",
               "isKeepableOrgNorm": true, "extractionStatus": "существует",
               "scope": "org", "roles": [], "severity": null, "category": "regulation",
               "materialized": true, "statementGist": "договоры подписывает директор" },
        "2": { "kind": "regulation", "materialized": true, "statementGist": "подписывает руководитель проекта" }
      }
    },
    "arbiter": { "byOrder": { "2": { "verdict": "contradicts", "targetIsOrder": 1 } } },
    "compiler": { "byOrder": { "2": { "mode": null } } },  // при contradicts тело не сливается
    "final": {
      "cardsByType": { "regulation": 1 },  // ожидаемое число активных карточек
      "conflictItems": [ { "resourceType": "regulation", "relationType": "contradicts" } ],
      "deprecated": 0
    }
  }
}
```

Поля для других фокусов:
- **extractor-фокус:** `kind`, фильтры (`isOrgNorm/ownerCompany/isKeepableOrgNorm/notabilityReason`),
  `materialized` (создалась ли карточка), `statementGist`, `scope/roles/severity/category`, `confidenceBand`.
- **arbiter-фокус:** `verdict ∈ {new,merge,extension,contradicts,distinct}`, `targetIsOrder`.
- **compiler-фокус:** `contentMustContain[]` (пункты, что обязаны быть), `contentMustPreserve[]` (старые пункты
  сохранены), `noDuplicatePoint`, `steps[]` (для process), `mode ∈ {create,extend}`.
- **ownership-фокус (A4):** `ownership.byOrder[n]` — `ownerResolved` (имя человека или null), `subjectPersons[]`
  (кто растёт), `mustNotInclude[]` (кого НЕ должно быть — анти-кросс-клон), `growsClone`, `ownerReassignedFrom/To`,
  `staleOwnerCleared`; `cloneTrace` — `usedRegulationNamesNotFabricated`, `expectedUsedRegulationNames`.
- **final:** `cardsByType`, `conflictItems`, `deprecated`, `ownerPersonId`, `personSubjectIds`.
- **Сценарии A4 требуют посеянных персон** (`scenario.requiresPersons`): Иван-юрист, Дарья-маркетолог,
  Елена/Игорь-поддержка, Сергей-директор, Пётр-безопасник; `scenario.ownershipEvent` — событие смены носителя.

**Правила эталона (методология §2, три против тавтологии):**
1. Эталон авторский (пишем мы, зная замысел сценария) — но **кросс-проверяется слепой разметкой** (`annotate.ts`):
   2+ агента читают ТОЛЬКО сырьё сценария, независимо выводят ожидаемое, ревизор сверяет с авторским.
   Расхождение = сценарий неоднозначен → нормируем или помечаем `boundaryPair` (это не шум).
2. Разметку пишет слепой агент, извлекает — прод-агент; не сверять выход LLM с эталоном от той же LLM из той же прозы.
3. Матч — **по смыслу** (нормализация + судья 2-из-3), не строгий substring; пороги первого прогона = baseline.

## 6. Метрики (`report.ts`)

**A1 Экстрактор:**
- `kind_accuracy` + **confusion-матрица 5×5** (где путает границы A1.2);
- `orgnorm_filter` — precision (0 мусора материализовано: чужая практика/гипотетика/one_off/product_demo) и recall (0 выброшенных норм);
- `ownercompany_accuracy` (ловушка «клиент-на-продаже»);
- `keepability_accuracy`; `field_fidelity` (scope/roles/severity/category/owner); `confidence_calibration`.

**A2 Арбитр:**
- `verdict_accuracy` + **confusion-матрица 5×5** (new/merge/extension/contradicts/distinct);
- `no_false_merge` (**ключевой** — 0 ложных слияний разных норм);
- `merge_recall` (нашёл дубль), `extension_correctness`, `contradiction_recall/precision`;
- разделять «арбитр ошибся» vs «пара не дошла до арбитра» (кандидатная выборка / неверный kind от A1).

**A3 Компилятор:**
- `preservation` (**ключевой** — старое не потеряно при дополнении), `no_duplication`, `structure_fidelity`
  (шаблон типа), `steps_sync` (process ↔ ProcessStep), `conflict_signal`.

**A4 Владение (owner + subject → клон):**
- `owner_accuracy` — верно ли резолвится `ownerPersonId` (по имени; роль-без-имени → null, не выдумка);
- `subject_accuracy` — верно ли `personSubjectIds` (норма растёт к правильному человеку/клону);
- `no_cross_clone_leak` (**ключевой**) — норма НЕ прицепляется к чужому клону (упоминание ≠ владение);
- `ownership_carry` — при merge/extension/supersede/переназначении владелец+субъект переносятся консистентно, депрекейт не тащит старое;
- `desync_no_fabrication` (**корень**) — при смене носителя/сироте: старый снимок клона НЕ продолжает называть
  регламент как свой; клон без привязанных правил даёт `usedRegulationNames=[]` (честно), а не выдуманное имя из
  старого снимка. (Требует построить клон и снять трассу `usedRegulationNames` — мост к clone-stand; ось L.)

**A5 Решения задач (`TaskSolution` — после реализации сущности, ТЗ 2026-07-07):**
- `created_correctly` (создаётся при содержательном ответе; нет ответа/тривиальное → не плодим);
- `one_per_task` (одна задача → одна сущность, идемпотентность суточной сборки);
- `owner_is_solver` (**ключевой** — владелец=решавший, не упомянувший; ось A4);
- `built_from_daily` (собирается и из дневных упоминаний, не только из опроса);
- `dual_purpose` (клон по-прежнему кормится); `repeat_candidate` (повтор ×N → флаг кандидата в инструкцию, без авто-создания);
- `not_a_solution` (общее рассуждение без привязки к задаче → НЕ TaskSolution, только клон).

**Сквозные:** `final_card_count` vs эталон · `conflict_items` vs эталон · `idempotency` (второй прогон Δ=0) ·
`versioning_integrity` (история версий полна) · `deprecation` (проигравший при merge).

Вердикт провала атрибутируется к агенту: A1 (mis-classify / mis-filter) · A2 (false-merge / miss-dup / miss-contradiction) ·
A3 (content-loss / dup / structure) · pipeline (candidate-miss / route / infra).

## 7. Фазы

- **Ф0 prepare** (`seed-reg-feed prepare`): throwaway-тенант (новый org), **посев именованных Person + ролей**
  (Иван-юрист, Дарья-маркетолог, Елена/Игорь-поддержка, Сергей-директор, Пётр-безопасник — для резолва
  `ownerHint`/subject в оси A4; person-упоминания в блоках через `IdeaBlockEntity type=person`), tenant-scoped
  конфиг §3, `assertNotProd`. Печатает `ORG_ID=`. Для A4.4 (смена носителя) — провести `role.bearer_changed`
  Елена→Игорь между блоками сценария (как в clone-stand).
- **Ф1 build** (`build`): посев блоков корпуса ПО ПОРЯДКУ → триггер специалиста на каждый → ждать устаканивания →
  прогон `consolidateTenant` (свод). Логировать что материализовалось.
- **Ф2 annotate** (`annotate`): слепые разметчики корпуса → манифест ожидаемого + agreement; сверка с авторским
  эталоном (партиями ~10).
- **Ф3 run/match** (`run`): read-only снимок БД (regulations/instructions/policies/processes/processSteps/
  cardVersions/conflictItems) → пер-сценарные вердикты found/wrong/missing по агентам.
- **Ф4 judge** (`judge`): панель majority-of-3 (смысловая сверка полей + исходов) через `directLlmCall`
  (deepseek-v4-pro, JSON-схема tool-call, retry×3).
- **Ф5 report** (`report`): scorecard + confusion-матрицы + ловушки + финальные счётчики + идемпотентность +
  диагнозы с атрибуцией к агенту. MD+JSON, архив per-run.

## 7.1 Фазовый прогон ПО 50 сценариев + гейт решения (обязательно)

Корпус — 493 сценария. **НЕ гонять все 493 разом.** Идём батчами по ~50 со стоп-гейтом после каждого —
систематическая ошибка класса видна рано, и нет смысла жечь LLM на всех 493, если картина ясна уже на 50.

**Нарезка (stratified, не подряд):** батч из 50 — **репрезентативный срез по всем агентам и ячейкам**
(экстрактор/арбитр/компилятор/сквозные пропорционально их доле в корпусе), а не 50 однотипных. Так первые 50
дают срез 360°, а не только A1. Стратификация — по полям `agentFocus` + `cell` (округляя доли). Батчи
детерминированы (стабильный порядок по `id`), помечены `batch:1..N`.

**Цикл на каждый батч:** `build` (только сценарии батча) → `annotate` (если ещё не размечены) → `run` →
`judge` → `report(batch)`. Затем **ГЕЙТ РЕШЕНИЯ** (записать в отчёт явно, одним из):
- `stop-clear` — картина уже ясна (систематический провал класса воспроизвёлся стабильно ИЛИ всё зелёно и
  ровно) → дальнейшие батчи не добавят сигнала, останавливаемся, пишем вывод;
- `continue` — сигнал ещё шумный / встретились новые классы / числа не стабилизировались → следующий батч;
- `fix-first` — вскрылся явный баг конвейера, который заблокирует остальные батчи → сначала фикс (отдельным ТЗ),
  потом продолжить.

**Изоляция сценариев (важно для чистоты):** консолидатор смотрит кандидатов по ВСЕМУ тенанту того же вида —
разные сценарии могут случайно перекрёстно слиться и испортить `final.cardsByType`. Гонять каждый сценарий в
своём scope (напр. отдельный throwaway-тенант на батч, ИЛИ уникальный `scope`-тег на сценарий, ИЛИ чистка
между сценариями), КРОМЕ сквозных СК6 (масштаб/шум), где несколько норм в одном тенанте — часть замысла.

**Отчёт по батчам кумулятивный:** `report` держит «было→стало» по батчам (batch 1: …, batch 2: …), чтобы
видеть, стабилизировались ли метрики. Baseline считается снятым, когда достигнут `stop-clear` ИЛИ пройдены все
батчи.

## 8. Ловушки (учесть обязательно)

- **Атрибуция каскада A1→A2:** неверный kind у экстрактора → арбитр ищет в другой таблице → дубль не найден.
  Провал вешать на A1, не A2.
- **«Дубль не дошёл до арбитра»:** cosine-выборка кандидатов (0.82/KNN) может не поднять дубль «другими словами» →
  ложный `new`. Метрика обязана отличать это от «арбитр решил new».
- **Компилятор опционален** — если флаг выключен, A3 не тестируется (`contentMd=statement`). Включить и зафиксировать.
- **Порядок подачи** — merge/extension/contradicts требуют, чтобы кандидат уже существовал; `order` в корпусе строгий.
- **Резолв ownerHint** — нужны посеянные Person/роли, иначе `ownerPersonId=null` (не путать с провалом извлечения).
- **human-guard** — не выставлять `trustTier='human'` на стенд-карточки (иначе консолидатор их пропустит).
- **throwaway-тенант, не «Стрела»** (та занята recall/consolidation-замерами); `assertNotProd` первым.
- **Идемпотентность** — второй прогон build не должен плодить (проверка СК4); чистить дедуп-negative-cache между прогонами при нужде.
- **PrismaClient** — `createPrismaClient()` из `_lib/prisma.ts` (не голый `new PrismaClient()`).
- **Стендовые скрипты — НЕ прод** → в `apply-prod-deploy.ts STEPS` и `prod-deploy-log` НЕ вносить.

## 9. Acceptance

- [ ] стенд гоняется по-фазно и **батчами по 50** (`stand.ts run --batch N`) с гейтом решения (§7.1);
- [ ] корпус покрывает карту 360° (каждая ячейка ≥1, критические ≥3); эталон кросс-проверен слепой разметкой;
- [ ] baseline снят: scorecard по A1/A2/A3/**A4 владение** + confusion-матрицы + ловушки + финальные счётчики + идемпотентность;
- [ ] **ось A4 проверена:** owner/subject-резолв, no_cross_clone_leak, ownership_carry, и **desync_no_fabrication**
  (смена носителя → старый снимок не выдумывает `usedRegulationNames`);
- [x] **ось A5 (после реализации `TaskSolution`) — baseline снят 2026-07-07:** harness
  `backend/scripts/regulation-stand/` (синтез-режим), 12 сценариев → **PASS 9 · FAIL 2 · N/A 1**.
  Проверены: created_correctly · one_per_task · **owner_is_solver** (структурно, owner=`Issue.assignee`) ·
  no_cross_clone_leak · built_from_daily · dual_purpose · not_a_solution · preservation. Провалы:
  `a5-no-answer` (гейт по длине пропускает пустой ответ) · `a5-multi-solver` (соисполнитель не в
  `personSubjectIds`). `repeat_candidate` — N/A (нет эмбеддингов локально). Отчёт —
  `docs/testing/regulation-stand-report.md`. Оси A1–A4 — ещё не в harness;
- [ ] провалы атрибутированы к агенту (A1/A2/A3/A4/pipeline); конфигурация прогона (флаги + модели) зафиксирована;
- [ ] `typecheck/lint/build` зелёные по затронутому; прод не тронут; README `regulation-stand.md` написан;
- [ ] хэндофф-промпт `regulation-stand-agent-prompt.md` готов (свежий агент берёт и запускает).

## Итог
Реализовано частично: **ось A5 (Решения задач / TaskSolution)** — harness `backend/scripts/regulation-stand/`
(режимы prepare/build/match/judge/report), синтез-режим (блоки how-solved воссозданы из корпуса как ground
truth, запускается реальный `TaskSolutionBuildService`). Baseline 2026-07-07 (HEAD после Фазы 6 TaskSolution):
**PASS 9 · FAIL 2 · N/A 1**, идемпотентность Δ=0. Два реальных дефекта материализатора:
1. **no-answer гейт слаб** — материализация решается по длине сигнала (`minSignalChars=40`), а не по
   содержательности: «Да фигня, само решилось» (45 симв) плодит пустое решение из `[требует уточнения]`.
2. **multi-solver subject-growth** — `personSubjectIds` всегда = `[owner]`; соисполнитель (текст решения его
   знает) не попадает в субъекты → его клон не растёт.

Оси A1/A2/A3/A4 (экстрактор/арбитр/компилятор/владение регламентов) в harness ещё НЕ реализованы — остаются
по фазам §7. Дальнейшее: (а) фиксы двух A5-дефектов отдельным ТЗ; (б) достройка A1–A4 harness.
