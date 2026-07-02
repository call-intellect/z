---
date: 2026-07-01
feature: clone-entity-link-and-authorship
tz: plans/tz/2026-06-30-clone-entity-link-and-authorship.md
branch: work/2026-06-29
commits:
  - 3d535343 feat(knowledge-core) Ф1 — lazy Person→Entity линковка в rebuild-движке клона + backfill
  - 4b098e55 feat(knowledge-core) Ф2 — single-author fallback в attributeSubject
---

# Рефлексия — линковка Person↔Entity клона + авторство блоков без таймкодов (C1 #3,#4)

## Что было поставлено
ТЗ `2026-06-30-clone-entity-link-and-authorship.md` — две независимые от извлекающего слоя корректностные правки сборки клонов сотрудников:
- **Ф1 (C1-#4).** `loadBlocksForPerson` (rebuild-движок профиля) при `Person.entityId=null` молча `return []` → сотрудник без авто-линковки `Entity` тихо выпадает из сборки, пробел невидим. Сделать видимым (counter) + lazy-резолв + запись ОБОИХ полей композитного FK + разовый backfill.
- **Ф2 (C1-#3).** `attributeSubject` у источников без таймкодов (`startMs=0`, `seg=null`): при единственном авторе по сегментам, но пустом event-level actor, авторство теряется (`via='none'`). Узкий single-author fallback.

Оркестрация скиллом `tz-orchestrator`: картография → промпты двум кодерам → независимая приёмка → ревью → коммит по фазам.

## Как решал
- **Картография на свежем `git pull`** (ветка `work/2026-06-29`, уже не дефолтная — работал прямо в ней, новую не плодил). Все line-номера в ТЗ слегка дрейфовали (метрики/резолвер +36 строк) — кодерам отдал ДОСЛОВНЫЕ сниппеты, а не номера.
- **Ф1 и Ф2 — непересекающиеся файлы** (ТЗ это разрешил) → запустил двух кодеров (`general-purpose`) ПАРАЛЛЕЛЬНО в фоне, приёмку и коммиты держал раздельно по фазам.
- Ф1: `specialist-3-2-knowledge-clone.service.ts` (инъекция `EntityResolutionService` + lazy-ветка в `loadBlocksForPerson`), новый counter `knowledge_clone_person_no_entity_total{tenant}` в `business-metrics.service.ts`, backfill `backfill-knowledge-clone-person-entity.ts` + STEPS, спек `…loadblocks.spec.ts`.
- Ф2: только ELSE-ветка `attributeSubject` в `block-ingest.worker.ts` (distinct `segAuthors`, fallback при `length===1`, `via='author_fallback'`) + 2 теста в готовый `block-ingest.subject.spec.ts`.

## Что вышло (верификация — прогнал сам, не по отчёту агентов)
- **typecheck (вкл. spec): 0 ошибок** на всём бэкенде. Помеченный в памяти «stale-Prisma red» в этот раз отсутствовал.
- **lint: 0 errors** (16 warnings — pre-existing «Unused eslint-disable» в `apply-prod-deploy.ts`, вне моей вставки).
- **build: зелёный** — но первый прогон упал `Abort trap: 6` (V8 OOM, не тип); перезапуск с `NODE_OPTIONS=--max-old-space-size=8192` прошёл чисто.
- **тесты модуля knowledge-core: 137 файлов / 1052 passed** (вкл. новые 11; debug-лог подтвердил `via:'author_fallback'`).
- **backfill — живой двойной прогон на dev-БД** (docker-сервисы были подняты, `.env` есть): apply#1 → 9 кандидатов → linked=9/errors=0; apply#2 → 0 кандидатов (идемпотентность доказана не на словах). Заодно это подняло полный DI-граф → проверило рантайм-инъекцию `EntityResolutionService` (чего build не ловит).

## Чему научился / грабли
- **`args = {...args, entityId}` из буквы контракта давал TS2322.** После реассайна параметра `args.entityId` снова получал тип параметра `string|null`, и Prisma-`where` отвергал nullable. Кодер сам нашёл и применил типобезопасную локальную `let entityId` с сужением — это правильный «докажи и применяй», поведение идентично. Урок: в контракт-сниппетах ТЗ полезно сразу закладывать узкий тип, а не реассайн параметра.
- **`incSubjectAttribution({via: string})` — `via` свободная строка**, не union. «Расширить allowed via» из ТЗ оказалось no-op на уровне метрик-сервиса: новое значение проходит без правки. Не каждый «расширить enum» в ТЗ = реальная правка типа — проверять фактический тип до планирования.
- **build на этой машине OOM'ит без `--max-old-space-size=8192`** — отличать V8-abort (код 134, стек node без `error TS`) от типовой ошибки; typecheck — авторитетный гейт типов, build добавляет только emit.
- **vexp free-cap реально режет бэкенд** (`run_pipeline` вернул только фронт-пивоты) — для backend-картографии быстрее `find` + `Read` по точным path:line из ТЗ.
- **Параллельные фоновые кодеры в общем дереве** безопасны, только если файлы строго не пересекаются: tsc одного поймал in-flight правку другого (ложно-«unrelated :414») — это снялось само после финиша обоих.

## Прод
Один идемпотентный backfill (Шаг 8), схемной миграции/ENV/AdminSetting нет. Полная инструкция — `docs/operations/prod-deploy-log.md` (блок 2026-07-01 clone-entity-link-and-authorship).
