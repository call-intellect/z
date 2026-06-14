---
title: Мастер-фиксы кабинета — доводка редизайна + рефералка + хаб «Оцифровано»
date: 2026-06-14
type: реализация
tz: plans/tz/2026-06-14-cabinet-master-fixes-referral-and-hub.md
branch: feature/cabinet-master-fixes
distilled: false
---

# Мастер-фиксы кабинета (A/B/C) — реализация единого ТЗ

## Что было поставлено
Единое мастер-ТЗ `2026-06-14-cabinet-master-fixes-referral-and-hub.md` из трёх частей:
- **A (A1–A11)** — доводка редизайна Ф0–Ф10: системный дефект светлой темы + ~8 «делаемых сейчас» долгов + тех-огрехи (merge-FK, env.schema).
- **B (B1–B12)** — рефералка: вернуть кабинет в меню + persistent role-баннер с живым «N из 3» + редизайн кабинета на modern/.
- **C (C1–C5)** — видимый хаб «Оцифровано»: поднять спрятанный `/regulations`, 4 типа + вкладка шаблонов + провенанс-цитаты + счётчик на Сегодня + долг Instruction.

## Как решал
**Оркестрация суб-агентами по 7 волнам** (картография → промпт кодеру → независимая приёмка → ревью → коммит по волне).

1. **Картография** (12 read-only агентов, Workflow): верифицировал ВСЕ `file:line` ТЗ — большинство устарели. Ключевые расхождения, изменившие план:
   - Светлая тема УЖЕ сделана (Ф10); A1 — это доводка **белых оверлеев** `oklch(1 0 0 /…)`, а не перевод токенов. Реальных «47× CHART-как-текст» почти нет (уже `var(--text-*)`); 80 белых оверлеев в 29 файлах — вот корень.
   - A6: `commitmentAuthorPersonId` для вопросов всегда NULL (commitment-only) → авторство резолвится через `IdeaBlockEntity(role='subject')→Person`.
   - A4: реальный корень «двойного учёта» — snooze-рассинхрон (`/actions` пишет `PendingActionSnooze`, `intake.service.findAll` про него не знал).
   - A11.1: `Task` без `cycleId`; `Issue` без `assigneeUserId` (через `IssueAssignee` M:M), без `status` (через `completedAt`).
   - A7: `RequiresActionTile` — мёртвый импорт.

2. **Волна 1** (`dfb79211`, `38ff9fd8`): A1-core (токены `--surface-inset/-strong/-hover`+`--border-inset` обе темы; 7 modern-примитивов; гард `light-theme.guard.spec`) + A1-sweep (24 файла кабинета, 0 остатков) + A3 (оживлён kill-switch `DASHBOARD_THEME_SILENCE_ENABLED`+`_WEEKS`+`USE_APPOINTMENT_FOR_PERSON_ROLES` в `KnowledgeCoreSchema` без нового `.merge`) + A5 (ack чек-ина) + A6 (askedByManager).
3. **Волна 2** (`b5f27129`): B1–B4 — пункт «Партнёрка», `reward-progress` (target через `SeatService.calculateMonthlyPriceKopecks(0)`), persistent `ReferralRewardBanner`, удалён `ReferralPromoStrip`.
4. **Волна 3** (`1438db58`): B5–B12 редизайн кабинета на modern/ (3 параллельных кодера, логика/ИНН-гейт/маскирование не тронуты).
5. **Волна 4** (`b5f1f2bf`): A4 (snooze-зеркало) + A7 (cross-surface тест + valueStrip Link) + A8 (StaleQuestionsWidget /week) + A9 (CSV-экспорт планёрки).
6. **Волна 5** (`0a37b1d3`): A2 (merge переносит Metric/Interaction/OrgUnit/Entity, обход @unique) + A10 (миграция `IntakeIssue.sourceBlockIds` + петля next-step→Issue→`DecisionTaskLink('derived')`).
7. **Волна 6** (`186a165f`): C1–C4 хаб (пункт «Оцифровано», вкладка шаблонов, `?kind=`, `/policies`-redirect, эндпоинты `/:id/sources` и `/summary`, провенанс-аккордеон, виджеты).
8. **Волна 7** (`fd0e8eeb`): A11.1–A11.5 + C5; A11.6 (консолидация nav) — стаб в `04_не-сделано` (рискованный рефактор, риск закрыт гардом A11.2).

**Каждая волна** проходила лестницу приёмки лично: греп маркеров, re-Read критичной логики, typecheck (вкл. .spec) + lint + build обоих пакетов, профильные тесты, ревью diff на auth/идемпотентность/потерю данных.

## Что вышло (верификация)
- **Frontend:** typecheck чист, lint 0 errors, build ок (все маршруты, вкл. /referrals, /regulations, /policies), полный сьют **535/535** (74 файла; база была 464 — добавлены новые тесты).
- **Backend:** typecheck (`--max-old-space-size=8192`) чист, build ок. Unit-сьют `vitest run src` — **5076 passed / 0 failed** (628 файлов; база была 5053 — выросло за счёт новых тестов). (Голый `bunx vitest run` дал 11 падений — это `test/integration`+`test/e2e`, которым нужны живые сервисы; канон базы — `test:unit` = `vitest run src`.)
- **Гард светлой темы** зелёный; 0 белых оверлеев в кабинете и referrals/.
- **Единственная миграция** (A10) применена к dev-Postgres и согласована с Prisma Client.

## Что НЕ сделано / отложено (честно)
- **A11.6** (свести 3 источника мобильной навигации) — стаб в `04_не-сделано`; рискованный nav-рефактор, расхождение уже закрыто гардом A11.2.
- **C5/долг Instruction** — задокументирован (нет CardVersion-истории/дедупа/триажа); отдельный next-wave-слой, как у A7-компилятора.
- **A3 широкий класс raw `process.env`** — сделан scope ТЗ (3 ENV); Concierge-блок в `typed-config.service`, `orchestrator.config`, `@Cron(process.env…)`-декораторы оставлены (декораторы непереводимы на DI) — отдельная задача.
- **Авто-зачёт реф-выплат в подписку** — вне scope по решению владельца.

## Чему научился
1. **Картография обязательна и окупается** — `file:line` в ТЗ систематически устаревают; 12-агентный read-only проход вскрыл 5+ расхождений, которые изменили реализацию (A1/A4/A6/A7/A11.1). Без него кодеры чинили бы несуществующее.
2. **«Один симптом ≠ один корень»** подтвердилось дважды: A1 «CHART-как-текст» оказался про белые оверлеи; A4 «двойной учёт» — про snooze, а не про подсчёт.
3. **Ловушки модели данных** ловятся только чтением схемы: `Task` без `cycleId`, `Issue` без `assigneeUserId`/`status`, `Department.entityId @unique` (обход source-null→target-set), `commitmentAuthorPersonId` commitment-only.
4. **`bunx vitest run` без пути ≠ `test:unit`** — голый прогон тянет integration/e2e (живые сервисы) и даёт ложные «регрессии». Канон базы — `vitest run src`.
5. **Гард вместо рефактора** — где консолидация рискованна (3 nav-источника), машинный инвариант (`nav-subset.spec ⊆ desktop`) закрывает риск расхождения дешевле и безопаснее, чем переписывание.
