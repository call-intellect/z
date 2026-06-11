---
title: ТЗ — усиление всех LLM-промптов Z по единой методологии
date: 2026-06-09
status: ready-to-implement (по фазам; решения владельца Р1–Р5 ЗАФИКСИРОВАНЫ 2026-06-09)
type: tz
source_analysis:
  - plans/analysis/2026-06-09-prompt-fleet-audit.md            # аудит 145 промптов (находки + Приложения А/Б)
  - plans/analysis/2026-06-09-meeting-prompts-strengthening.md # методология (рубрика A1–G1)
  - plans/analysis/2026-06-09-meeting-agents-catalog-prompts-and-models.md # каталог + дословные промпты + модели
---

# ТЗ — усиление всех LLM-промптов Z

> **Что делаем.** По итогам аудита 145 промптов закрываем долг **классами**, а не кейсами: ~11 инфраструктурных правок «один раз» + точечное применение + консолидация дублей/новые агенты. Источник находок и пер-промптовые списки — [аудит](plans/analysis/2026-06-09-prompt-fleet-audit.md) (Приложения А/Б); здесь — контракт реализации.

## Принципы реализации

1. **Гард конструкцией, не инструкцией.** Защита (инъекции, аудитория, статус) должна держаться кодом/структурой вызова, а не фразой в промпте, которую модель может проигнорировать.
2. **Класс, а не кейс** ([feedback](C:/Users/USER/.claude/projects/c--work-z/memory/feedback_fix_the_whole_class_not_the_case.md)): один helper + машинный гард вместо правки N промптов; CI ловит регресс.
3. **Ship-On** ([feedback](C:/Users/USER/.claude/projects/c--work-z/memory/feedback_ship_on_flags.md)): выкатываем включённым. Рискованное (массовая обёртка входа) — за **kill-switch (ON)**, не за «дефолт OFF».
4. **Без golden-гейта** ([feedback](C:/Users/USER/.claude/projects/c--work-z/memory/feedback_no_golden_ship_and_observe_prod.md)): приёмка = `typecheck`+`build`+обновлённые `*.snapshot.spec.ts`; затем выкат и наблюдение прода (diag chain + метрики). Eval не блокирует.
5. **Cache-friendly** ([feedback](C:/Users/USER/.claude/projects/c--work-z/memory/feedback_llm_prompts_cache_friendly.md)): все добавки — стабильные блоки В КОНЕЦ system; переменные данные — в user. Правка SYSTEM ломает кэш провайдеров.
6. **Пороги — в AdminSetting, не в код** ([feedback](C:/Users/USER/.claude/projects/c--work-z/memory/feedback_admin_settings_not_env_or_code.md)): синхронизация якорей C1 = выровнять текст промпта (code) с реальным порогом из `AdminSetting`.
7. **Снапшоты:** многие промпты имеют `*.snapshot.spec.ts` — любая правка промпта = обновить снапшот в том же коммите (часть приёмки фазы).

## Решения владельца (Р) — ЗАФИКСИРОВАНЫ 2026-06-09 (после расследования в коде)

> Расследование 5 развилок (5 параллельных агентов, факты с file:line) уточнило 3 ответа. Итог:

| Р | Вопрос (простыми словами) | РЕШЕНИЕ владельца | Что меняет в ТЗ |
|---|---|---|---|
| Р1 | Выбросить старый v2-путь (tasks-v2/summary-v2/chapters-v2)? | **Удалить целиком.** Подтверждено: на проде выключен рубильником (`KNOWLEDGE_CORE_V2_AGENTS_ENABLED` дефолт OFF, прод не включал), замена meeting-report-fast ON. | Фаза 6: ретайр **всего v2-стека** (3 промпта + 3 extractor-сервиса + meeting-analyze-v2.worker/cron + admin-compare поля + регистрация в module/queue), не только промптов — иначе сломается сборка. Страховка: read-only diag прода перед удалением |
| Р2 | Заводить сущность «Инструкция»? | **Добавить полноценно — отдельная таблица.** Важная сущность (решение продукта, цену принимаем). Старые инструкции, лежащие как «Процессы», **пересчитать backfill-скриптом**. | Новая **Фаза 10** — first-class `Instruction` (новая таблица + извлечение + API + RBAC + фронт-фильтр + backfill) |
| Р3 | Кто видит HR/оценки людей? | **Матрицу не менять** (уже строгая: owner/admin/coo/hr_partner-при-optIn). **Разрешить выдачу ролей** hr_partner/coo через интерфейс (сейчас нельзя — матрица «мёртвая»). HR-рекомендация = текст-совет, авто-действий нет. | Фаза 5: убрать ложный тезис «hr→ЗП-ревью авто»; добавить разблокировку выдачи ролей (UpdateMember/InviteMember) |
| Р4 | Достроить `process-steps-extract`? | **Удалить.** Подтверждённая сирота (0 вызовов в проде; docstring врёт «используется»). | Фаза 6: ретайр |
| Р5 | Свести задачи к одному источнику? | **Перестать писать `AiResult.tasks`** (убрать `runTasks`). Двойного показа в UI **уже нет** (фронт читает только Task-модель через `pickPrimaryTasks`); `AiResult.tasks` — мёртвое поле, но жрёт лишний LLM-вызов на каждой встрече. Проекция НЕ нужна. | Фаза 6: убрать `runTasks`; зачистку контракта `AiResult.tasks` отложить |

---

## Фаза 0 — общий слой (инфраструктура). Спина всего ТЗ

> Эти helper'ы создаются один раз в `backend/src/modules/ai/services/prompts/common.ts` (и точках перехвата). Дальше фазы 2–9 их только **применяют**.

### [ ] Ф0.1 — `applyInputGuards` + централизованная обёртка (I1) — **kill-switch**
- **Что:** функция `applyInputGuards(system, user, { asr?, participants?, meetingDateIso?, injection? })` в `common.ts`, собирающая стек как в `analyze.worker:571-577` (`withInjectionGuard(system)` + `wrapUserData(user)` + опц. `withAsrNote`/`withOrgContextNote`). Точка перехвата — на уровне `llm-router.service.ts` по метаданным taskType (см. Ф0.2), либо явный `withGuardForExtractors(...)` для сервисов вне `analyze.worker`.
- **Контракт:** идемпотентна (повторное оборачивание не дублирует маркеры); no-op при пустом user; флаг `aiFeatures.inputGuardEnabled` (kill-switch, дефолт ON).
- **Файлы:** `common.ts` (+ возможный hook в `llm-router.service.ts`).
- **Приёмка:** unit на идемпотентность + что маркеры `<<<USER_DATA_*>>>` присутствуют; `typecheck`+`build`.

### [ ] Ф0.2 — машинный гард `inputKind` + CI-lint (I2)
- **Что:** в реестре taskType пометить `inputKind: 'raw-transcript' | 'raw-user-text' | 'derived' | 'machine'`. Тест (integration), падающий, если call-site с `raw-*` отправляет в LLM необёрнутый user. Расширить `sanitize-custom-prompt.ts` FORBIDDEN_PATTERNS (рус. «действуй как», «новая инструкция», code-fence ```/~~~, XML role-маркеры `<system>`).
- **Файлы:** `llm-router.service.ts` (метаданные), новый `*.spec.ts`, `sanitize-custom-prompt.ts` (+ обновить `sanitize-custom-prompt.spec.ts`).
- **Приёмка:** тест зелёный на текущих обёрнутых, красный на намеренно-необёрнутом стабе.

### [ ] Ф0.3 — семейство калибровок confidence (I3)
- **Что:** `withForecastConfidenceCalibration` + `withToneConfidenceCalibration` рядом с существующим `withConfidenceCalibration` (common.ts).
- **Файлы:** `common.ts`.
- **Приёмка:** snapshot новых констант.

### [ ] Ф0.4 — `withDecisionDiscriminator` + glossary-ключ (I4)
- **Что:** helper-блок «нормативное и ПОВТОРЯЕМОЕ ≠ разовая активность; решение ≠ пожелание/«надо бы»; системный insight ≠ разовая жалоба; устойчивая черта ≠ единичный эпизод» в `common.ts`; ключ `process-discriminator` в `glossary.ts`.
- **Файлы:** `common.ts`, `glossary.ts` (+ `glossary.spec.ts`).

### [ ] Ф0.5 — единый `status`-enum + правило (I5)
- **Что:** schema-поле `status: 'confirmed'|'proposed'|'needed'|'discussed'` (рус. ярлыки в UI) + общий текст-правило «извлечённый артефакт ≠ подтверждённый; не ставь confirmed/active без явного согласования во входе».
- **Файлы:** общие extract-Zod-схемы; маппинг enum→статус карточки в card-handler'ах. **Схема БД:** если `status` персистится — миграция (`prod-deploy-log` Шаг 4).

### [ ] Ф0.6 — `withPeopleHypothesisGuard` (I6)
- **Что:** helper «оценки людей формулируй гипотезно (похоже, склонен…, с опорой на реплику), без приговоров; чувствительное — приватно».
- **Файлы:** `common.ts`.

### [ ] Ф0.7 — `withDocumentCompilerMode` (I7)
- **Что:** helper с режимами СОЗДАНИЕ/ДОПОЛНЕНИЕ, маркерами `[требует уточнения]`/`[конфликт A/B]`, правилом «ничего не теряй», версией+changelog.
- **Файлы:** `common.ts`.

### [ ] Ф0.8 — прокидка `meetingDateIso` + подключение `withEdgeCasePolicy` (I8)
- **Что:** сделать `meetingDateIso` дефолтным аргументом общего extract-builder; подключить готовый `withEdgeCasePolicy` (common.ts:408) к ключевым extract-путям.
- **Файлы:** `tasks-unified.ts` (builder), call-site block-ingest/regulation/decision/type-*.

**Ф0 закрывает в инфраструктуре:** базу для E2/E1/C1/A1/C2/ПРАВИЛО-ЛЮДИ/F2/E3/E4.

---

## Фаза 1 — 🔴 E2 на мутирующих/внешних входах (немедленно, параллельно Ф0.1)
Эксплуатируемая дыра с побочными эффектами — не ждёт общий слой.
- [ ] `concierge` (concierge.service:466) — дёргает **мутирующие tools** без guard.
- [ ] `intake-auto-triage` — `rawContent` внешнего канала авто-создаёт Issue.
- [ ] `telegram-create-task` / `telegram-forward-to-task` — чужой форвард → исполнители.
- [ ] `commitment-extract-status` — инъекция ложно закрывает обещание.
- **Контракт:** обернуть user в `wrapUserData` + `withInjectionGuard` (через Ф0.1); для intake/telegram — дополнительно A4 (имена только из известных) и C1-порог (Ф0.3).
- **Приёмка:** мини-e2e с инъекцией «забудь инструкции/верни …» → не исполняется; `build`.

## Фаза 2 — массовое применение `applyInputGuards` (E2/E1)
Применить Ф0.1 ко **всем** raw call-site вне `analyze.worker` (полный список — аудит §1.1 + Приложение А, модули ai/services, knowledge-core, table, operations, dashboard, tracker, chat, probe, concierge, brand-voice, feedback, recognition, practice-skills).
- [ ] extract/score-сервисы: ChapterExtractionService, TaskExtractionService, RegenerateService, quality-score.worker, card-rollup(v1), transcript-clean-refine, behavior-refine, specialists-combined, process-template-extract, probe-formulate, role-profile-build, meeting-speaker-analyzer, custom-report.worker.
- [ ] table-*: infer-schema / extract-rows / auto-fill.
- [ ] operations (6 дайджестов), dashboard-summary, goal-vector-tracker, decision-hygiene, sprint-*-digest, goals-pulse, recognition-formulate, brand-voice-extract, feedback-cluster, probe-response-classify, concierge-step-prm, practice-skill-*, checkin-parser, chatbox-summary, chat v1.
- [ ] **Холостые guard'ы** (нота в SYSTEM есть, user не обёрнут): sprint-helper, sprint-review, table-extract-rows, table-infer-schema, follow-up — добавить `wrapUserData`.
- **Приёмка:** CI-lint (Ф0.2) зелёный по всему реестру raw-*; обновить снапшоты; `build`.

## Фаза 3 — 🔴 B3 разделение аудитории конструкцией (I10) + new `client-meeting-split`
- [ ] Разбить клиентский tool-вызов на ДВА: нейтральный протокол наружу (outcome/issues/actions/next_contact) + внутренняя карточка (`internal-only`: churn_risk/upsell/interest_level/objections/ЛПР/наша выгода).
- [ ] Применить к: `type-customer_success` (verdict=split), `type-sales`, `follow-up` (письмо клиенту!), `type-partner`, `type-custdev`, `card-rollup-v2` (client/deal/vendor), `summary-v2` клиентских веток (если не ретайрены, Р1), `chatbox-summary`.
- **Контракт:** поля внутренней карточки помечены `internal: true`; протокол физически не содержит оценочных полей. Отправка наружу — ручная (гейт), не авто.
- **Приёмка:** snapshot обоих контрактов; проверка, что протокол-схема не содержит internal-полей.

## Фаза 4 — смысловые гарды экстракторов (A1 / C2 / E3 / E4)
Применить Ф0.4/Ф0.5/Ф0.8 к экстракторам:
- [ ] **A1** (`withDecisionDiscriminator`): process-template-extract, regulation-extract, specialists-combined, block-ingest (группа Б), type-standup (who_does_what), type-team/project/retrospective/plan_fact, insight-extract, experiment-extract, skill-trait-detect; **в `tasks-unified` BASE_SYSTEM** вынести анти-«надо бы» (чтобы работало и в legacy).
- [ ] **C2** (status-enum): process-template-extract, regulation-extract, decision-extract (убрать дефолт `approved`→`proposed/confirmed` по сигналу), block-ingest, type-*, tasks, insight/idea-extract. *(Сущность «Инструкция» — отдельная Фаза 10, решение Р2.)*
- [ ] **E3/E4**: прокинуть `meetingDateIso` + `withEdgeCasePolicy` (Ф0.8) в block-ingest/regulation/decision/tasks/type-project/retrospective/plan_fact/sales/standup/custdev, table-extract-rows, issue-infer-fields, intake-auto-triage.
- **Приёмка:** снапшоты; diag — на тест-встрече разовая задача больше НЕ создаёт active-«Процесс».

## Фаза 5 — ПРАВИЛО-ЛЮДИ + выдача HR-ролей (Ф0.6 + Р3)
- [ ] Применить `withPeopleHypothesisGuard` к: hr-recommender, knowledge-clone-extract, type-review, type-interview, goal-vector-tracker, team-health, reflection-quality, clone-style (гипотезный регистр оценок людей).
- [ ] **RBAC-видимость — НЕ менять** (уже строгая): `hrSuggestionsJson`/risk/engagement гейтятся `canViewEmployeeFullCard` (owner/admin/coo/hr_partner-при-`analyticsOptIn`); skill/knowledge-profile — owner/admin/direct-manager/self. *(Поправка к аудиту: hr-recommender пишет только `Person.hrSuggestionsJson` (текст-совет), авто-ЗП-ревью/эскалации НЕТ.)*
- [ ] **Разблокировать выдачу ролей (Р3, главное действие):** расширить `UpdateMemberSchema` (orgs/dto/update-member.dto.ts) и `InviteMemberSchema` (invite-member.dto.ts) до `owner|admin|manager|coo|hr_partner` — иначе матрица «мёртвая» (HR-роль некому выдать). Это решение владельца (разграничение доступа) — выкатывать с выбором роли в UI.
- [ ] *(опц.)* Закрыть расхождение: `ClonesService.canAccessPersonClone` не учитывает coo/hr_partner, хотя policy.csv им read разрешает — привести к `RbacService`.
- **Приёмка:** назначение роли hr_partner/coo через UI/API проходит; роль без права → скрыто/403; снапшоты.

## Фаза 6 — F3 единые владельцы сущности + консолидация (Р1, Р4, Р5)
- [ ] **Задачи (Р5):** убрать `runTasks` из analyze.worker — перестать писать `AiResult.tasks` (мёртвое поле, фронт читает только Task-модель через `pickPrimaryTasks`). Зачистку контракта `AiResult.tasks` (ApiDto→Domain) **отложить** отдельным рефакторингом. Перед удалением сверить crossmark-интеграцию (читает поле наружу) — при необходимости перевести на `MeetingActionItemsService`.
- [ ] **Качество:** один источник 5-категорийной оценки (meeting-report-fast vs meeting-quality-score).
- [ ] **Telegram:** один builder `mode=own|forward` (+ закрыть E2/A4/C1 на call-site).
- [ ] **goalId:** убрать goal-ветку из issue-infer-fields (владелец — issue-goal-suggest).
- [ ] **chat-v2-synthesize MODE_PROMPTS:** перенести addon (конфликты+калибровка) в боевые BASE/factual/synthetic → ретайр MODE_PROMPTS (мёртвый, только в spec).
- [ ] **Ретайр v2-стека (Р1) — целиком:** 3 промпта (tasks-v2/summary-v2/chapters-v2) + 3 extractor-сервиса (tasks/chapters/summary-extractor-v2) + `meeting-analyze-v2.worker.ts` + `meeting-analyze-v2.cron.ts` + регистрация в `knowledge-core.module.ts` + очередь `MEETING_ANALYZE_V2` + admin-compare поля `summaryV2`/`analyzeV2` (контроллер + `AdminMeetingCompareSummaries.tsx`) + члены union/ALL_LLM_TASK_TYPES. Упростить `pickPrimarySummary` → `summaryFast || summary`. Колонки БД (`AiResult.summaryV2*`, `Meeting.analyzeV2*`) можно оставить мёртвыми. **Страховка:** перед удалением — read-only diag прода (нет встреч с непустым `summaryV2` за недели).
- [ ] **Ретайр сироты (Р4):** `process-steps-extract` — удалить промпт + члены union/ALL + синхронно импорт в `smoke-all-agents-runner.ts`; почистить комментарий-обещание в `specialist-3-1-regulations.service.ts`.
- **Приёмка:** `build` зелёный после удаления стека (нет битых импортов); grep — нет двойного извлечения задач/качества; UI-счётчик задач не изменился (фронт и так на Task).

## Фаза 7 — new `structured-document-compiler` (Ф0.7 + Р4)
- [ ] Один компилятор-владелец регламент/процесс/инструкция: F2 (создание/дополнение, версии, маркеры) + D1 (действующая vs устаревшая редакция) + C2 (статус), incremental к существующему `contentMd`. Поглощает три источника ProcessStep.
- **Контракт:** на вход — накопленные блоки темы + текущий документ; на выход — структурный документ + changelog + статус. Связать с `CardVersion`/UI «История версий».
- **Приёмка:** на повторной встрече по той же теме документ ДОПОЛНЯЕТСЯ (не перезатирается), пробелы помечены `[требует уточнения]`.

## Фаза 8 — F1 cache-friendly + D1 supersession в активных путях
- [ ] **F1:** вынести переменные данные из SYSTEM в user — clone-respond (имена/persona), concierge (preHits), goal-alignment («дедлайн близок»), chat-v2-synthesize, participant-context (закрепить контракт «список — в user»).
- [ ] **D1:** supersession-правило в card-rollup-v2, clone-respond, chat-v2-factual (перенести из synthetic), decision/regulation-арбитры, debate-decision-supersede stance, block-distill/reframing/entity-merge.
- **Приёмка:** снапшоты; проверка кэш-хитов в логах роутера на повторных вызовах одной Org.

## Фаза 9 — C1-калибровка на необратимом + I11 (structured output)
- [ ] Применить калибровки (Ф0.3) + **синхронизировать якоря с реальными порогами** (`AdminSetting`): intake-auto-triage (0.92→0.75), telegram (0.85), issue-infer (0.7), hr-recommender; generic — к block-linker/entity-link/specialists-combined/tasks-v2/fact-supersede; прогнозную — forecaster; тональную — meeting-speaker-analyzer/team-health.
- [ ] **КРИТ:** `fact-supersede` confidence течёт как вес ребра графа — откалибровать.
- [ ] **I11:** native json_schema strict для daily-digest/goals-pulse/orchestrator-plan/feedback-cluster.
- **Приёмка:** якорь промпта = порог кода (grep-сверка); снапшоты.

---

## Фаза 10 — новая сущность «Инструкция» (Instruction) — first-class (Р2)

> Решение владельца: «Инструкция» (пошаговое руководство для одного исполнителя — «как сделать X») — **важная отдельная сущность**, в один ряд с Регламент/Процесс/Политика. Хранение — **отдельная таблица**; старые инструкции (лежат как `Process`) — **пересчитать backfill-скриптом**.
>
> Контекст: сейчас извлечение знает kinds `regulation/process/policy/standard`; инструкция валится в `process`. На фронте фильтр уже подписан «Процессы и инструкции», но отдельной сущности нет.

### [ ] Ф10.1 — Модель и миграция
- Новая Prisma-модель `Instruction` по образцу `Process` (поля: name, statement/contentMd, ownerHint/forRole, status, версии/`InstructionVersion` при необходимости, embedding для KNN). Дискриминатор статуса — единый `status`-enum из Ф0.5.
- **Миграция** — additive (новая таблица, **без** необратимого `ALTER TYPE ADD VALUE`), `prisma:migrate` + новые HNSW/GIN-индексы в `postgres-init.sql` → `prod-deploy-log` Шаги 4–5.

### [ ] Ф10.2 — Извлечение (LLM)
- Добавить `kind='instruction'` в enum обоих промптов: `regulation-extract.prompt.ts` (JSON-schema) и `specialists-combined.prompt.ts` (Zod + JSON) — синхронно (иначе один путь знает, другой нет).
- Подмешать `withDecisionDiscriminator` (Ф0.4): инструкция = пошаговое «как сделать» **для одной роли**; ≠ процесс (сквозная цепочка ролей), ≠ разовая задача. Признак single-role — из уже существующего `scope='role:<id>'`.
- Обновить `RegulationDraft`-тип + ветку маршрутизации в `specialist-3-1-regulations.service.ts` (новый `upsertInstruction`) и `specialists-combined.service.ts` (`persistInstructions`).
- *(cache: правка SYSTEM ломает кэш промпта один раз — приемлемо; сделать одним заходом.)*

### [ ] Ф10.3 — API + RBAC + card-handler
- `regulations.service.ts`/controller/DTO: `RegulationKindSchema` += `instruction`; роутинг `list/getByIdAndKind/confirm/correct/supersede`; мапперы.
- `rbac.service.ts` + `policies/policy.csv`: новый `ResourceType` `instruction` (права как у `process`).
- `specialist-3-1-card-handler.service.ts`: отдавать `type: 'instruction'` (для chat-v2 retrieval).

### [ ] Ф10.4 — Фронт
- `regulations.api.ts` (`RegulationKindApi`), `domain/regulation.ts` (`REGULATION_KIND_LABEL` += «Инструкция»), `RegulationsListClient.tsx`: отдельная вкладка-фильтр «Инструкции» (отделить от «Процессы»).

### [ ] Ф10.5 — Backfill старых данных
- `backend/scripts/backfill-reclassify-instructions.ts`: пройти по `Process` со `scope='role:*'` / признаком single-role (или LLM-переклассификация по contentMd) → перенести в `Instruction`. Идемпотентно, dry-run по умолчанию. Зарегистрировать в `apply-prod-deploy.ts` (`STEPS`, phase update) + `prod-deploy-log` Шаг 8.

**Приёмка Ф10:** на тест-встрече инструкция извлекается как `Instruction` (не `Process`); старые единично-ролевые процессы после backfill видны во вкладке «Инструкции»; `typecheck`+`build`+миграция применяется; снапшоты обоих промптов обновлены.

> **Связь с Фазой 7:** `structured-document-compiler` (компилятор регламент/процесс/инструкция) обслуживает и `Instruction` — режимы СОЗДАНИЕ/ДОПОЛНЕНИЕ + версии применяются к ней так же.

---

## Карта «фаза → закрывает»

| Фаза | Измерения | Кол-во пробелов |
|---|---|---|
| Ф0 + Ф2 | E2, E1 | ~66 + ~18 |
| Ф1 | E2 (critical) | 4 (приоритет) |
| Ф3 | B3 | ~8 |
| Ф4 | A1, C2, E3, E4 | ~14+20+21+17 |
| Ф5 | ПРАВИЛО-ЛЮДИ | ~7 |
| Ф6 | F3 | ~18 |
| Ф7 | F2 (документы) | ~7 |
| Ф8 | F1, D1 | ~6 + ~42 |
| Ф9 | C1, F4 | ~19 |

## Приёмка ТЗ (общая)
- `cd backend && bun run typecheck && bun run lint && bun run build` зелёные.
- Все затронутые `*.snapshot.spec.ts` обновлены в тех же коммитах.
- CI-lint `inputKind` (Ф0.2) зелёный по всему реестру.
- Прод-наблюдение (без golden): diag chain на тест-встрече — (а) разовая задача НЕ создаёт active-«Процесс»; (б) инъекция в транскрипте не исполняется; (в) клиентский протокол не содержит internal-полей.

## Прод-операции (предварительно)
- **ENV/флаги:** `aiFeatures.inputGuardEnabled` (kill-switch) → `feature-flags.md` + `prod-deploy-log` Шаг 1.
- **Схема БД:** `status`-enum (Ф0.5) + **новая таблица `Instruction`** (Ф10.1) — миграции → Шаг 4; новые HNSW/GIN-индексы Instruction → Шаг 5.
- **Backfill:** `backfill-reclassify-instructions.ts` (Ф10.5) → `apply-prod-deploy.ts` STEPS + `prod-deploy-log` Шаг 8.
- **RBAC/роли:** новый ResourceType `instruction` + разблокировка ролей hr_partner/coo (Ф3/Ф5) → `policies/policy.csv` + `feature-flags.md` (решение владельца).
- **Ретайр v2-стека (Ф6):** перед удалением — read-only diag прода (нет живых `summaryV2`).
- Детальную инструкцию выката формировать по факту реализации фаз.

## Что НЕ входит
- Переписывание deprecated-файлов (их ретайр, а не усиление).
- Изменение моделей/маршрутов (это [каталог моделей](plans/analysis/2026-06-09-meeting-agents-catalog-prompts-and-models.md), отдельная тема).
- Golden/eval-харнесс как блокер (по политике — выкат и наблюдение прода).

## Итог
Реализовано: нет (ТЗ). Объём: 145 промптов; долг сворачивается в **8 общих helper'ов/правок (Ф0) + машинный гард**, затем точечное применение по фазам 2–9 и консолидация (5 merge, 4 retire, 4 new). Порядок — по приоритетам аудита (безопасность → массовый класс-фикс → аудитория → смысловые гарды → консолидация). Реализацию начинать только по явному «погнали делать Фазу N».
