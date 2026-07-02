---
date: 2026-07-01
title: Чистка соц-слоя обещаний (обещание = факт памяти)
tz: plans/tz/2026-06-29-commitment-social-layer-cleanup.md
distilled: false
---

# Чистка соц-слоя обещаний — обещание свёрнуто в спокойную память

## Что было поставлено
Реализовать ТЗ `2026-06-29-commitment-social-layer-cleanup` (status ready-to-implement):
снять **весь надзорный слой** вокруг обещаний (follow-up-напоминания, эскалации,
promise-cascade, promise-network «перегруз», commitment-reliability «надёжность»,
страница «Мои обещания», секции обещаний в письмах/брифах, дроп надзорных полей схемы),
**сохранив память факта** (кто/кому/что/срок — `commitmentDueDate/Author/Recipient`,
извлечение из всех источников). Модель — прецедент «решение↔задача»: сущность в памяти,
оперконтроль снят. Связь обещание↔цель и механизм «обещание→задача» — вынесены, не трогать.

## Как решал

**Старт — картография, потому что ТЗ устарел.** Владелец предупредил: после написания ТЗ
был крупный рефакторинг кода. Подтвердилось сразу: коммит `d9a6fbdf` (ТЗ
kora-clarify-questions-overhaul) уже снёс ядро Ф1 (promise-keeper/followup-cron/
CommitmentResponseHandler), а combo-рефактор «единый движок задач» переместил/удалил
файлы. Запустил **два картографических workflow** (8 + 3 параллельных read-only агента
через системный `grep`+Read) — сверил весь инвентарь ТЗ с актуальным кодом. Это вскрыло:
probe переехал `operations/services/probe/`→`src/modules/probe/`; межфазную compile-связку
`weekly-per-person.dto`↔`weekly-digest` и `value-recap.ValueRecapTeam`↔`monthly-digest`;
producer me-daily-value = `my-weekly-per-person.controller` (не my-daily-value); 4 dashboard-
агента читают `commitmentStatus` (не в ТЗ); эмиттер `broken_promises` = `burnout-risk-detector.cron`.

**6 фаз, строго последовательно, через write-disjoint суб-агентов.** На каждой фазе:
картография анкеров → 1-N кодеров на непересекающиеся файлы (параллельно) → приёмочная
лестница САМ (git status → системный grep → re-Read границ → typecheck+build+lint+vitest) →
коммит. Зелёный baseline снят до правок.

- **Ф1** (`1fc2797a`): добиты остатки follow-up — router `case 'commitment_status'`, кластер
  метрик β-8.2, llm `commitment-extract-status`, knob `COMMITMENT_MAX_RETRIES`, probe-ассерты.
- **Ф2** (`e4fb25cd`): promise-cascade целиком (3 файла + метрика + крутилка + seed + flag).
- **Ф3** (`7d62bce2`): promise-network back+front (сервис/cron/dto/endpoint + виджет/domain/api).
- **Ф4** (`0f711a28`): весь reliability-слой. **Решение-развилка:** межфазная compile-связка
  сделала «всю надёжность» неделимой → свернул weekly/monthly-digest reliability в Ф4
  (иначе Ф4 не зелёная). 2 backend-кодера (dashboard+persons / operations) + 2 front-кодера.
- **Ф5** (`4ec4f568`): «Мои обещания» + commitments.service split (→ `SelfPersonResolverService`)
  + эндпоинты + daily-digest/personal-brief. 4 backend-кодера (split поймал под-scope:
  dto/cron/prompt брифа — добил F5-C2) + 2 front-кодера.
- **Ф6** (`f3452930`): схема (дроп 3 полей + 2 индекса + модель `PromiseNetworkSnapshot`,
  миграция `20260701000000`) + код-под-миграцию. **Решение:** 4 dashboard-агента (goal-vector/
  forecaster/hr-recommender/engagement-scorer) читали `commitmentStatus` — по В3 (статус мёртв
  без надзирателя) их чтения degenerate → убрал (engagement-веса перебалансированы 0.2→
  пропорционально, author-coverage в goal-vector сохранён, маршрут commitment→GOALS не тронут).
- **Добивки** (`160b7d23`, `33a98085`): финальный греп вскрыл пропуски Ф4/Ф5 во фронте
  (daily/weekly-digest клиенты + copy «Кто держит слово»/«обещания» в hero/nav/registry) и
  осиротевший seed-маршрут `commitment-extract-status`.

## Что вышло
- **8 коммитов**, все фазы зелёные: typecheck 0, build 0, lint 0 errors, vitest (170+538+268
  backend по фазам, 7+31 frontend). Frontend `next build` зелёный.
- **Соц-слой удалён полностью**: финальный греп по 30+ токенам надзора → **0** в backend/src +
  frontend. **Граница факта цела**: `commitmentDueDate/Author/Recipient`, `signalCounters.commitment`,
  `commitmentsExtracted`, `setCommitmentAuthorCoverageRatio`, blocker-synthesis, knows-who,
  `commitment-extract-dates`, `commitmentAuthorAttributionEnabled`, `COMMITMENT_FALLBACK_DUE_WORKDAYS`,
  enum `commitment_status`/`resolves` (осиротевшими, В4).
- Миграция авторизована вручную (точные имена объектов из `0_init`), `prisma validate` ✓,
  `prisma generate` ✓, typecheck против нового клиента ✓. Локально не применялась (dev-БД дрифт +
  DROP-TABLE-хук) — на прод через `migrate deploy`.

## Чему научился
1. **ТЗ, написанный до крупного рефакторинга, нельзя брать на веру — пересверять весь инвентарь.**
   Картографические workflow окупились: нашли d9a6fbdf-предчистку, переезд probe, 4 лишних агента,
   неверный producer me-daily-value, межфазные связки. Без этого Ф1 «удаляла» уже удалённое,
   а Ф4/Ф5 падали бы на компиляции.
2. **Границы фаз из устаревшего ТЗ могут быть compile-неделимы.** Связка через общий DTO
   (`WeeklyPersonRowDto` потребляет и Ф4-сервис, и Ф5-дайджест) заставила свернуть часть Ф5 в Ф4.
   Проверять cross-service DTO-зависимости ДО фиксации границы фазы.
3. **vexp искажает вывод `rg` в основной сессии** (подменяет токены) — для строковых проверок
   системный `grep`, а **главный гейт удаления ссылок — `typecheck`/`build`** (ловит висячие
   ссылки на удалённый символ; grep может дать ложный 0). Так typecheck поймал `team-health-analyzer.cron`
   (читал удалённое `TeamHealthRowDto.promises`) и связку `SIGNAL_TYPE_VALUES`↔Prisma-enum.
4. **TS-union `SignalType` выводится из `SIGNAL_TYPE_VALUES` и обязан совпадать с Prisma-enum.**
   Кодер убрал `commitment_status` из словарей → `Record<SignalType>` рассинхронился (enum-то
   остаётся по В4). Откатил: осиротевший enum ⇒ его словари/типы тоже остаются. ТЗ-acceptance
   (camelCase `commitmentStatus`=0) это не требовал — snake `commitment_status` оставлен.
5. **Prisma migrate dev нужна чистая БД.** Dev-БД дрифт (следы `db push`) + DROP-TABLE-хук →
   `migrate dev` хотел reset. Решение: авторизовать миграцию вручную из имён объектов,
   проверенных в `0_init`; `prisma generate` (без БД) + typecheck доказывают консистентность кода;
   прод применяет через `migrate deploy`.
6. **Frontend compile-разъединён с backend** — typecheck НЕ ловит, что фронт рендерит уже
   не-присылаемые backend-данные (runtime, не compile). После backend-чистки ОБЯЗАТЕЛЬНО греп
   фронта по удалённым токенам/копирайту — иначе остаются мёртвые секции (daily/weekly-digest
   клиенты, «Кто держит слово» в hero/nav) и риск `undefined.map` (мёртвый api-тип `overdueCommitments`).

## Осталось (вынесено, не сделано — реестр 04_не-сделано)
- **Обещание↔цель** (маршрут commitment→GOALS) — отдельный анализ, остаётся открытым.
- **Обещание→задача себе** (роутинг/worker/quality-gate/дедуп/промпты) — отдельное ТЗ, открыто.
- Между этапами обещание = «голый факт» в памяти/поиске (из дашбордов убрано, в задачу ещё не идёт) —
  «провал» принят владельцем осознанно.
