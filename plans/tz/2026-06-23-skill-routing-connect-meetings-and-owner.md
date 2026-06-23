---
type: tz
status: needs-code-study-first
feature: skill-routing-connect-meetings-and-owner
date: 2026-06-23
owner: sergrv80 (владелец продукта Кора)
relates_to:
  - plans/analysis/2026-06-23-manual-confirmations-autonomy-review-and-probe.md
  - plans/tz/2026-06-22-tasks-subsystem-unified-fix.md
  - plans/tz/2026-06-23-meeting-tasks-assignee-probe-closure-tz.md
---

# ТЗ: Подключить умный подбор «кому поручить» (по зоне ответственности) к встречам и owner-вопросам

## ⚠️ ОБЯЗАТЕЛЬНО ПЕРЕД РЕАЛИЗАЦИЕЙ — изучить существующий код (требование владельца 2026-06-23)

Задачная подсистема (постановка задач из встреч, назначение исполнителя, intake-триаж) **пишется прямо сейчас в параллельной сессии** по ТЗ ниже. К моменту реализации этого ТЗ код мог измениться. **Поэтому:**
1. Сначала `git fetch` + изучить актуальный код: `intake-auto-triage.worker.ts`, `assignee-resolver.service.ts`, `skill-routing.service.ts`, `owner-resolver.service.ts`, `me-tasks.service.ts`.
2. Свериться с параллельными ТЗ — возможно пересечение/часть уже сделана:
   - [`2026-06-23-meeting-tasks-assignee-probe-closure-tz.md`](2026-06-23-meeting-tasks-assignee-probe-closure-tz.md) (резолвер исполнителя встреч — прямо смежно!)
   - [`2026-06-22-tasks-subsystem-unified-fix.md`](2026-06-22-tasks-subsystem-unified-fix.md)
3. **Переформулировать это ТЗ под актуальный код** перед стартом. НЕ начинать реализацию вслепую — велик риск конфликта с тем, что пишется.

## Проблема

Умный подбор «кому поручить по смыслу» — `SkillRoutingService` (tracker/services/skill-routing.service.ts) — берёт текст задачи, ищет, чьи навыки и зона ответственности ближе (embedding по `SkillTrait` + `RoleProfile.summaryCache` обязанности/навыки + LLM-арбитр с обоснованием). **Но включён только** при ручном создании задачи в UI (`me-tasks.service.ts:193`, флаг `tracker.assigneeClarifyEnabled`).

Где НЕ используется (там примитивный подбор по имени):
- **Авто-постановка задач из встреч** — `IntakeAutoTriageWorker` → `AssigneeResolverService` (assignee-resolver.service.ts) подбирает по name-matching, не по компетенции.
- **Owner-вопросы probe** — `OwnerResolverService` использует только parentOwner/roleId/author/candidatePool, профиль «за что отвечает» НЕ смотрит.

Следствие: вопросы «кто ответственный за X» прилетают человеку (напр. «эксперимент Битрикс24 без ответственного»), хотя система могла бы подобрать по зоне ответственности.

## Данные «за что отвечает» (уже есть)

- `ResponsibilityElement` (schema.prisma:5356) — элементы ответственности должности (outcome/function/activity).
- `SkillProfile` + `SkillTrait` (schema.prisma:8183) — навыки человека с `embedding`.
- `RoleProfile.summaryCache` (schema.prisma:5315) — обязанности/навыки/паттерны решений.

## Что делаем (после изучения кода)

1. **Авто-триаж встреч → умный подбор.** В пути `IntakeAutoTriageWorker`/`AssigneeResolverService`: когда исполнитель не выводится name-matching'ом — вызвать `SkillRoutingService` (смысловой подбор по зоне ответственности). Высокая уверенность (≥ `taskRouting.suggestMinConfidence`) → назначить; низкая → короткий вопрос с топ-кандидатами.
2. **Owner-вопросы → умный подбор.** В `OwnerResolverService` добавить ступень «смысловой подбор по зоне ответственности» (через `SkillRoutingService`) перед эскалацией к человеку: parentOwner → роль → автор → **смысловой подбор** → (несколько кандидатов) короткий вопрос.
3. Крутилки — переиспользовать `taskRouting.enabled` / `suggestMinConfidence` (AdminSetting).

## Развилка

- Высокая уверенность подбора → назначать сам (обратимо — переназначить легко); низкая → вопрос с конкретным списком, не «назначить?».

## Не входит

- Изменение самого `SkillRoutingService` (он работает — доказано в UI-пути).
- Унификация Task/Issue и прочие задачи задачной подсистемы (отдельные ТЗ параллельной сессии).

## Граница (честно)

Это ТЗ — контракт намерения. Точные точки внедрения зависят от состояния задачного кода на момент реализации (см. блок «ОБЯЗАТЕЛЬНО» сверху). Локально стоит прогнать `SkillRoutingService` на реальных задачах/сотрудниках (как прогоняли судью), чтобы убедиться в качестве подбора до выката.

## Статус реализации (2026-06-24)

- **[x] Пункт 1 — авто-триаж встреч + intake → умный подбор.** Реализовано (коммит `8c329916`): `SkillRoutingService.suggestAssignee` подключён как fallback-ступень ПОСЛЕ name-matching и ПЕРЕД эскалацией к человеку/владельцу Org — в `meeting-extract-actions.service.ts` (встречи) и `intake-auto-triage.worker.ts` (не-встречи). Крутилка `taskRouting.autoAssignMinConfidence` (0.75) для авто-назначения; метрика `task_skill_routing_assigned_total{path}`. `userId != null` и порог проверяются; fail-soft.
- **[ ] Пункт 2 — OwnerResolver → умный подбор. ОСТАЛОСЬ.** Не реализовано в этой сессии: `OwnerResolverService` живёт в `knowledge-core`, `SkillRoutingService` — в `tracker`; прямой inject создаёт риск цикла модулей `knowledge-core ↔ tracker` (фреймворк-поведение DI, требует проверки на bootstrap, а не угадывания). **Cycle-safe подход к доделке:** не инжектить `SkillRoutingService` в `OwnerResolverService`; вместо этого либо (а) расширить `OwnerResolveArgs` полем готовых `skillCandidates: string[]`, которые вызывающий код заполняет ДО вызова резолвера (но вызывающие — специалисты `specialist-3-1/3-4/3-9-probe` в `knowledge-core`, тот же барьер), либо (б) вынести `SkillRoutingService` в общий `@Global`-модуль (как `knowledge-core`), либо (в) проверить эмпирически, что `imports: [TrackerModule]` в `knowledge-core.module` не циклит (tracker импортирует только PrismaModule и получает knowledge-core через @Global — edge односторонний; подтвердить `Test.createTestingModule(...).compile()` на bootstrap). **Рекомендация:** вариант (в) с DI-smoke-тестом; если цикл — вариант (б). Owner-вопросы (темы C/H/I анализа) до этого закрываются «лестницей владельца» PR #56 (parentOwner→роль→автор→pool).
