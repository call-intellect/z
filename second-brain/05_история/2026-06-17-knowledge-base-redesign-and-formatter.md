---
title: «База знаний»: форматтер на создании карточки + редизайн раздела (Ф1–Ф6)
date: 2026-06-17
type: reflection
distilled: false
---

# База знаний — форматтер + редизайн — рефлексия 2026-06-17

## Что было поставлено

ТЗ `plans/tz/2026-06-16-knowledge-base-redesign-and-formatter-tz.md`, ветка
`feature/knowledge-base-redesign-formatter`, 6 фаз (Ф5 разбита на 5a backend-обвязка
+ 5b frontend-раскладка). Две связанные цели:
1. **Форматтер на создании** — каждая карточка регламента / процесса / политики /
   инструкции должна быть структурна (с `## ` заголовками и таблицами) уже с **первой**
   версии, а не только после слияний. Раньше компилятор `compile-org-document` зывался
   только на merge/extension, и карточка-`new` несла сырой `draft.statement`; у instruction
   компилятор не вызывался **вообще**.
2. **Редизайн раздела** — переименовать «Оцифровано» → «База знаний», навести таксономию
   и счётчики, переложить страницу `/regulations` на современную раскладку (дерево/колонка/TOC)
   за аварийным рубильником. Ship-On — всё включено по умолчанию.

## Как решал (по фазам, с файлами и коммитами)

Оркестрация суб-агентами по фазам: картография кода → промпт кодеру → независимая приёмка
(`typecheck` / `lint` / `build` / затронутые spec) → ревью → коммит по фазам.

- **Ф1 `6e98d3a8` (backend, `specialist-3-1-regulations.service.ts`)** — компилятор
  `StructuredDocumentCompilerService.tryCompileContent` заведён в ветке `new` для
  regulation / process / policy И впервые для instruction (раньше у instruction не вызывался
  нигде). При успехе LLM пишем `compiled.contentMd` (у process — в `description`) + снимок
  `CardVersion` v1 одной транзакцией (`trustTier='auto'`, `changeReason='create'`,
  `previousVersionId=null`) — зеркало merge-ветки. Fallback (kill-switch `docCompilerEnabled`
  OFF / ошибка LLM / пусто) → legacy сырой `draft.statement`, `CardVersion` не создаётся.
  best-effort: компиляция не валит создание карточки.
- **Ф2 `cf0f5c29` (backend, новый `backend/scripts/backfill-compile-flat-cards.ts`)** —
  разовый идемпотентный бэкфилл: находит ПЛОСКИЕ карточки (тело без `## ` и без
  markdown-таблицы), пересобирает компилятором + `CardVersion` (`changeReason='backfill'`).
  Идемпотентность: предикат пропускает структурные + write-гейт (ok + непустое + изменилось
  + структурно) → повтор = 0. Зарегистрирован в `apply-prod-deploy.ts` STEPS
  (`phase:'backfill'`, `skipBootstrap`).
- **Ф3 `616d0536` (backend, `regulation-extract.prompt.ts`)** — в SYSTEM добавлена
  строка-граница regulation↔policy: регламент = ПОРЯДОК по шагам, политика = ПРИНЦИП без
  процедуры (cache-friendly: одна стабильная строка в SYSTEM).
- **Ф6 `513b4321` (backend, `document.adapter.ts`)** — ручная загрузка: чистая функция
  `docTypeToSignalTypeHint` (`docType→signalTypeHint`): regulation→regulation,
  policy→regulation (policy НЕ отдельный signalType в enum → идёт через regulation, экстрактор
  даёт `kind=policy` → `upsertPolicy`), process/instruction→process_step, прочее→undefined.
  Документ детерминированно доезжает до Specialist 3.1, а не зависит от классификатора.
- **Ф4 `2107a792` (frontend, `RegulationsListClient.tsx` + `nav-config.ts`)** — меню
  «Оцифровано» → «База знаний»; заголовок «База знаний компании»; фильтры
  «Регламенты / Процессы / Инструкции / Политики» («Стандарт» — метка внутри регламента, не
  фильтр); счётчики «В базе: Тип: N», заголовок списка «Найдено: N» (снят рассинхрон
  «9 политик / Всего 1»).
- **Ф5a `b976ded2` (backend)** — новый kill-switch `knowledge_base.redesign.enabled` (тип
  «аварийный рубильник», ON). Бэк читает `getDynamic` в `getSummary` → аддитивное поле
  `redesignEnabled` в `GET /regulations/summary`. Seed
  `seed-admin-setting-knowledge-base-redesign.ts` + STEPS + реестр схемы + `feature-flags.md`
  + фронтовый api-тип / domain-маппер.
- **Ф5b `28b6217e` (frontend, `RegulationsListClient.tsx`)** — новая раскладка за флагом
  (дефолт ON) на modern-токенах (`MODERN_PAGE_BG` / `glass()`): левое дерево-папки по типам
  (Вся база + 4 типа со счётчиками + «Шаблоны процессов» сведены в дерево БЕЗ верхней вкладки
  + «Загрузить вручную»→`/documents`), центральная читаемая колонка с тумблером
  «Чтение / Широкий» (max-width 720 / 980), правый TOC из `## ` заголовков. Старая
  master-detail — аварийный fallback (`redesignEnabled=false`). Только theme-aware токены
  (`var(--*)`) → светлая тема флипается автоматически.

Диапазон `6e98d3a8..28b6217e` содержит ещё 2 коммита (`13b0a4bd` / `fb74b34f` — чистка
технических полей из карточек курации) — это **не моя** работа, попали в диапазон от
параллельной сессии.

## Что вышло (верификация)

Все 6 фаз реализованы. По затронутым frontend / backend `bun run typecheck && bun run lint
&& bun run build` — зелёные. Юнит-тесты (`bunx vitest run`) затронутых spec зелёные:
- specialist spec — 2/2;
- document-signal-type-hint — 8/8 (маппинг `docType→signalTypeHint`);
- regulations.service spec — 17/17.

`backfill-compile-flat-cards.ts` **полным прогоном локально не запускался** — неполный
локальный `.env` для подъёма AppModule (`WEBHOOK_SECRETS_ENCRYPTION_KEY` и др.); pre-check
на реальных dev-данных отработал. Светлая тема — структурно theme-aware (`var(--*)`), но
**живая визуальная проверка в обеих темах не делалась** (нужен запуск приложения) — follow-up
в прод-smoke Шаг 12.

## Чему научился / ловушки

1. **РАССИНХРОН `SIGNAL_TYPE_VALUES` ↔ Prisma enum `SignalType`.** Массив-валидатор в
   `block-ingest.prompt.ts` содержит `'policy'`, которого **НЕТ** в enum `SignalType`
   (`schema.prisma`). `tryGetSignalTypeHint` валидирует по массиву → `'policy'` прошёл бы
   проверку, но запись в `ideaBlock.signalType='policy'` упала бы рантайм-ошибкой enum.
   Латентный баг ВНЕ scope этой фичи (block-ingest LLM может вернуть `signalType='policy'`,
   т.к. промпт показывает его как валидный). Именно из-за этого Ф6 маппит
   `docType 'policy' → 'regulation'`, а не `'policy'`. **Нужно вынести строкой «Открыто» в
   реестр `second-brain/04_не-сделано/README.md`, когда файл освободит параллельная сессия**
   (сейчас он `M` — занят).
2. **`signalType='regulation'|'process_step'` оба роутятся в Specialist 3.1**
   (`router.service.ts`); финальный тип карточки решает экстрактор по `draft.kind`. То есть
   `signalTypeHint` лишь **гарантирует доставку** блока к экстрактору, но НЕ фиксирует тип
   карточки жёстко — politика доезжает через `regulation`-сигнал и становится политикой по
   `kind` экстрактора.
3. **Kill-switch фронта = бэк кладёт boolean в DTO, который страница и так грузит.** Не нужен
   отдельный эндпоинт под флаг раскладки: `redesignEnabled` подвешен в существующий
   `GET /regulations/summary` (прецедент `main_rework` / `dashboard_rework`). Дешевле и без
   лишнего round-trip.
4. **Компилятор на create — это не «новый код», а перенос готовой merge-логики в ветку
   `new`.** Снимок `CardVersion` v1 пишется той же транзакцией, что и карточка — зеркало
   merge-пути; instruction был единственным типом, где компилятор вообще отсутствовал.

## Что осталось

- Строка про рассинхрон `SIGNAL_TYPE_VALUES` ↔ enum `SignalType` в
  `second-brain/04_не-сделано/README.md` — **отложено**: файл занят параллельной сессией
  (`M`), добавит владелец / следующая сессия, когда освободится.
- Полный прогон `backfill-compile-flat-cards.ts` на dev/prod-данных (локально не поднялся
  AppModule из-за неполного `.env`).
- Живая визуальная приёмка раскладки «База знаний» в светлой и тёмной теме (нужен запуск
  приложения) — прод-smoke Шаг 12.

## Прод-команды

`docker compose up -d --build backend frontend`. Новый seed
`seed-admin-setting-knowledge-base-redesign.ts` + бэкфилл `backfill-compile-flat-cards.ts` —
через агрегатор `apply-prod-deploy.ts` (бэкфилл в `phase:'backfill'`, `skipBootstrap`).
Миграций БД нет (поля/модели уже в схеме). Новый kill-switch
`knowledge_base.redesign.enabled` (ON) — строка в `docs/operations/feature-flags.md`. Полная
актуальная инструкция — `docs/operations/prod-deploy-log.md`.
