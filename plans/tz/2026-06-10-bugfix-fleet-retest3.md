---
title: ТЗ — исправление всех открытых багов (retest3, korateam.ru)
date: 2026-06-10
status: ready-to-implement — решения владельца Р1–Р11 ЗАФИКСИРОВАНЫ 2026-06-10
type: tz
owner_decisions: locked
source:
  - plans/qa/bugs-registry.md                          # реестр багов (ID + статусы)
  - plans/qa/sessions/2026-06-09-retest3-RESULTS.md     # прогон тестировщика, доказательства
  - plans/tz/2026-06-06-main-report-deepseek-routing.md # Ф5 опирается на это ТЗ
  - plans/tz/2026-06-07-asr-word-timestamps-duration-behavior.md # Ф3 ШАГ-0 (Фаза 1 оттуда)
---

# ТЗ — исправление открытых багов retest3

> **Что делаем.** Закрываем все открытые баги прогона тестировщика (09.06, прод `korateam.ru`). Корни найдены и **состязательно перепроверены по реальному коду** (9 кластеров × 2 независимых агента: разбор → верификация), все ссылки — `file:line`. Чиним **классами, а не кейсами**.

## Как пользоваться этим ТЗ (для исполнителя-агента)
- Реализуй **по фазам** (Ф1…Ф9). У каждой: корень (`file:line`) → шаги фикса → приёмка → гард.
- **Решения владельца Р1–Р11 уже приняты** и вшиты в фазы — открытых вопросов нет, не переспрашивай.
- Перед правкой ищи код через **vexp `run_pipeline`** (НЕ grep/glob — хук блокирует). После каждого Edit — re-Read; в отчёт по фазе — `git status` + грэп ключевых маркеров (агенты иногда помечают сделанным без правок).
- **Приёмка каждой фазы:** `bun run typecheck` + `bun run build` (зелёные обязательно) + затронутые `*.spec.ts`. Golden/eval не блокирует. Коммит по фазам; push — по подтверждению владельца.
- Правила проекта: **Ship-On** (выкатываем включённым; флаги только kill-switch ON / параметр+ON), **только русский UI**, **крутилки в AdminSetting** (не ENV/хардкод), **cache-friendly** (стабильный SYSTEM, переменные в конец user).

## Решения владельца — ЗАФИКСИРОВАНЫ 2026-06-10

| Р | Вопрос | РЕШЕНИЕ |
|---|---|---|
| Р1 | #71 quality-score — как свести контракт? | **Промпт к вызову:** убрать из `meeting-quality-score.ts:161` строку «вызови инструмент submit…»; вернуть валидный JSON по схеме. Не форсить tool на flash, кэш сохраняется. |
| Р2 | Флаг `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` (дефолт OFF — нарушает Ship-On) | **Сделать штатным ON** для не-thinking моделей (или оставить как kill-switch с дефолтом **ON**). Строка в `docs/operations/feature-flags.md`. |
| Р3 | #51 дефолт `LLM_MAIN_REPORT_PRIMARY` | **`deepseek`** (Ship-On: фича готова → включена). `minimax` остаётся как kill-switch-откат. |
| Р4 | #26 если vox-модель не отдаёт тайминги | По итогу **ШАГ-0 smoke**: исход (в) → сменить модель / добавить forced-alignment (отдельным решением на момент smoke). ШАГ-0 требует «можно в прод» в той сессии. |
| Р5 | #79 «ЗАДАЧИ 0» | **Отдельное ТЗ** (бэк-промоут `structuredData.tasks`→Task-модель). В этот фикс НЕ входит (фронт-заплатка отклонена как регрессивная). |
| Р6 | #80 деталь идеи | **Полноценный роут `/ideas/[id]`**. |
| Р7 | #77 мета-модель в отчёте | **Убрать строку «· модель: …»** из user-facing digest совсем (владелец не видит мета/себестоимость LLM). |
| Р8 | #83 латинские ключи проектов (MTG/SALE) | **Оставить латиницу** (стандарт трекеров; `MTG` уже в проде). Чинить только англ. **описание**. |
| Р9 | #84 имя раздела | **«Партнёрская программа»** (унифицировать меню+title; «реферальная» — англицизм-калька). |
| Р10 | #20 онбординг | **Сворачивать второстепенные группы меню + ненавязчивый welcome-тур** (с «Пропустить»). Форс-тур не возвращать. |
| Р11 | #24 mobile≠desktop nav | **Единый nav-конфиг, две проекции** (desktop sidebar / mobile bottom-nav поверх одного источника). |

## Уже сделано в коде — только РЕТЕСТ, не реализация
- **#17 (принудительная смена временного пароля) — реализовано** (audit Б2, 29.05): `accounts.service.ts:561,580,177` (`mustChangePassword=true`), `unified-login.controller.ts:80`, фронт-редирект `AuthenticatedShell.tsx:45-48`, глобальный `must-change-password.guard.ts` (`app.module.ts:685`). **→ Ф9: прод-ретест.**
- **#19 (тост «Пароль изменён») — есть** (`SecuritySection.tsx:50`, `OnboardingChangePasswordForm.tsx:70`, `reset-password`). **Не баг, правок нет.**

---

## Ф1 — #70 pulse-patterns 500 (P1, backend) · S

- **Корень:** `backend/src/modules/dashboard/services/pulse-patterns.service.ts:387` — `select` у `personGoalContribution.findMany` содержит реляцию `person:{ select:{ name, primaryDepartmentId } }`, которой НЕТ в модели `PersonGoalContribution` (`backend/prisma/schema.prisma:7344-7366`: есть скаляр `personId:7347`, реляция только `org`). Prisma отбраковывает запрос → 500 на `GET /api/v1/dashboard/pulse-patterns` (`director-dashboard.controller.ts:200`). Маскировка: каст `c.person as ... | null` (`:437-439`) скрыл это от tsc; `pulse-patterns.service.spec.ts:188/196/449` мокает строки с готовым `person` → spec зелёный.
- **Шаги:**
  1. Из select `findMany` (`:381-388`) удалить строку `:387` (`person:{...}`), оставить скаляры `goalId/personId/proScore/contraScore/netScore`.
  2. После Promise.all: `personIds = new Set(contributions.map(c => c.personId))`; `this.prisma.person.findMany({ where:{ tenantId, id:{ in:[...personIds] } }, select:{ id:true, name:true, primaryDepartmentId:true } })` → в `Map<personId,{name,primaryDepartmentId}>` (поля Person: `schema.prisma:4698 tenantId, 4704 name, 4707 primaryDepartmentId`; фильтр по tenantId как у Department `:454-469`).
  3. В цикле `:424-451` убрать каст `c.person as ...`, читать из Map по `c.personId`; fallback `?? 'Без имени'`/`?? null` оставить (срабатывает только для удалённого Person).
  4. Гард: в spec вернуть строки `findMany` БЕЗ `person` + мок `person.findMany`.
- **Class-guard:** «select/include реляции, которой нет в модели» — единственное вхождение (соседний `person:{select}` в `bus-factor-analyzer.cron.ts:87` — НЕ баг: у `PersonKnowledgeCategoryEmbedding` реляция `person` есть, `schema.prisma:4855`).
- **Приёмка:** GET pulse-patterns → 200, `topContributors[].personName` и `byDepartment[].departmentName` непустые; в прод-логах исчезает `Invalid prisma.personGoalContribution...`; typecheck зелёный без каста; spec падал бы на старом коде. Миграции нет.

## Ф2 — LLM json-режим: #72/#71/#73/#56 (P2, класс) · M

- **Общий корень:** «гарантия слова json (вход)» и «строгий JSON-парс (выход)» размазаны по провайдерам с расхождениями; единого helper'а на входе/выходе router'а нет (хотя seam'ы есть: `json-extract.util.ts#tryParseJson`, `llm-router.service.ts:1489 validate`).
  - **#72:** прокси agent-lia валидирует слово «json» в `input` (USER, `openai-proxy.service.ts:65`), а код дописывает в `instructions`=SYSTEM (`:16,:91,:94`) → 400 → весь secondary мёртв на JSON-задачах.
  - **#56/#73:** `deepseek.service.ts:254` дописывает json-слово в `messages[0]`=SYSTEM (ломает кэш, противоречит коммент. `:292`); корректный `ensureJsonWord` (`:295`, пишет в хвост USER) — **мёртвый код**. То же в `ollama.service.ts:114`. `meeting-extract-actions.service.ts:216` — голый `JSON.parse` мимо `tryParseJson`. *(Падение #73 условно: deepseek autoConvert стрингифицирует tool-args в text `:348`; падает на прозе/markdown-обёртке.)*
  - **#71:** `quality-score.worker.ts:212` шлёт `json_object` без `tools`, а промпт `meeting-quality-score.ts:161` требует «вызови инструмент submit…» → структура без вложенного `categories` → Zod падает на `path['categories']` (`:385`). *(parseAndValidate уже делает fence-strip; не хватает нормализации.)*
- **Шаги:**
  1. **Вход (класс):** один helper `ensureJsonWordInUser(messages)` — дописывает стабильный суффикс в **хвост последнего USER** (никогда SYSTEM), если слова «json» нет ни в system, ни в user. Применить в 3 провайдерах: `openai-proxy` (в `input`, удалить/перенаправить `ensureJsonHint`), `deepseek:253-256` (в USER; удалить мёртвый `:295` либо сделать его этим helper'ом), `ollama:113-116` (в USER).
  2. **Гард-spec (защита кэша):** при `json_object` без слова мутируется только последнее USER-сообщение, SYSTEM байт-в-байт неизменен — отдельный тест на каждый из 3 провайдеров.
  3. **Выход:** `meeting-extract-actions.service.ts:216` — заменить голый `JSON.parse` на `tryParseJson` (fence-strip + первый `{…}`); включить router-`validate` (`:1489`) для quality-score и extract-actions (200-битое-тело не считать успехом).
  4. **#71 (Р1):** убрать из `meeting-quality-score.ts:161` строку про tool_use (оставить «верни валидный JSON по схеме с полем `categories{…}`»); в `parseAndValidate` добавить нормализацию плоской структуры→`{categories:{…}}` перед Zod.
  5. **#56 (Р2):** `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` (`env.schema.ts:156`) — сделать дефолт **ON** (штатно для не-thinking) / kill-switch ON; строка в `feature-flags.md`.
- **Приёмка:** diag `trace --meeting <id>` тест-встречи — нет «input messages must contain the word 'json'»; quality-score → `MeetingQualityScore` записан (нет Zod-фейла `categories`); extract-actions создаёт задачи (искусственный ответ в ```json-обёртке парсится, шаг не падает); cache-guard spec зелёный; `feature-flags.md` обновлён. typecheck+build+затронутые unit зелёные.

## Ф3 — vox ASR + диаризация: #26 (P1) / #74 (P2) · M · ШАГ-0 требует «можно в прод»

> **Симптом (важно):** транскрипт идёт «дорожками подряд» — вся речь одного спикера целиком, затем второго, без переплётки по ролям и таймингу. Развёрнутый разбор с доказательствами (на встрече: «Транскрипт · 3 реплики» на 44 мин/4 уч., «Всего речи 130 мин», «перекрёстная речь 128 мин») — **[plans/analysis/2026-06-10-diarization-timing-rootcause.md](../analysis/2026-06-10-diarization-timing-rootcause.md)**.
> **Алгоритм слияния `merger.ts#mergeWordTimestamps` КОРРЕКТЕН** (сортирует слова всех дорожек по абсолютному времени со смещением входа `trackStartedAt−baseStartedAt`, нарезает по смене спикера/паузе) — ему не хватает только таймкодов на уровне слов ИЛИ сегментов. Чинить НЕ алгоритм, а вход (Vox-тайминги) и fallback-гранулярность.

- **Корень:** per-track путь Vox принимает любой COMPLETED-ответ и только ЛОГИРУЕТ деградацию. #26 — submit (`vox.service.ts:86-100`) не запрашивает тайминги (per-track `opts={}`, `transcribe.worker.ts:468`) → `vox.no_words`; fallback `merge.worker.ts:152` схлопывает **всю дорожку в одно псевдо-слово `[0…длительность]`** → один turn на дорожку → дорожки идут подряд (а не переплетаются). #74 — пустая дорожка (`vox.empty`, `:222-234`) сохраняется как успех без диагностики/ретрая. *(Vox УМЕЕТ диаризацию `{start,end,speaker,text}` через `mapDiarizedSegments` `:438-448`, но для живого per-track пути она выключена — `diarizationEnabled:false`.)*
- **⚠️ ШАГ 0 (расследование, ДО кода #26):** прогнать `backend/scripts/smoke-vox-diarization.ts` на реальном аудио под **фактической прод-моделью** (взять `VOX_MODEL` из прод-.env; в `env.schema.ts:134` дефолт `v3_rnnt`, в smoke `v3_e2e_rnnt` — уточнить, какая реально); перебрать имена флага (`wordTimestamps`/`word_timestamps`/`enable_word_time_offsets`/`responseFormat=verbose`/`timestampGranularity=word`) и напечатать, под каким ключом приходят `words`/`segments[].words` или что даёт 400. Это незакрытая Фаза 1 из `plans/tz/2026-06-07-asr-word-timestamps-duration-behavior.md:55`. **БЕЗ ШАГ-0 фикс #26 не писать.**
- **#26 по исходу ШАГ-0 (иерархия — см. анализ §4):**
  - **(A) Слова (лучший):** нужен submit-флаг → `vox.types.ts` `VoxSubmitOptions.wordTimestamps?`, в submit `if(opts.wordTimestamps) form.append(<имя-флага>,'true')`, имя-флага и включение — в **AdminSetting** (`vox.wordTimestampsParam`+`vox.wordTimestampsEnabled`, code-fallback off); per-track вызовы `:468/:460` передают `{wordTimestamps:true}`. Если тайминги уже приходят под другим ключом — расширить парсер `vox.service.ts:411-436` (submit не трогать).
  - **(B) Сегменты (достаточно для «по ролям и таймингу»):** если word-level недоступен, но Vox отдаёт сегменты `{start,end,text}` — **переписать fallback `merge.worker.ts:137-164`: строить псевдо-слово НА КАЖДЫЙ СЕГМЕНТ (а не одно на всю дорожку)**, используя `mapDiarizedSegments`-парсер (`vox.service.ts:438-448`) и для per-track пути. Тогда `mergeWordTimestamps` переплетёт реплики по предложениям/сегментам.
  - **(C) Модель не умеет ничем:** → **Р4** (смена модели Vox / forced-alignment: текст готов → выровнять по аудио). Псевдо-turn на всю дорожку оставить как честный последний дегрейд.
  - **Гард behavior-metrics:** когда диаризация деградировала (turn'ов ≈ числу дорожек / полное взаимное наложение) — НЕ показывать абсурд «Всего речи 130 мин / перекрёстная 128 мин», а ставить «недоступно» (сейчас лишь приписка «ориентировочные», цифры всё равно выводятся). Найти расчёт в behavior-metrics-воркере, добавить условие вырожденной диаризации.
- **#74:** в `transcribeOneTrack` при пустом результате логировать `audioSizeBytes` (читается `:424`) + Vox `durationSeconds` → различать тишину (size>0,dur>0) vs битое аудио (size≈0/dur≈0); при малом audio (порог `transcribe.minAudioBytes` в AdminSetting) ИЛИ нулевой длительности — **один** ре-submit (паттерн `:456-465`), повторно пусто → WARN с причиной; пустой трек среди непустых сделать заметным WARN.
- **Гард:** unit `vox.service` (флаг в multipart при `wordTimestamps`; spec уже инспектирует `fetchMock.mock.calls`, body как FormData), unit `transcribe.worker` (ре-submit при малом audio). **Ship-On:** vox-флаг — параметр, верифицируемый smoke; нет рабочего имени → фичу не выкатываем.
- **Приёмка:** #26 — на встрече >1 мин реальная длительность и доли говорения без `lowConfidence`; зафиксирован исход (а/б/в) из smoke (без этого не принимать). #74 — пустая дорожка даёт WARN с `audioSizeBytes`/`durationSeconds` и причиной; виден ровно один ре-submit. typecheck+build+unit зелёные.

## Ф4 — #75 материализация решений (P2, граф) · S

- **Корень:** `graph-materialization.service.ts:91` строит `signalTypeDistribution` по ВСЕМ блокам (без `status`), а Decision материализуется только из **canonical** (`specialist-3-3-decisions.worker.ts:85` skip `not_canonical`). Draft/merged/archived decision-блок → ложный gap → WARN «есть(1), записей 0» каждые 30 мин (`graph-materialization-verify.cron.ts:122`). *(Опровергнуто: ложного gap от merge нет — `sourceBlockIds` всегда содержит id блока, `specialist-3-3-decisions.service.ts:174,923`.)*
- **Шаги:**
  1. Полные `signalTypeDistribution`/`statusDistribution` оставить (наблюдаемость для super-admin `graph-diagnostics.controller.ts:66`); в select добавить `status` для подсчёта **canonical**-среза.
  2. Gap поднимать только когда `canonicalDecisionBlocks>0 && decisions===0` (аналогично idea); `blocksWithSignal` в gap = canonical-счёт.
  3. Gap decision/idea (`:119-134`) вынести в общий helper `buildGap(type, canonicalCount, materialized)`. `verify.cron.ts` не трогать.
  4. Гард: переписать spec `:50-84` — «2 canonical+1 draft, Decision=0 → gap blocksWithSignal:2», «все draft → gaps=[]», idea-аналог.
- **Приёмка:** GET `/platform/graph/materialization` → `gaps=[]` для draft/merged decision-блоков, полные распределения сохранены; за >30 мин нет ложного WARN; на canonical-без-Decision (isDecision=false/confidence<0.4) честный gap остаётся. typecheck+lint+build+spec зелёные.

## Ф5 — #51 главный отчёт мимо DeepSeek (P1) · S · реализует `plans/tz/2026-06-06-main-report-deepseek-routing.md`

- **Корень:** `LlmFallbackService.complete` хардкодит primary=MiniMax (`llm-fallback.service.ts:60-61`), DeepSeek не импортирован (`:6-7`); единственный потребитель — `analyze.worker:101`. Кэш DeepSeek не работает; две системы роутинга.
- **Шаги:**
  1. ENV `LLM_MAIN_REPORT_PRIMARY: z.enum(['minimax','deepseek']).default('deepseek')` (**Р3**) в `env.schema.ts` + геттер `ai.mainReport.primary` в `TypedConfigService` (никаких `process.env.*`).
  2. Внедрить `DeepSeekService` в `LlmFallbackService`; **две явные ветки** каскада: `deepseek` → DeepSeek→MiniMax→OpenAI; `minimax` → дословно текущее (MiniMax→OpenAI, для отката). `cacheControl`-обёртка `:54-57` без изменений.
  3. Per-agent `model:'deepseek-v4-pro'` для summary (`analyze.worker:583`), report-by-type (`:770`), follow-up (`callStructured :896`); tasks/custom — без model (flash-default).
  4. **Поправки верификатора:** **D1** MiniMax НЕ игнорирует `input.model` (`minimax.service.ts:36`) — сбрасывать поле `model` перед minimax/openai-ветками, иначе ломается откат/fallback; **D3** зарегистрировать `DeepSeekService` в `workers.module.ts` + exports `AiModule` (поправить спеки `:234,266`). Структурный отчёт оставить на нативных `tools` (`analyze.worker:773`) — НЕ переводить на `json_schema` (иначе deepseek auto tool_choice:auto ломает JSON).
- **Приёмка:** `diag llm-calls --meeting <id>` при `deepseek` → summary/report-by-type/follow-up = `deepseek-v4-pro`, tasks/custom = `deepseek-v4-flash`, ноль minimax; `diag report` валиден (summary непустой, structuredData с задачами/решениями), нет регрессии vs MiniMax-эталон; флип флага на minimax → следующая встреча снова MiniMax. Юнит: deepseek+throw → minimax (без `pro`-model); minimax-ветка 1:1 со старым. Греп `process.env.` в новом коде = 0.

## Ф6 — фронт: #85 (P3), #80 (P2) · S–M

> #79 ВЫНЕСЕН в отдельное ТЗ (**Р5**) — в эту фазу не входит.
- **#85 «undefined формируется»:** бэк отдаёт ключ `building` (`structure.service.ts:12,:75`), фронт читает `forming` (`StructureSummaryWidget.tsx:86`, DTO `structure.api.ts:160`). **Фикс:** на бэке переименовать `building`→`forming` (под словарь статусов RoleProfile, `status='forming'`, `structure.api.ts:63,178`) в DTO `:10-16` и `:73-79`; гард `${forming ?? 0}` в виджете. Единственный фронт-потребитель — этот виджет (регрессий нет; `search.service.ts:114/165` — несвязанная переменная).
- **#80 `/ideas/<id>` 404 (Р6 — полный роут):** роута `app/(authenticated)/ideas/[id]/` нет (inline master-detail в `IdeasListClient.tsx`); виджеты строят `href=/ideas/<id>` (`IdeasTopWidget.tsx:71`, `MyIdeasFateWidget.tsx:67`) → prefetch 404. Бэк-деталь есть (`ideas.controller.ts:100 @Get('ideas/:id')`, фронт-метод **`ideasApi.getById`** — `ideas.api.ts:130`, НЕ `byId`). **Фикс:** создать `app/(authenticated)/ideas/[id]/page.tsx` (грузить `getById`+`mapIdeaDetail`, рендерить вынесенный из `IdeasListClient.tsx:624` `IdeaDetailPane`, соблюсти tenant-guard/403/404); helper `ideaHref(id)` в одном месте → заменить оба линка.
- **Приёмка:** #85 — «N готово · M формируется» без `undefined` (GET `/structure/summary` отдаёт `forming`); #80 — клик и prefetch `/ideas/<id>` из виджетов дашборда и `/me` открывают деталь, нет 404, ссылка шарится, `GET /api/v1/ideas/:id → 200`, оба линка через `ideaHref`. typecheck/lint/build фронта зелёные.

## Ф7 — чат-UI класс: #57/#58/#39б (P2/P3, фронт) · S

- **#57 утечка маркеров:** бэк намеренно оставляет `[BLOCK:id]` (`chat-v2.service.ts:564`); фронт-стриппер только в `ChatV2Client.tsx:452`. Утекает в **4 местах**: `OrgChatPanel.tsx:213`, `chat-v2/ChatPanel.tsx:150`, `IssueChat.tsx:475`, **`CloneChatClient.tsx:468`** (4-я — клон в factual-режиме). **Фикс:** единый helper `stripContextMarkers` в `frontend/src/domain/chat-v2.ts`, регэксп на ВСЕ формы (`[BLOCK:id]`, `[CONTRADICTING BLOCK]`, слитный `[CONTRADICTING BLOCK:id]`, `[REASONING CHAIN FOR BLOCK id]`, `[DECISION:id]`), класс id `[a-zA-Z0-9_-]+`, схлопывание пробелов; применить во всех 4 + заменить локальный `stripBlockMarkers`. **НЕ применять в support-desk** (`DeskTicketDetailClient.tsx:248` показывает маркеры агенту намеренно; `MyTicketDetailClient.tsx:104` уже чистится на бэке). Гард: unit (снимает все формы; не трогает «(обычный текст)» и markdown `[текст](url)`; идемпотентен).
- **#58 FAB перекрывает ввод:** глобальный FAB `AssistantSidebar.tsx:147` (`fixed bottom-6 right-6 z-40`, монтируется в `AuthenticatedShell`); отступ `pb-20 sm:pr-20` есть только у `ChatV2Client.tsx:373`. **Фикс:** добавить отступ контейнерам ввода `OrgChatPanel.tsx`, `chat-v2/ChatPanel.tsx`, `IssueChat.tsx`.
- **#39б англицизм «AI»:** «AI»→«Кора» (субъект-ассистент) / «ИИ» (нейтрально). Места: `ChatPanel.tsx:95/104/117`, `IssueChat.tsx:341/364/387/392`, `AssistantSidebar.tsx:376`, `AiTypingDots.tsx:8` (aria), **+ `CommandPalette.tsx:411/458/603/662`, `Board.tsx:657`**. «AI-отчёт» оставить (глоссарий). `*reference*/*DesignReference*` — мокапы, не трогать.
- **Приёмка:** грэп фронта (минус `*reference*`, support/desk) — ни одна assistant-поверхность не показывает `[BLOCK/[CONTRADICTING/[REASONING/[DECISION:`; support-desk черновик по-прежнему с маркерами; FAB не перекрывает ввод на 375/1440px; bare «AI» только в «AI-отчёт». typecheck+build зелёные.
- **Опц. отдельный мелкий PR (не блокер):** свести бэк-дубли регэкспа `[BLOCK:id]` к одному классу символов (`knowledge-core` `[a-z0-9]` vs `clones/support` `[a-zA-Z0-9_-]`).

## Ф8 — копирайт / локализация / утечки: #81/#82/#84/#78/#38/#77/#83 · M

- **#81 англо-404:** нет `not-found.tsx`. **Фикс:** создать **root** `frontend/app/not-found.tsx` (обязателен для глобального 404) — серверный русский экран «Страница не найдена» в стиле `AppErrorView` + кнопка-Link «На главную»; опц. `(authenticated)/not-found.tsx` для `notFound()`.
- **#82 сырой `idea_block` (класс):** `conflict.provider.ts:69` `Конфликт карточек: ${resourceType}` + 6 фронт-сайтов (`CurationDetailClient:307`, `CurationQueueClient:291/395/606`, `ConflictDetailClient:255`, `ConflictsListClient:161`). **Фикс:** единый маппер `resourceTypeRu(t)=map[t]??t` (бэк + зеркало `frontend/src/domain/resource-type.ts`), покрыть **ПОЛНЫЙ union** (idea_block, entity, entity_link, regulation, process, policy, decision, fact, note, card, insight, idea, cycle, experiment, intake_issue, knowledge_profile, probe_question, skill_trait); гард-тест «для каждого значения union есть RU». Переводить только **отображение**, не `value` фильтров (`CurationQueueClient` placeholder).
- **#84 заголовки/Org:**
  - двойной «Кора — Кора»: `referrals/page.tsx:6` дописывает «· Кора» поверх template (`layout.tsx:15`). **Фикс:** убрать ручное «· Кора»; design-preview-страницы с «Кора · …» — привести к шаблону или дать им свой layout. Lint-гард на **суффикс** `' · Кора'`/`' — Кора'` в `metadata.title` (НЕ на слово «Кора» — легитимны «Что Кора сделала» `value-recap:6`, «Что Кора знает обо мне» `me/knowledge-profile:6`).
  - desync меню↔title: единый словарь `frontend/src/lib/section-labels.ts` → из него Sidebar и metadata. Свести: `structure/page.tsx:6` «Структура»→«Команда»; **referrals → «Партнёрская программа» (Р9)** в `Sidebar.tsx:302`+page+`MarketingHero.tsx:28`; regulations → «Правила и стандарты» в `regulations/page.tsx:6`+`ComingSoonPage.tsx:69`+`MemoryAccessClient`.
  - «ВЛАДЕЛЕЦ ORG»: корень `SettingsSidebar.tsx:67-68` (uppercase-заголовок «Владелец Org») → «Владелец компании»; прочие пользовательские «Org» в `(authenticated)` → «компания/организация» (массовую зачистку в админке можно вести через существующий `CopyStringsClient` AdminSetting `content`).
- **#78 англицизмы в отчёте:** `daily-digest.prompt.ts` — `:32` SYSTEM «high-severity» → «важные сигналы», `:96/:182` то же; сырые `[${i.kind}]`/`[${d.status}]` (`:99,:107,:184,:191`) маппить через RU-словари `insightKindRu`/`decisionStatusRu` (helper в том же файле, fallback `??value`). *(Правка SYSTEM — разовая допустимая, переменные в SYSTEM не вносить.)*
- **#38 превью встречи:** `MeetingsJournalReal.tsx:1095` «Summary»→«Краткое содержание», `:1136` «Action items»→«Задачи», `:1123` «host»→«ведущий». Reference-файл `(design-preview)` не трогать.
- **#77 мета-модель (Р7 — убрать совсем):** удалить строку ` · модель: ${data.llmTaskRouteId}` из `DailyDigestClient.tsx:383-385` и `WeeklyDigestClient.tsx:262` (оставить «Сгенерировано <дата>»). Модель смотреть через diag/admin.
- **#83 проект «Из встреч» (Р8):** `migrate-task-to-issue.ts:151` description «legacy… (action items)» → «Задачи, перенесённые из встреч.». Ключ `MTG` и латиница (`translit.ts:106 deriveIdentifier`) — **оставить** (by design). Скрипт в `apply-prod-deploy STEPS:499` → доедет на прод (прогнать после выката).
- **Приёмка:** русский 404 на несуществующем URL (root и внутри кабинета); `idea_block`→«карточка знания» во всех 6 местах (+тест на полный union); `<title>` без двойного «Кора» (вкл. design-preview), меню=title (Команда/Партнёрская/Правила сведены); «Владелец компании», нет «Org» в пользовательском копи; отчёт без «high-severity»/сырых kind; превью по-русски; в user-facing digest нет строки модели; описание проекта по-русски. typecheck+lint+build (фронт+бэк) + новый resource-type spec зелёные.

## Ф9 — онбординг/безопасность: ретест #17/#19 + #18/#20/#24/#15 · M

- **#17 РЕТЕСТ (код есть):** прод-прогон — инвайт→вход временным паролем→редирект `/onboarding/change-password`→403 `must_change_password` на API мимо whitelist→смена→доступ открыт. Если падает — точечно добавить флаг в выпавший путь (проверить `/auth/exchange` `auth.controller.ts:75` — гостевой meeting-flow, не должен затрагивать инвайт-сотрудников). **#19 — правок нет** (тосты есть).
- **#18 правило пароля (класс):** копи размазана — `SecuritySection.tsx:106`, `OnboardingChangePasswordForm.tsx:142`, `ResetPasswordForm.tsx:101` vs дробное live-сообщение `password-validation.ts:19,22`. **Фикс:** константа `PASSWORD_RULE_HINT='Минимум 8 символов, минимум одна буква и одна цифра.'` в `password-validation.ts`; `validatePassword` возвращает единое это сообщение; заменить все хардкоды; гард-тест (грэп: строк «Минимум 8 символов»/«буква и цифра» вне `password-validation.ts` нет); обновить `password-validation.test.ts`.
- **#20 когнитивная нагрузка (Р10):** для свежего пользователя дефолтить второстепенные группы (`MEMORY/MANAGEMENT/REFERENCE/CHATS`) в `collapsed` (`Sidebar.tsx`); вернуть **ненавязчивый** welcome-тур (`welcome.ts`+`TourProvider`, кнопка «Пропустить», прогресс в `tour-progress.service`), автозапуск по флагу первого входа — НЕ блокирующий (форс-тур не возвращать, его убрали 28.05). Порог «свежести» — AdminSetting при необходимости.
- **#24 mobile≠desktop nav (Р11):** desktop Sidebar (~35) vs mobile `TrackerBottomNav` (`/me/inbox,/projects,/feed,/me/check-ins,/me`), причём `/me/inbox,/feed,/me/check-ins` в desktop нет. **Фикс:** единый nav-конфиг (один массив `NavItem`), две проекции — desktop sidebar и mobile bottom-nav (top-5 daily) поверх него; минимально, без переписывания рендера `Sidebar.tsx` (1106 строк).
- **#15 роль Telegram-бота:** `InviteEmployeeDialog.tsx:118` и `InviteCreatedDialog.tsx:68` — добавить фразу: «Telegram-бот — личный помощник сотрудника: через него Кора присылает чек-ины, напоминания и собирает короткие апдейты. Подключение по желанию.»
- **Приёмка:** #17 прод-ретест зелёный (или точечный фикс выпавшего пути); #18 единый текст во всех формах + гард-тест; #20 новичок видит ≤~15 пунктов, тур пропускаем, прогресс сохраняется; #24 набор bottom-nav ⊆ desktop (тест сверяет с общим конфигом); #15 роль бота пояснена. typecheck+build+test:unit зелёные.

---

## Прод-операции (для `docs/operations/prod-deploy-log.md`)
- **Миграций БД нет** (Ф1/Ф4/Ф6 — чистый код).
- **Новая ENV (Ф5):** `LLM_MAIN_REPORT_PRIMARY` (default `deepseek`) → `env.schema.ts` + prod-deploy-log Шаг 1 + `feature-flags.md`.
- **Флаг (Ф2):** `LLM_DEEPSEEK_FORCE_TOOL_CHOICE_ENABLED` дефолт ON → строка в `feature-flags.md`.
- **AdminSetting (Ф3):** `vox.wordTimestampsParam/Enabled`, `transcribe.minAudioBytes` (по итогу smoke).
- **Re-run скрипта (Ф8 #83):** `migrate-task-to-issue.ts` уже в `apply-prod-deploy STEPS:499` — прогнать после выката.
- **Кэш-сброс (Ф2/Ф8):** правки SYSTEM-промптов (`meeting-quality-score`, `daily-digest`) разово инвалидируют prompt-cache — ожидаемо.

## Порядок реализации
- **Волна 1 (P1):** Ф1 → Ф2 → Ф5.
- **Волна 2 (фронт-видимое):** Ф6 → Ф7 → Ф8.
- **Волна 3 (расследование+UX):** Ф3 (ШАГ-0 smoke) → Ф4 → Ф9.

## Итог реализации (2026-06-10)

| Фаза | Статус | Коммит |
|---|---|---|
| Ф1 #70 | ✅ сделано | `e696d831` |
| Ф2 #72/#71/#73/#56 | ✅ сделано | `a442fc37` |
| Ф5 #51 | ✅ сделано | `5781b43f` |
| Ф6 #85/#80 | ✅ сделано | `1f035158` |
| Ф7 #57/#58/#39б | ✅ сделано | `73af1791` |
| Ф4 #75 | ✅ сделано | `9550d382` |
| Ф3 #74 + гард | ✅ сделано (БЕЗ #26) | `0652c365` |
| Ф3 #26 | ⏸️ блокер ШАГ-0 smoke (прод) | — |
| Ф8 #81/#82/#84/#78/#38/#77/#83 | ✅ сделано | `a9289d54` |
| Ф9 #18/#15 | ✅ сделано | `048be10e` |
| Ф9 #20/#24 | ⏸️ вынесено в follow-up ТЗ (Sidebar UX) | — |
| Ф9 #17 | ⏸️ нужен прод-ретест | — |

Верификация: typecheck+build (back+front) зелёные; 116 тестов (back 91 / front 25)
зелёные. Отложенное — `plans/tz/2026-06-10-onboarding-nav-and-prod-retest-followup.md`
+ `second-brain/04_не-сделано/README.md`.

## Вне scope этого ТЗ
- **#79** — отдельное ТЗ «консистентность пайплайна задач» (промоут `structuredData.tasks`→Task-модель), **Р5**.
- Улучшения из анализа: умные таблицы (#62–66), план-факт recipient→author (#68), редизайн дашбордов (#67) — свои планы в `plans/analysis/`.
- Фоновое (⏸️, на пользователя не влияет): Ollama 401 (tertiary без ключа), Express 5 deprecation, boot-401 консоли, внешний сканер `/api/.env`.
