---
date: 2026-07-03
tema: Единый drill-down + provenance parity (universal-entity-drilldown-provenance-parity)
distilled: false
---

# Единый drill-down по всем сущностям + паритет провенанса

## Что было поставлено
Довести до единого правила «проваливание к первоисточнику»: любой элемент кабинета (задача из встречи, цель, блокер, риск, insight, идея-кластер, конфликт) должен либо вести к своему первоисточнику, либо не иметь аффорданса вовсе — «мёртвых кнопок» быть не должно.

Инвариант фичи: **элемент кликабелен ⇔ за ним есть непустой резолвимый первоисточник, доступный зрителю.** Нет источника или закрыт правами → аффорданса нет по построению.

## Как решал (Ф0–Ф5)
- **Ф0 (frontend, `55c3f8a9`):** задача из встречи в виджете журнала (`MeetingsJournalReal.tsx`) и на вкладке результата (`MeetingResultPageReal.tsx`) — строка проваливается на `/issues/:id` паттерном stretched-link (оверлей-`Link` + кнопка-кружок `z-10`), кружок отмечает выполнено (`transitionToCategory`, оптимистично).
- **Ф1 (backend, `ebf1fc2c`, `provenance.service.ts`):** `ProvenanceEntityType` расширен `goal|insight|friction`; `collectSourceBlockIds` читает `Goal/Insight/EntityLink.sourceBlockIds`. Двухуровневая маскировка конфликта (`maskFrictionByRole`) поверх `partitionProjectionsByAccess`: роль вне `provenance.frictionVerbatimRoles` (AdminSetting, code-fallback `['owner','admin']`) → агрегат; owner/admin → дословная цитата + `?t=`. Роль зрителя — из guard через `RbacService.getMembershipRole` (не из тела). Эндпоинт `GET /api/v1/provenance/:entityType/:entityId` принимает новые типы.
- **Ф2 (frontend, `282b5fc1`, `GoalDetailClient.tsx`):** страница цели — ленивый `useProvenance('goal', goalId)` + блок «Откуда» (`ProvenancePreviewSnippet` + `ProvenanceDrawer`); пустой источник → блок не рендерится.
- **Ф3 (frontend, `6019ba22`, дашборд День/Неделя/Месяц):** блокер (`sourceBlockId`→drawer entityType=block), риск/insight (`sourceBlocksCount>0`→entityType=insight), идея-кластер→`/ideas`. `SignalRow` расширен `onClick`/`href` — кликабельность по данным, стрелка только при источнике; счётчики/агрегаты статичны. `DayBlockers/WeekBlockers/MonthBlockers` + `Day/Week/MonthSignalsGrid`.
- **Ф5 (backend, `54f35999`, `provenance.service.ts` `classify`):** RawEvent `meeting_report` теперь резолвится в встречу (снимает префикс `report_`→meetingId, type='meeting') → задачи/решения/идеи отчётной ветки получают рабочий `/meetings/:id/result?t=<sec>` вместо сломанного `/chats/report_<id>`. Единый корень для всей отчётной ветки.
- **Ф4 (frontend+backend, `5472462a`):** конфликт person↔person на дашборде кликабелен → `ProvenanceDrawer` entityType=friction (id=`EntityLink.id`); двухуровневость приходит с бэка. Список конфликтов дашборда (`getTeamFrictions`) НЕ отдаёт `sourceBlockIds` наружу (anti-leak) — добавлен регресс-тест. Контроллер-тест: роль из guard.

## Что вышло
- Все зелёные: `provenance.service.spec.ts` (47), `provenance.controller.spec.ts` (6), `operations-dashboard.friction-leak.spec.ts` (1). Backend + frontend build зелёные. Миграций нет.
- 6 коммитов на ветке `work/2026-07-02`.

## Чему научился
1. **Якорь ТЗ устарел — верить карте кода, не букве.** Ф5 указывал корень в `:387 evidenceBlockIds:[]`, но этот код оказался про *главы*, а не про задачи; реальная поломка deep-link жила в `classify` (`meeting_report`→chat). Нашли Explore-картографией пути, а не по строке ТЗ. Урок: при расхождении якоря с реальностью — картографировать поток, а не чинить указанную строку.
2. **На этой Mac Prisma-клиент устаревает → ложная typecheck-ошибка в chatbox** (не связана с фичей). Лечится `bun run prisma:generate` — не гнаться за «регрессией», сначала перегенерить клиент.
3. **Anti-leak может быть уже соблюдён структурно.** Конфликт дашборда (Ф4) не тёк, потому что DTO `getTeamFrictions` изначально без `sourceBlockIds` — добавили только регресс-тест, чтобы будущая правка DTO не пробила инвариант. Проверять фактический контракт до того, как «чинить утечку».
4. **Drill — свойство данных, не типа.** Обобщение `resolve` на `goal|insight|friction` показало: кликабельность правильно вешать на наличие непустого резолвимого `sourceBlockIds`, а не на whitelist типов — тогда «мёртвых кнопок» нет по построению.

## Что осталось
Хвостов нет: фича завершена, тесты и сборки зелёные, миграций/prod-операций нет.

## Прод-команды
Не нужны — только backend/frontend-код, без миграций/seed/ENV/очередей. AdminSetting `provenance.frictionVerbatimRoles` работает на code-fallback `['owner','admin']` (Ship-On), сид не блокирует выкат.
