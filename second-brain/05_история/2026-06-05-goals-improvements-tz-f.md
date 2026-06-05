---
title: ТЗ-F — Цели и стратегия: улучшения (Ф1–Ф4)
date: 2026-06-05
type: reflection
feature: goals-improvements
branch: feature/goals-improvements
relates_to:
  - plans/tz/2026-06-05-goals-improvements.md
  - plans/analysis/2026-06-05-dashboards-improvements-reality-check-and-tz-map.md
---

# ТЗ-F — Цели и стратегия: улучшения

## Что было поставлено

Второе из 7 ТЗ дашбордов (порядок A→F→B→D→C→G→E; ТЗ-A закрыт в этой же сессии на отдельной ветке). ТЗ-F — сделать экран «Цели» понятным владельцу-нетехнарю и привязать цель к ответственному человеку. 5 фаз; Ф5 (голосовая постановка) — опциональная, по ТЗ «Ask first».

Пять болей: цель обезличена (нет ответственного), светофор уверенности считается но не показан (балл «45» пугает), два индикатора движения противоречат, жаргон `cron`/`snapshot`/`timeline`/`₽` в UI, высокий порог входа на создание цели.

## Как решал (оркестрация)

Ветку завёл **от `origin/dev`** (ТЗ-F не пересекается с файлами ТЗ-A: goals vs dashboard). Вёл фазами через суб-агентов, каждую принимал сам (греп → re-Read → свой typecheck/lint/build/тест).

| Фаза | Файлы | Коммит |
|---|---|---|
| Ф1 backend | `schema.prisma` (Goal.ownerPersonId + relation + index + cachedBlocksCount; Person.ownedGoals), `goals.dto.ts`, `goals.service.ts` (assertOwnerPersonExists, include, connect/disconnect, mapList, get-override), `goals.service.spec.ts` (+3, 8/8) | `afe344b2` |
| Ф1 frontend | `domain/goal.ts`, `goals.api.ts`, `GoalsClient.tsx` (пикер через usePersons, sentinel `__none__`, карточка), `goal.test.ts` (фикстура) | `2701cff2` |
| Ф2 | `domain/goal.ts` (confidenceLevel/chip/labels), `strategic-alignment.worker.ts` (+`cachedBlocksCount`), GoalsClient/GoalDetailClient (чип), `goal.test.ts` (+5, 21/21) | `62febeec` |
| Ф3 | `domain/goal.ts` (movementVerdict/chip), GoalsClient/GoalDetailClient (чип-вердикт), `goal.test.ts` (+4, 25/25) | `158ac9df` |
| Ф4 | GoalsClient/GoalDetailClient (7 видимых строк: Timeline→«История движения», snapshots→«замеры», cron→«каждую ночь», `₽` убран) | `184bce07` |

## Что вышло (верификация)

- **Backend:** typecheck+lint+build зелёные; `goals.service.spec` 8/8 (вкл. owner_person_not_found, disconnect).
- **Frontend:** typecheck+lint+production build зелёные; `goal.test.ts` 25/25 (confidenceLevel + movementVerdict golden-кейсы).
- Все grep-маркеры acceptance подтверждены лично; в видимом UI целей `cron`/`snapshot`/`timeline`/`₽` = 0 (остатки — только имена компонентов `TimelineChart`/`SnapshotRow` и код-комментарии).
- **Схема:** применена `prisma:generate` (валидирует relation + типы клиента). **`prisma db push` НЕ выполнялся — dev-БД была выключена.** Реальный push — prod Шаг 4 (`docs/operations/prod-deploy-log.md`). Юнит-тесты мокают prisma, поэтому зелёные без БД.

## Чему научился / грабли

1. **Prisma checked vs unchecked input — create ≠ update.** В `goals.service.create` data-объект уже использует скаляры (`tenantId`, `createdById`, `parentGoalId`) → это `GoalUncheckedCreateInput`. Добавить туда relation-`connect: { ownerPerson }` → TS2322 (mix checked/unchecked запрещён). Решение: в **create** — скаляр `ownerPersonId`, в **update** (`GoalUpdateInput`, checked) — relation `connect/disconnect` (как у `parent`). Кодер сам поймал и обосновал — верно.
2. **Структурная полнота типов бьёт по тестам/фикстурам.** Добавление 3 обязательных полей в `GoalListItemApi`/inline-тип `mapList` ломает typecheck во ВСЕХ конструкторах: фронт-фикстура `goal.test.ts` и mock-объекты в backend spec. Закладывать правку фикстур в acceptance каждой схемной фазы.
3. **Radix Select не принимает `value=""`.** Для «Не назначен» — sentinel `'__none__'`, маппинг в `null` на submit. Известная грабля, заложил в промпт сразу.
4. **Светофор — derive, не колонка.** `themesCount`/`blocksCount` уже пишутся воркером; добавил лишь денормализацию `cachedBlocksCount` (для списка без JOIN) тем же `tx.goal.update`. Новой `confidence`-колонки/backfill избежали (C-1). Пороги — code-fallback в `domain/goal.ts`, вынос в AdminSetting → vNext.
5. **Параллельная сессия — снова видна.** На ветке ТЗ-A ранее лёг чужой коммит `f4c0513b` (другая сессия, общий git HEAD). ТЗ-F вёл на отдельной ветке от origin/dev — чисто.

## Что НЕ сделано

- **Ф5 (голосовая постановка цели)** — НЕ реализована. По ТЗ это опциональная фаза с пометкой «⚠️ Ask first перед стартом» (полная = ASR + новый LLM-extraction taskType + UI-форма — самостоятельная фича). Вынесено владельцу на решение: полная / toast-заглушка / отдельное ТЗ vNext.
- **`prisma db push` на проде** — обязательный Шаг 4 (см. prod-deploy-log); на dev не применялся (БД выключена).

## Что дальше

ТЗ-F (Ф1–Ф4) закрыт. По плану дальше — **ТЗ-B** (вектор-компас, `Goal.isPrimary`), затем D/C/G/E. Схему трогают B и D — re-Read `model Goal` перед правкой (ownerPersonId уже там, не перезатереть).
