---
type: tz
status: needs-owner-go
date: 2026-06-03
owner: sergrv80@gmail.com
branch: feature/action-center-trust-ladder
relates_to:
  - plans/tz/2026-06-03-action-center-remaining.md
  - backend/src/modules/curation/services/curation.service.ts
  - backend/src/modules/knowledge-core/api/entities.controller.ts
phases:
  - E1
  - E2
---

> **Статус:** требуется решение владельца на запуск (исходный ТЗ C1 явно объявил это «не добавлять, если уже есть» — п.17(а) оркестрации). Создано как фиксация пробела, вскрытого при реализации **Фазы C1**.

# «Это неверно» на карточках знаний (обратимость провизорных карточек)

## 0. Откуда взялось (контекст)

ТЗ C1 ссылался на обратимость провизорных карточек: *«легко оспариваются существующей кнопкой "это неверно" (`recordDecision`)… убедиться, что она доступна рядом с провизорными (если уже есть в UI карты — ничего не добавлять)»*.

**Аудит кода (2026-06-03):**
- Backend **готов**: `CurationService.recordDecision()` (`curation.service.ts:710`) — generic post-hoc «карточка/ребро неверны» по `(tenantId, resourceType, resourceId, decisionType, recordedBy)`. Создаёт `CurationItem(status=decided, level=light)` + `CurationDecision`, эмитит `curation.decision_recorded` → обучающий `LlmPreferenceSample`.
- Эндпоинт-образец **уже есть** для сущностей графа: `POST /api/v1/entities/:id/mark-wrong` (`entities.controller.ts:553`) → `recordDecision({ decisionType:'mark_as_misleading', resourceType:'entity'|'entity_link' })`.
- **Пробел:** на карточках регуляций/решений/процессов в UI (`RegulationsListClient.tsx`, `DecisionsListClient.tsx`) **нет** действия «Это неверно», и нет mark-wrong эндпоинта для `resourceType` regulation/decision/process/policy. Значит провизорная карточка **помечена плашкой (C1), но не оспариваема** оттуда, где пользователь её видит — фича работает наполовину.

## Почему вынесено отдельно
Исходный ТЗ C1 формально допускал отсутствие кнопки («ничего не добавлять, если уже есть»). Это самостоятельный кусок (UX-действие + тонкий эндпоинт), а не проброс поля. Backend почти готов (generic recordDecision), поэтому объём небольшой, но запуск — по «да» владельца (п.17а).

## Цель
Дать пользователю оспорить карточку знаний (особенно провизорную) одним действием прямо из Карты знаний → `recordDecision` → откат/обучающий сэмпл.

## Фаза E1 — Backend: mark-wrong эндпоинты для карточек

**Что входит:**
- Тонкие эндпоинты по образцу `entities/:id/mark-wrong`:
  - `POST /api/v1/regulations/:id/mark-wrong` (kind в body или из записи) → `recordDecision({ resourceType: 'regulation'|'process'|'policy', resourceId, decisionType:'mark_as_misleading', recordedBy, reason })`.
  - `POST /api/v1/decisions/:id/mark-wrong` → `recordDecision({ resourceType:'decision', ... })`.
- Zod-DTO body (опц. `reason`), RBAC (тот же гард, что у других мутаций этих модулей), `tenantId` из TenantGuard, `recordedBy` из текущего пользователя.
- Переиспользовать `recordDecision` как есть (не дублировать логику).

**Acceptance:**
- [ ] POST mark-wrong на регуляцию/решение создаёт `CurationItem(decided,light)` + `CurationDecision`, эмитит событие; idempotent-достаточно (повторный вызов = новая light-запись, как у entities).
- [ ] RBAC: чужой tenant/без прав → отказ. Unit/e2e на оба эндпоинта (успех + отказ прав).
- [ ] typecheck/lint зелёные.

## Фаза E2 — Frontend: действие «Это неверно» на карточке

**Что входит:**
- В детали регуляции и решения — кнопка/пункт «Это неверно» (особенно заметно при `trustTier='provisional'`), вызывает соответствующий `*.api.ts` → mark-wrong, тост-подтверждение, обновление SWR.
- Подтверждающий диалог (необязательное поле «почему неверно» — свободный текст). Парные токены, русский.

**Acceptance:**
- [ ] «Это неверно» доступно на детали регуляции/решения; провизорные подсвечены (плашка C1 рядом).
- [ ] Клик фиксирует решение (тост), карточка/список обновляются. typecheck/lint/test:unit зелёные.

## Prod / second-brain
- E1: новые REST-разделы → `prod-deploy-log.md` Шаг 12 (Swagger smoke). Новых таблиц/ENV нет.
- second-brain: `01_projects/admin.md` / `frontend-pages.md` (действие на карточке), `knowledge-core.md` (обратимость провизорных из UI).

## Итог
Не реализовано (фиксация пробела C1). Backend (`recordDecision`) готов, нужен тонкий эндпоинт-обёртка + UX-действие. Запуск — по «да» владельца (п.17а: C1 явно вынес это из scope).
