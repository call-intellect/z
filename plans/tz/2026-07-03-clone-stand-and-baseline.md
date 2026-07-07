---
type: tz
feature: clone-stand-and-baseline
title: "ТЗ-0 — Стенд качества клонов + baseline (без разворота поведения)"
status: ready-to-implement
date: 2026-07-03
owner: владелец (sergrv80@gmail.com)
approved_decisions: [Р1, Р2, Р4, Р5, Р6, Р7]
entrypoint: plans/2026-07-03-employee-clone-quality-HANDOFF.md
architecture: plans/architecture/2026-07-03-clone-quality-stand.md
audit: plans/analysis/2026-07-03-employee-clone-expert-answer-audit.md
cartography: plans/analysis/2026-07-03-clone-stand-code-cartography.md
methodology: docs/testing/stand-methodology.md
layer0_method: docs/methodology/synthetic-fidelity-eval-method.md
bank: docs/testing/clone-stand-questions.json
journal: plans/2026-07-03-clone-stand-execution-journal.md
---

# ТЗ-0 — Стенд качества клонов сотрудников + baseline

> **Контракт для реализации** (исполняется скиллом `tz-orchestrator`, фаза за фазой). Верхнеуровневый
> проект — [architecture/2026-07-03-clone-quality-stand.md](../architecture/2026-07-03-clone-quality-stand.md)
> (status: approved). Точные якоря кода — [код-картография](../analysis/2026-07-03-clone-stand-code-cartography.md).
> Строки дрейфуют — при реализации фазы досверяться по символу (не по номеру).

## 0. Цель, границы, инварианты

**Цель ТЗ-0:** построить работающий измерительный стенд `clone-stand`, наполнить 4 клона-цели с
известным ground truth, снять **Слой 0** (фиделити построения) и **baseline** (распределение вердиктов
на 110 вопросов) — точку отсчёта «как есть» ДО любого разворота поведения.

**Жёсткие границы (Р5/Р6):**
- Поведение клона **НЕ трогаем**. Единственная разрешённая правка прод-кода — **аддитивное расширение
  трассы `llmMeta`** (ось L), поведение-нейтральное (только добавляет поля в метаданные ответа).
- Прод не трогаем ни в каком виде. Все скрипты — `assertNotProd` первым вызовом.
- Baseline снимаем в **прод-верной конфигурации** (`CLONE_V2_ENABLED=false`) — это и есть «как есть».
  Отдельный V2-ON прогон допустим как диагностический, но baseline — прод-конфиг.

**Инварианты линейки (проект §4.3) — целятся петлёй ПОСЛЕ baseline, здесь только замеряются:**
EXPERT_PASS ≥95% · FABRICATED=0 · BOUNDARY_OK=14/14 · REFUSED=0 на отвечаемых · ср. M≥0.7.

**Прогноз калибровки:** baseline даст REFUSED ≈ 50 из 96 отвечаемых. Резкое расхождение → диагноз
`ruler-defect` (чинить стенд), а не радость/паника.

## 1. Файлы (контракт §7)

```
backend/scripts/clone-stand/
  stand.ts              раннер-диспетчер: prepare | build | status | run | judge | report | report:nollm | all
  seed-clone-feed.ts    Фаза 0а+0б: докорм 4 клонов (Канал А reasoning-встречи + Канал Б задачи→probe→ответ)
                        + роли + смена носителя (Елена→Игорь) + гранты + регламенты + генерит манифест
  layer0-annotate.ts    Фаза 0в: слепые разметчики прозы сида → манифест ожидаемых черт (партиями ~10)
  layer0-match.ts       Фаза 0в: сверялка read-only манифест ↔ база клона (trait recall/derivation/no_false_merge)
  judge.ts              Фаза 2: панель majority-of-3 (линзы E+P / M / G) через directLlmCall
  report.ts             Фаза 2/3: scorecard + оси + воронка + Слой-0 + диагнозы (атрибуция по слою) + «было→стало»
  README не нужен отдельно — clone-stand.md ниже
docs/testing/
  clone-feed-manifest.json   генерит seed-clone-feed: методы по клонам (support: v1 Елена / v2 Игорь раздельно),
                            statusFacts, absentFacts, stale-эпизоды  (ground truth; черты ВЫВЕДЕНЫ, не скопированы)
  clone-stand-report.md      отчёт baseline (+ Слой-0 фиделити + воронка + конфигурация прогона)
  clone-stand.md             README стенда (по образцу probe-stand.md)
  clone-stand-questions.json банк 110 — ГОТОВ, не трогать
  clone-stand-results.json   per-run трасса (в docs/testing/clone-stand-runs/<stamp>/ архив)
```

Прод-код (единственная правка — Фаза 1):
```
backend/src/modules/clones/services/clones.service.ts   +llmMeta: usedBlockIds/usedRegulationNames/usedSkillIds/topicMatchedBlocks (аддитивно, 4 ask-ветки)
```

## 2. Предусловия окружения (до prepare)

- Живые локальные зависимости: `docker compose -f docker-compose.dev.yml up -d` (Postgres :55435, Redis :56381, MinIO).
- **Живой backend с воркерами:** `cd backend && bun run dev` — ОБЯЗАТЕЛЬНО для Фаз 0а/0б.
  Причина (дрейф-находка): `_lib/combat-harness.ts` **не поднимает AppModule** — `injectRawEventDirect`
  только кладёт RawEvent в БД+очередь `core.raw-events`; обработку (block-ingest → черты → персона)
  делает in-process `WorkersModule` живого backend. Без него `pollUntil` никогда не сойдётся.
  Раннеры `run/judge/report` — наоборот, сами бутстрапят AppModule (`NestFactory.createApplicationContext`).
- `.env` бэкенда указывает на локальную БД (127.0.0.1). Реальные LLM-ключи в `.env` есть → судьи/конвейер
  работают на живых моделях (deepseek-v4-pro для судей).

## 3. Конфигурация окружения стенда (НЕ поведение — среда замера)

Выставить ПЕРЕД prepare. Источник значений и якорей — [картография §«Конфигурация прогона»](../analysis/2026-07-03-clone-stand-code-cartography.md).

**Плейн-ENV (в `backend/.env`, локально; после пере-сева обновить `STRELA_ORG`):**
| Ключ | Значение стенда | Зачем |
|---|---|---|
| `STRELA_ORG` | `<новый orgId>` | id пере-сеянного тенанта (seed печатает `ORG_ID=...` в stdout — спарсить) |
| `PERSONA_ROLE_AGG_MIN_PERSONS` | `1` | роли CEO/интегратор/маркетолог/поддержка — по одному носителю; иначе role-персоны не соберутся |
| `PERSONA_MIN_TRAITS` | `3` | дефолт; держим (планка воронки — ≥3 черты) |
| `CLONE_V2_ENABLED` | `false` | **baseline = прод-конфиг**; askPerson/askRole → V1 factual (askAllFormers всё равно V2) |
| `CLONE_TOPIC_MIN_BLOCKS` / `CLONE_TOPIC_SIMILARITY_THRESHOLD` | `2` / `0.7` | дефолт; пинить явно (в отчёт) |
| `CLONE_RESPOND_GROUNDING_ENABLED` | `true` | дефолт; grounding — часть поля правильности |
| `AI_CHAT_DAILY_LIMIT_ADMIN` / `_MEMBER` | `100000` / `100000` | baseline не должен упереться в квоту |

**AdminSetting (tenant-scoped на STRELA_ORG, чтобы не менять прод-поведение глобально) — ставит `seed-clone-feed prepare`:**
| Ключ | Значение стенда | Зачем |
|---|---|---|
| `tracker.methodCaptureMinComplexity` | `0` (на прогон наполнения) | probe поднимается на всех синтетических задачах Канала Б |
| `probe.rateLimitPerHour` / `probe.rateLimitPerDay` | ≥ `100` | 15 задач на исполнителя не упрутся в лимит |
| `probe.semanticDedupEnabled` | `false` (на прогон) | шаблонный текст method_capture иначе склеится semantic-dedup |
| `probe.coldStartModeHours` | `0` | первые ответы не уйдут в digest |
| `probe.adaptiveFatigueEnabled` | `false` | стабильный, детерминированный корм |
| `knowledge.skillProfileMinObservations` / `knowledge.skillClusterMinObservations` | `5` / `3` | дефолт (не в registry — ставить raw AdminSetting или ENV) |
| `clone.regulations.*`, `knowledgeClone.profileMinConfidence` | seed-дефолты | сеять `seed-admin-setting-clone-*` |

**Восстановление:** значения на прогон (methodCaptureMinComplexity=0, semanticDedup=false, fatigue=false)
ставятся tenant-scoped на STRELA_ORG — прод-тенантов не касаются; после baseline можно оставить (стенд-тенант
одноразовый). Фиксировать фактические значения в отчёте.

## 4. Фаза 0а — наполнение / пере-сев / роли / регламенты / манифест

**Задача:** свежий тенант «Стрела» с чистыми Еленой и Игорем + 4 клона-цели с посеянными методами
(ground truth), роли назначены, смена носителя проведена, регламенты консолидированы, манифест сгенерён.

**Шаги:**
1. **Пере-сев базы:** прогнать `seed-synthetic-company.ts` → `week2/3/4` (живой backend!). Спарсить
   `ORG_ID=<id>` из stdout базового сева → записать в `backend/.env` как `STRELA_ORG` и в доки/память.
   Елена и Игорь — отдельные employee по построению (дрейф-находка: слияния в коде нет).
2. **Канал А (reasoning-встречи, ~40% корма):** по паттерну `clone-build-harness.ts` +
   `injectRawEventDirect` — reasoning-реплики от 1-го лица, эпизоды разнесены по датам (confidence-ladder),
   **≥3 близких формулировки на навык** (иначе кластер ≥3 не соберётся, cosine ≥0.78). Методы по клонам —
   таблица проекта §5 (CEO/интегратор/маркетолог/поддержка). Ждать `RawEvent.received=0` (устоялся).
3. **Роли + назначение:** создать `Role` (Генеральный директор / Разработчик-интегратор / Маркетолог /
   Руководитель поддержки), назначить носителей через `AppointmentsService` (НЕ через PersonRole —
   событие `role.bearer_changed` эмитит только AppointmentsService). Person-клоны создаются у всех четверых.
4. **Смена носителя (Елена→Игорь):** назначить Елену на роль поддержки, построить v1 → сменить носителя
   на Игоря через AppointmentsService (эмит `role.bearer_changed`) → v1 замораживается (`frozen`),
   v2 строится (`RoleClonePersonaVersioningHandler.handle`, publicName «Клон Руководитель поддержки v2»).
   Для baseline можно дёрнуть `handle(event)` напрямую (публичный, минуя event-bus).
5. **Регламенты:** консолидация дублей (`backfill-regulation-consolidate.ts` / `RegulationConsolidatorService.consolidateTenant`)
   + «Регламент обработки обращений v2» (первый ответ ≤4ч, severity-шкала, критичные — эскалация в тот же
   день; scope `role:<supportRoleId>`) + org-политика «Данные клиентов — только серверы РФ [blocking]»
   + 1–2 advisory-политики (для различения blocking/advisory в банке).
6. **Stale-эпизоды** (daysAgo ≥40, под вопросы c071–c076): обоснования выбора LiveKit / ручная-чистка-vs-сервис /
   LTV-когорты / потерянное-обращение→пост-мортем / жизнь-с-лимитами-до-backoff.
7. **KnowledgeProfile-корм** (блоки expertise/experience) Сергею, Михаилу, Дарье (c063–c066/c070).
8. **CloneAccessGrant** всем участникам прогона (`ClonesAdminService.createAccessGrant`, cloneType person+role) —
   нужно уже для baseline (askAllFormers захардкожен на V2 → грант обязателен).
9. **Конфиг окружения** — §3 (ENV + tenant-scoped AdminSetting).
10. **Форс построения:** дёрнуть rebuild профилей (`enqueueRebuildSkillProfile` с `delayMs=0` — обход дебаунса) →
    verify черт (крон 03:30 или прямой вызов) → `buildForRole`/persona-compile (не ждать крон вс 06:00).
    Диагностика — `diag-clone.ts`.
11. **Манифест `clone-feed-manifest.json`:** методы по клонам (у support — раздельно v1 Елена / v2 Игорь),
    `statusFacts` (что НЕ завершено: «база не актуализирована», «Zoom Q3 выясняется», «Логистик Плюс не подписан»,
    «онбординг Ромашки не завершён»), `absentFacts` (чего намеренно НЕТ: регламента выходных/КП/подрядчиков/нового
    рынка — под вопросы честной лестницы). **Манифест методов = вход для Слоя 0, но ожидаемые ЧЕРТЫ выводятся
    слепой разметкой в Фазе 0в (правило №1), не копируются из корма.**

**Acceptance 0а:** пере-сев прошёл, `STRELA_ORG` обновлён везде; 4 роли + носители; Елена→Игорь (v1 frozen,
v2 active); регламенты (0 дублей, blocking+advisory); гранты выданы; `clone-feed-manifest.json` (методы,
statusFacts, absentFacts) на месте.

## 5. Фаза 0б — Канал Б (штатный путь «задача → probe → ответ»)

**Задача:** валидировать штатный конвейер кормления количественно (воронка §5.2) через 60 синтетических
задач (15/клон), не «открывая мостик заново» (он реализован Ф5/Ф6).

**Шаги (программно, в `seed-clone-feed.ts`):**
1. Создать 60 задач в трекере: описание `descriptionStripped` **≥280 символов**, `assignee`=клон-носитель,
   `priority='high'` — иначе complexity <0.5 не поднимет probe (формула: `0.4·(descr/280)+0.3·(activ/8)+0.2·(days/7)+0.1·prio`).
   4 повторяющихся типа × 3 + 2–3 уникальных на человека. Тексты близкие по смыслу, **НЕ дословные**
   (дословные склеит block-dedup; разнородные не кластеризуются).
2. Закрыть задачу: `IssuesService.transitionToCategory(id,'completed',tenantId,userId)` (обёртка сама
   резолвит completed-стейт) → триггерит `maybeRaiseMethodCaptureProbe`.
3. Поллить `ProbeEvent` (reason=`task.method_capture`, match по `payload.contextCardId=issue.id`) до
   `status='dispatched' && dispatchedNotificationId != null` (образец `pollProbe` — probe-stand/stand.ts:103).
4. Найти `Notification` по `dispatchedNotificationId` → ответить:
   `ConversationalService.respondToProbe({notificationId, userId:<исполнитель>, payload:{text:<пошаговый ответ>}})`
   строго от `userId === Notification.recipientUserId`. Ответ — **одно-методный** («сначала X, потом Y, потом Z»;
   hint `reasoning` применяется к ПЕРВОМУ блоку). Учесть `expiresAt` и `dialogEnabled` (confirm-петля).
5. Между закрытиями чистить `probe:dedup:<STRELA>:*`, `probe:ratelimit:*`, `probe:engagement:*`,
   `probe:cooldown:<STRELA>:*`; на прогон semanticDedup=false (§3).
6. После всех ответов — ждать устаканивания конвейера, форс rebuild/verify/persona (как 0а.10).

**Воронка кормления (метрика стенда, печатает `status`):**
```
задач закрыто → probe задиспатчен (%) → ответ дан → блок клон-типа создан (%) →
блоков в кластерах → черт родилось → verify прошло → вошло в персону
```
«Блок клон-типа» = `signalType ∈ SKILL_SUBJECT_SIGNAL_TYPES` (reasoning/rationale/decision_basis/methodology_step) —
НЕ только methodology_step (Канал Б рождает `reasoning` через hint). Разрывы диагностируются по этапам.
**Планка воронки:** ≥70% ответов доходят до блока клон-типа; каждый клон ≥3 черт + активная персона.

**Acceptance 0б:** 60 задач закрыто, воронка посчитана и напечатана, планка воронки достигнута ИЛИ разрыв
задокументирован как находка (первый пункт диагнозов, не провал стенда).

## 6. Фаза 0в — Слой 0 фиделити построения (Р7, ПЕРЕД baseline ответов)

**Задача (метод [synthetic-fidelity-eval-method.md](../../docs/methodology/synthetic-fidelity-eval-method.md)):**
проверить, что клон ПОСТРОИЛСЯ верно из сырья, ДО замера ответов — иначе провал ответа спишется на политику
(мис-атрибуция). Read-only, изоляция агентов обязательна.

**Граница пере-сева (проект §5.3):**
- Фиделити **ИЗВЛЕЧЕНИЯ** клон-блоков (проза «как я решаю» → reasoning/rationale-блок с subject-атрибуцией) —
  снимается на существующей базе сразу (partial, ~10 якорей есть в `eval/gold`).
- Фиделити **СИНТЕЗА** черт/персоны — только ПОСЛЕ наполнения (Фазы 0а/0б).

**Шаги:**
1. `layer0-annotate.ts` — 2+ слепых агента читают ТОЛЬКО прозу сида о сотруднике + якоря (набор из 3–5
   свидетельств метода → одна ожидаемая **выведенная** черта поведения), пишут ожидаемую запись; ревизор
   сводит в манифест ожидаемых черт + agreement (`full/partial/conflict`). Изоляция: агент не видит базу и
   другого агента. Гранулярность якоря клона — **N:1** (кластер → черта), не 1:1 как в графе.
2. `layer0-match.ts` — read-only сверялка манифест ↔ реальная база клона (`createPrismaClient`, фильтр
   `status='active'`):
   - **trait recall** — все ли методы источника стали active `SkillTrait`;
   - **derivation (правило №1!)** — `SkillTrait.statement` ВЫВЕДЕН из `sourceBlockIds` (кластер ≥3), НЕ
     скопирован из gist манифеста. Детерминированный признак: `sourceBlockIds ⊂ входных блоков` + судья
     «выведено ли по смыслу» (образец `checkInvariants` — `run-skill-trait-detect-golden.ts:51`);
   - **no_false_merge** — носитель не слит (Елена не в персоне Игоря; `SkillTraitConcept` не смешал разных);
   - **persona fidelity** — active `ExecutablePersona.includedTraitIds ⊇ ожидаемых`; Елена — `frozen` v1.
3. Партиями по ~10 якорей (разметить → сверить → сверялка → выводы → следующие 10). Кратные пересборки
   (дисперсия LLM-кластеризации). Пороги первого прогона — **baseline (non-regression)**, не абсолют.

**Читаемые Prisma-модели (дрейф — `KnowledgeProfile`/`RoleClone` НЕ существуют):**
`SkillProfile(1:1 Person)` → `SkillTrait(statement/sourceBlockIds/layer/confidence, status='active')` →
`ExecutablePersona(scope=person/role, includedTraitIds, status)`; роль: `RoleProfile(status='ready')` +
`RolePrinciple(sourceBlockIds)`.

**Acceptance 0в:** Слой-0 снят (trait recall / derivation / no_false_merge / persona fidelity), пороги
зафиксированы как baseline; провалы построения размечены как Слой-0 (отдельная ветка от политики).

## 7. Фаза 1 — раннер `run` + детерминированные ассерты + трасса (ось L)

**Задача:** прогнать банк 110 через `ClonesService` напрямую, снять трассу, посчитать детерминированные
ассерты (без LLM).

**Прод-код (ЕДИНСТВЕННАЯ правка, аддитивная/read-only):** расширить `llmMeta` списком вошедших
блоков/регламентов/скиллов во ВСЕХ 4 ask-ветках (чтобы ось L считалась и в V1-baseline, и в V2):
- `askRoleV2` — блок llmMeta `clones.service.ts:~1006`; в скоупе: `applicableRegulationsV2`, `retrievedSkillsV2Role`,
  `subgraph.reasoningBlocks`, `citations`, `dialog.queries`.
- `askPersonV2` — `~773`; в скоупе: `retrievedSkillsV2`, `subgraph.reasoningBlocks`, `citations` (регламентов у person нет).
- `askRole` V1 — `~550`; `askPerson` V1 — `~301` (минимальный llmMeta; добавить usedBlockIds из citations∩subgraph).
Добавляемые поля: `usedBlockIds:number[]` (`subgraph.reasoningBlocks.id ∩ parseCitations`),
`usedRegulationNames:string[]`, `usedSkillIds:string[]`, `topicMatchedBlocks:number` (если посчитан).
Свободный JSON `chatV2Message.llmMeta` — **миграция Prisma не нужна**. Снапшот-тесты промптов не трогаются.
Юнит-тест на новые поля (не меняют текст/refusal). Режим (factual/judgmental) читать из `llmMeta.mode`, НЕ из DTO
(`AskCloneResponseDto.mode` всегда `'clone_style'`).

**Раннер `run` (скелет — `batch-recall-trace.ts` + `probe-stand/stand.ts:withApp`):**
- `assertNotProd` (из `combat-harness.ts:91`) ПЕРВЫМ. ORG из ENV `STRELA_ORG` (НЕ хардкод как в batch-recall-trace).
- Бутстрап `NestFactory.createApplicationContext(AppModule)`; `app.get(ClonesService)`.
- Бьёт: `askPerson` (вопросы `cloneScopeOverride:'person'`), `askRole` (роль по `clone`), `askAllFormers`
  (`askVersion:'all_formers'`), frozen v1 (`askVersion:'frozen_v1'` → askRole с roleVersion). Маппинг
  `clone`→roleId/personId из посева.
- CONCURRENCY ≤3. **Цепочки** (`chain` bitrix/retention) — последовательно, один `conversationId` на цепочку,
  `turn`-порядок, история протягивается.
- **Чистка ПЕРЕД run:** answer-cache `dlg:ans:<STRELA>:*` (`AnswerCacheService.invalidateTenant`),
  bull-дедуп rebuild `bull:core.skill-profile-rebuild:*`. Логировать fail-open эмбеддера.
- Per-run файлы: `docs/testing/clone-stand-results.json` + архив `clone-stand-runs/<stamp>/`.

**Детерминированные ассерты (без LLM, `report:nollm`):** refusalReason (код-константы отказов — точный
матч допустим), наличие/валидность citations `[BLOCK:id]`, дисклеймер/1-е лицо (регэксп), латентность,
**ось L** (expectedLayer ∩ трасса: usedBlockIds→traits/analogy, usedRegulationNames→regulations,
usedSkillIds→practice_skill). Матч LLM-текста — по машинным признакам (refused/answerKind), не по строке.

**Acceptance 1:** прод-правка llmMeta аддитивна (typecheck/lint/build зелёные, юнит зелёный, снапшоты не
сломаны); `run` гоняет 110, снимает трассу с осью L; детерминированные ассерты отделены от судей.

## 8. Фаза 2 — судьи (панель majority-of-3) + report

**Задача:** оценить смысл ответов панелью LLM поверх ground truth; собрать scorecard + диагнозы.

**Судьи (`judge.ts`, дрейф: majority-of-N НЕ готов — строим над `directLlmCall`):**
- 3 независимые линзы, вердикт по большинству: **(1) E+P** экспертность+персона; **(2) M** верность методу
  vs `groundTruth` (образец шкалы — `persona-behavior-judge.prompt.ts`: 1.0 совпал / 0.5 направление / 0.3
  честный отказ при существовавшем ходе / 0.0 противоположный/выдуманный); **(3) G** честность/fabricated
  (образец — `RAG_GROUNDEDNESS_LENIENT`: fabricated=true только на конкретный факт/статус/провенанс без
  опоры) — **линзе G давать retrieved-контекст, не только groundTruth** (иначе клеймит деталь-из-контекста).
- `directLlmCall(provider:'deepseek', model:'deepseek-v4-pro', schema, toolName)`; JSON-схема через tool-call
  (`as const, additionalProperties:false, все required`); retry×3 до валидной схемы (образец `llmJson` —
  judge.ts:127) ВНУТРИ каждой из 3 линз.
- Судья видит `groundTruth`/`forbidden`/`absentFacts`/`statusFacts` из банка+манифеста.

**Вердикт на вопрос (детерминированно, проект §4.2, сверху вниз):**
`BOUNDARY_OK/FAIL` (boundary+off_domain, 14) → `FABRICATED` (G-провал) → `REFUSED` (отказ где ожидался ответ)
→ `EXPERT_PASS` (E≥0.7 ∧ M≥0.5 ∧ (L совпал ∨ expectedLayer только advisory) ∧ P-чисто) → `WEAK` (остаток).
Каждый `FABRICATED` — ручной разбор против реальных блоков (протокол recall: ~половина — пере-строгость).

**report (`report.ts`):** scorecard (распределение вердиктов), оси E/M/G/L/P (среднее), воронка кормления,
Слой-0 фиделити, таблица диагнозов **с атрибуцией по слою** (Слой 0: build-miss/false-merge/derivation-fail;
Слой 2/3: gate-refusal/intent-trap/retrieval-miss/prompt-weak/layer-missing/fabrication/judge-error/ruler-defect),
конфигурация прогона (§ниже), «было→стало» (пока только baseline). MD+JSON, архив per-run.

**Acceptance 2:** судьи majority-of-3 работают (3 линзы, вердикт детерминирован); report печатает scorecard +
оси + воронку + Слой-0 + диагнозы с атрибуцией по слою.

## 9. Фаза 3 — baseline-прогон + отчёт владельцу

**Шаги:** чистка кэшей/дедупов → `run` → `judge` → `report` на 110 + фиксация конфигурации прогона.

**Конфигурация прогона (обязательно в отчёт):** `CLONE_V2_ENABLED`(=false), `CLONE_TOPIC_MIN_BLOCKS/SIMILARITY`,
`CLONE_RESPOND_GROUNDING_ENABLED`, `PERSONA_ROLE_AGG_MIN_PERSONS`(=1), probe/tracker-крутилки на прогон,
**фактически применённый LlmTaskRoute для `clone-respond`** (дрейф-конфликт pro vs flash — снять реальное
значение перед baseline через `diag-llm-routes.ts`), `MIN_TRAITS_FOR_ANSWER`.

**Отчёт владельцу** (`docs/testing/clone-stand-report.md` + разбор в журнал): scorecard + воронка + Слой-0 +
таблица диагнозов с **атрибуцией по слою** (сколько отказов — политика Слой 2/3 → ТЗ-1; сколько —
непостроенная черта Слой 0 → извлечение). Сверить факт с прогнозом (REFUSED≈50): совпал → стенд меряет верно;
резко иначе → сначала диагноз `ruler-defect`.

**Acceptance ТЗ-0 (общая):**
- [ ] стенд гоняется командой `bun run scripts/clone-stand/stand.ts all` (и по-фазно);
- [ ] 4 клона наполнены (≥3 черт, активная персона; support — v1 frozen + v2 active);
- [ ] воронка кормления посчитана;
- [ ] **Слой-0 фиделити снят** (trait recall/derivation/no_false_merge/persona), пороги = baseline;
- [ ] baseline-отчёт (scorecard + оси + воронка + Слой-0 + диагнозы с атрибуцией по слою) в `clone-stand-report.md`;
- [ ] конфигурация прогона зафиксирована (вкл. реальный LlmTaskRoute clone-respond);
- [ ] манифест ground truth на месте (черты выведены слепой разметкой, не скопированы);
- [ ] `typecheck/lint/build` зелёные по затронутому; прод не тронут; `clone-stand.md` README написан.

## 10. Операционные ловушки (учесть обязательно — методология §3 + картография)

- **Живой backend для 0а/0б** (combat-harness не бутстрапит AppModule) — иначе конвейер стоит.
- **Ручное связывание ProbeEvent↔Notification** если создаём напрямую: `dispatchedNotificationId`+`status='dispatched'`,
  иначе `ProbeResponseHandler` молча пропустит. Лучше — штатный путь через воркер (не создавать вручную).
- **Атрибуция автора Канала Б** — через `RawEvent.payload.userId=recipientUserId` (`tryGetActorIdentity`),
  поля `subjectPersonId` в ProbeEvent НЕТ.
- **Пере-сев меняет orgId** → обновить `STRELA_ORG` в `.env` + `docs/testing/*`, `probe-stand.md`, память.
- **Недетерминизм:** `loadPersonSubgraph` take 40 без orderBy; fail-open эмбеддера; фиксировать `conversationId`,
  логировать fail-open, кратные пересборки Слоя 0.
- **jobId-дедуп rebuild (24ч)** — чистить `bull:core.skill-profile-rebuild:*`; answer-кэш `dlg:ans:*` — перед run.
- **LlmTaskRoute clone-respond конфликт** (pro/flash) — снять реальное значение, зафиксировать.
- **`patch-clones-role-versioning.ts` использует голый `new PrismaClient()`** (нарушение канона) — в новых
  скриптах только `createPrismaClient()` из `_lib/prisma.ts`.
- **Регистрация в prod-deploy:** новые `seed-*`/`backfill-*` попадают в `apply-prod-deploy.ts STEPS` только если
  они прод-нужны. `clone-stand/*` — **стендовые, НЕ прод** → в STEPS НЕ добавлять, в `prod-deploy-log` НЕ вносить
  (кроме llmMeta-правки прод-кода — она безопасна, отметить в журнале что prod-операций не требует).

## 11. Что дальше (НЕ в этом ТЗ)

ТЗ-1 «Разворот на лестницу опоры» — **отдельный файл ПОСЛЕ baseline**, по классам провалов (H1 разворот
гейтов, H3 интент-роутинг, H5 крутилки в AdminSetting; H2/H4 по показаниям). Провалы Слоя 0 (извлечение) —
отдельная ветка фиксов, не в ТЗ-1 разворота. Петля §6 проекта до планки §4.3.

## Итог

Реализовано: —/— (заполняется по фазам). Статусы фаз — в [журнале исполнения](../2026-07-03-clone-stand-execution-journal.md).
