---
type: tz
status: ready-to-implement
feature: probe-drafts-process-steps-and-auto
date: 2026-06-24
owner: sergrv80 (владелец продукта Кора)
parent: plans/tz/2026-06-12-probe-auto-drafts-phase24.md
relates_to:
  - plans/tz/2026-06-23-remove-manual-confirmations-master-tz.md
  - plans/tz/2026-06-23-curation-judge-context-and-methodology.md
---

# ТЗ: Probe-черновики Фаза Б/В — шаги процесса через CurationItem + AUTO skill/knowledge

> **Контекст.** Блок B мастер-ТЗ `2026-06-23-remove-manual-confirmations-master-tz.md` реализован частично:
> - **Сделано (коммиты `73e6d0df`, `5fd2d028`):** инфраструктура черновика (`probe-draft-from-memory` taskType + промпт + `ProbeFormulationService.draftFromMemory` + крутилка `probe.draftReasons` + диспетчер прикрепляет черновик + `ProbePendingDetail.draftAnswer` + фронт ProbeCard HYBRID + запись при подтверждении). Вертикали **урок эксперимента** (Ф-А) и **миссия/видение/стратегия** (эмиттер + черновик + запись) — закрыты.
> - **Осталось (этот файл):** два риск-вертикала, осознанно вынесенных отдельным шагом, потому что оба пишут в «опасные» места (определение шагов процесса / профиль навыков) и требуют гейта качества.

## Зачем отдельно (обоснование выноса)

Оба оставшихся пункта нарушили бы инвариант «не писать молча в рискованные структуры», если делать их «в лоб»:
1. **Шаги процесса** живут в `ProcessTemplateVersion.definitionJson` — решение W2 (`plans/archive/2026-06-11-autonomy-remove-manual-confirmations.md`) прямо гласит «JSON авто не пишем». Поэтому черновик шагов идёт **через CurationItem-предложение**, а не прямой записью.
2. **AUTO skill/knowledge** — это **тихая запись** в профиль навыков/экспертизы (внешне-наблюдаемое изменение того, что система «знает» о человеке). По принципу Ship-On такое выкатывается только за гейтом качества (composite judge) + kill-switch, а не «по детекту специалиста».

Инфраструктура черновика уже готова — эти вертикали её переиспользуют.

## Фаза Б — черновик выхода/шагов процесса (HYBRID через CurationItem)

### Б1. `process_template.missing_output_artifact` — черновик выходного артефакта шага
- **Эмиттер уже есть:** `ProcessTemplateProbeService` (`backend/src/modules/processes/services/process-template-probe.service.ts`) шлёт reason `process_template.missing_output_artifact`, payload содержит `contextCardId=template.id`, `contextCardKind='process_template'`.
- **Что добавить:**
  - Ветку в `ProbeFormulationService.draftFromMemory` для этого reason: загрузить шаблон + `definitionJson` (через `ProcessTemplateProbeService.loadDefinition` или прямой read версии), найти шаги без `outputArtifact`, собрать `facts` (название процесса + название шага + контекст), вызвать `callDraftLlm` (kindLabel='выходной артефакт шага'), вернуть `{ draftAnswer, draftKind: 'process_output_artifact' }`.
  - Добавить `process_template.missing_output_artifact` в дефолт `probe.draftReasons`.
  - **Запись при подтверждении — НЕ прямая.** В `probe-response.handler.ts` для этого reason создать **CurationItem-предложение** (`resourceType='process_template'`, `resourceId=template.id`, `proposedPayload={ stepId, outputArtifact: answer }`, `status='pending'`, `level='light'`) — чтобы изменение `definitionJson` прошло обычную курацию, а не молча. Модель CurationItem — `schema.prisma`.

### Б2. `regulation.process_no_steps` — черновик шагов процесса (через CurationItem)
- **Эмиттер уже есть:** `Specialist31ProbeService.checkProcessNoSteps` (reason `regulation.process_no_steps`, `contextCardId=proc.id`, `contextCardKind='process'`).
- **Что добавить:**
  - Ветка в `draftFromMemory`: собрать контекст процесса (название + связанные блоки/решения), `callDraftLlm` (kindLabel='шаги процесса'), вернуть черновик списка шагов.
  - Добавить reason в `probe.draftReasons`.
  - **Запись при подтверждении — через CurationItem** (`resourceType='process'`, `proposedPayload={ steps: [...] }`, `status='pending'`). НИКОГДА не писать `definitionJson` напрямую из обработчика ответа.

### Acceptance Ф-Б
- Черновик артефакта/шагов показывается в ProbeCard (как урок/миссия).
- Подтверждение создаёт **CurationItem pending**, а не пишет `definitionJson` напрямую (проверить тестом: `prisma.processTemplateVersion.update` НЕ вызван; `prisma.curationItem.create` вызван).
- Kill-switch: эти reason'ы в `probe.draftReasons` (крутилка) — отключаются без релиза.

## Фаза В — AUTO skill/knowledge (тихая запись за judge-гейтом)

Поводы: `knowledge.new_expertise_detected`, `skill.profile_starved`, `skill.contradicting_traits` (специалисты `specialist-3-2-probe`, `specialist-3-7-skill-probe`). Сейчас они ВСЕГДА шлют probe «подтвердить?». Под Р1 (человек = аварийный стоп) — для бесспорных переводить в AUTO: тихо записать (judge одобрил), probe убрать.

### В1. Механизм
- **Гейт:** перед emit probe (в специалисте или в `ProbeService.suggest` по списку AUTO-reason'ов) прогнать composite-judge (переиспользовать `MultiAgentDebateService.judge` с новым `taskFamily` ИЛИ существующий judge skill-trait — сверить с `skill-trait-detect`). Если judge уверенно accept → выполнить тихую запись (записать экспертизу/трейт в профиль) и НЕ создавать probe (`dropped: 'policy_silent'` как у `MACHINE_FILLABLE_REASONS`). Если judge не уверен → probe как сейчас.
- **Реестр AUTO-reason'ов:** крутилка `probe.autoSilentReasons` (AdminSetting, список, kill-switch через пустой список). Аналог существующего `MACHINE_FILLABLE_REASONS`/`resolveProbeProvenance` в `probe-reason-policy.ts` — расширить тот же механизм.
- **Метрика доли тихих записей:** `probe_auto_silent_total{reason}` — наблюдать, не растёт ли override (человек потом отменяет тихо-записанное).

### В2. Путь тихой записи
- `knowledge.new_expertise_detected` → записать экспертизу в `SkillProfile`/`SkillTrait` (сверить существующий write-путь специалиста 3-2; он уже умеет писать при подтверждении — вызвать тот же код без probe).
- `skill.profile_starved` / `skill.contradicting_traits` → как правило это сигналы «мало данных»/«противоречие» — для них AUTO означает не «записать», а «не дёргать человека» (понизить в дайджест/проглотить). Уточнить с владельцем, нужна ли тут запись или просто NUDGE.

### Acceptance Ф-В
- Для AUTO-reason'а при уверенном judge: probe НЕ создаётся (`dropped: 'policy_silent'`), запись выполнена, метрика инкрементнута.
- При неуверенном judge: probe создаётся как раньше.
- Kill-switch `probe.autoSilentReasons` пустой → поведение как до фичи (всё через probe).
- Тест: override-rate не отслеживается автоматически — наблюдать на проде (diag), не блокирующий golden ([[feedback_no_golden_ship_and_observe_prod]]).

## Развилки для владельца
- **Р-AUTO-1:** для `skill.profile_starved`/`contradicting_traits` — тихо писать или просто перевести в NUDGE-дайджест? (Рекомендация: NUDGE — это сигналы качества данных, а не факты для записи.)
- **Р-AUTO-2:** порог уверенности judge для тихой записи экспертизы (рекомендация: высокий, как у gray-zone курации, старт 0.8 единогласно).

## Принципы
- Промпты — по методологии, cache-friendly. Крутилки — в AdminSetting. Рискованная запись (`definitionJson`, профиль навыков) — через CurationItem/judge-гейт, никогда молча мимо гейта.
- Выкат Ship-On + наблюдение прода (override-rate, доля тихих записей).

## Граница (честно)
Ф-В зависит от качества composite-judge на доменах «экспертиза/трейты» — прогнать локально на реальных профилях (как прогоняли судью курации) до выката. Ф-Б проверяется по факту создания CurationItem (детерминированно).
