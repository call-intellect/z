---
title: Исправление багов кабинета по итогам QA от 2026-06-15
type: tz
status: ready-to-implement
date: 2026-06-15
owner: Сергей (sergrv80@gmail.com)
qa_report: plans/analysis/2026-06-15-qa-cabinet-full-test-bugs.md
relates_to:
  - frontend/src/ui/tour/TourBackdrop.tsx
  - frontend/src/ui/tour/tours/welcome.ts
  - frontend/src/api/structure.api.ts
  - frontend/app/(authenticated)/me/MeClient.tsx
  - frontend/app/(authenticated)/actions/ActionsClient.tsx
  - backend/src/modules/dashboard/services/director-dashboard.service.ts
  - backend/src/modules/dashboard/services/chat-v2-feedback.service.ts
  - frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx
prior_tz:
  - plans/tz/2026-06-10-intake-project-picker-and-triage-calibration.md  # пикер проекта на /intake (НЕ /actions)
---

# ТЗ. Исправление багов кабинета (QA 2026-06-15)

## Контекст

Полный QA-обход прод-кабинета `korateam.ru` (Playwright + чтение прод-логов diag.ts) под двумя аккаунтами выявил набор багов. Каждый ниже **воспроизведён в проде** и **доказан корнем в коде** (file:line прочитаны с обеих сторон контракта). Полный отчёт о тесте — `plans/analysis/2026-06-15-qa-cabinet-full-test-bugs.md`.

Английские термины: **backdrop** — затемняющий оверлей; **pointer-events** — CSS-свойство «ловит ли элемент клики»; **enum** — перечислимое значение; **jsonb** — бинарный JSON в PostgreSQL; **intake** — входящий кандидат до разбора; **triage** — разбор кандидата (принять/отклонить).

## Порядок фаз (по приоритету)

1. **[x] Ф1 — Тур разблокирует кабинет** (🔴) — РЕАЛИЗОВАНО (commit Ф1).
2. **[x] Ф2 — Должность видна в «Я»** (🔴) — РЕАЛИЗОВАНО (commit Ф2). Вскрыт доп. дефект карты должности → `plans/tz/2026-06-15-me-role-map-card-contract.md`.
3. **[x] Ф3 — «В задачи» из очереди работает** (🔴) — РЕАЛИЗОВАНО (commit Ф3), но **с другим дизайном** (см. ниже): вместо пикера — дефолт-проект «Входящие» (решение владельца). Перенос задачи в другой проект → `plans/archive/2026-06-15-issue-move-to-project.md`.
4. **[x] Ф4 — Главная не падает (valueStrip SQL)** (🔴) — РЕАЛИЗОВАНО (commit Ф4).
5. **[x] Ф5 — Чеклист онбординга видит реальные данные** (🟠) — РЕАЛИЗОВАНО (commit Ф5).
6. **[x] Ф6 — Локализация UI (только русский)** (🟡) — РЕАЛИЗОВАНО частично (frontend-рендер: team-templates/неделя/интеграции/тема). Sales-отчёт (interest_level/Follow-up/Discovery→Demo) и описание прод-проекта MTG — LLM-вывод/стале-данные, вынесены к калибровке (см. Ф7-класс).
7. **[ ] Ф7 — Интент: вопросы сотрудников ≠ обещания** (🟡) — ВЫНЕСЕНО отдельным ТЗ `plans/archive/2026-06-15-intent-questions-are-not-commitments.md` (калибровка LLM, не строчный баг).

> **Изменение дизайна Ф3 (решение владельца в ходе работы):** не заставлять выбирать проект (пикер — «усложнение»); accept без проекта кладёт задачу в общую папку «Входящие» (тот же per-tenant проект, что использует авто-приём входящих), ошибка `target_project_required` больше не возникает. Перенос задачи в другой проект — отдельный ТЗ (обещанная владельцем возможность «сменить проект потом вручную»).

---

## Ф1 — Онбординг-тур разблокирует кабинет

### Корень (доказано)
- **Backdrop перехватывает все клики:** `frontend/src/ui/tour/TourBackdrop.tsx:21-29` — `<div aria-hidden onClick={onClick} className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px]" />`. Намеренно без `pointer-events-none` (комментарий стр. 12-14). Пока тур открыт — нельзя нажать ничего на странице («В задачи», «Выбрать должность»). Подтверждено Playwright: `<div aria-hidden> intercepts pointer events`.
- **«Пропустить» листает, а не закрывает:** `frontend/src/ui/tour/tours/welcome.ts` — у шагов 1–5 `secondaryAction: { label: 'Пропустить', kind: 'next' }` (стр. 21,31,41,51,61). Обработчик `TourOverlay.tsx` `case 'next' → next()`, а реальное завершение `case 'skip' → skip()` (персист `skipped:true`) зовётся только из Escape.
- **Тур всплывает каждый раз:** `TourProvider.tsx` `isTourDone()` считает тур закрытым только при `completedAt` или `skipped`. Т.к. «Пропустить»=next ничего не персистит → при следующей загрузке тур стартует снова.

### Решение
1. `TourBackdrop.tsx:26` — добавить `pointer-events-none` в className (и убрать неиспользуемый `onClick`-проп, его в `TourOverlay` не передают). Backdrop остаётся визуально (затемнение/blur), но не блокирует клики; tooltip и подсвеченный target (z-70) кликабельны. Это соответствует заявленному «неблокирующему» туру.
2. `welcome.ts` — у шагов 1–5 заменить `kind: 'next'` → `kind: 'skip'` для кнопки «Пропустить». Это и закроет тур, и персистнёт `skipped:true` → повторно не всплывёт (фикс симптомов 2 и 3 одной правкой).

### Файлы
`frontend/src/ui/tour/TourBackdrop.tsx`, `frontend/src/ui/tour/tours/welcome.ts`.

### Acceptance
- Playwright: при открытом туре клик по кнопке вне тура (напр. пункт меню) срабатывает.
- Клик «Пропустить» на шаге 1 → тур закрывается полностью; перезагрузка страницы → тур НЕ появляется (PATCH `tour-progress` содержит `skipped:true`).
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.

---

## Ф2 — Должность отображается в разделе «Я»

### Корень (доказано)
Рассинхрон контракта `/me/profile` (нет domain-маппера, тип лжёт компилятору → `undefined` в рантайме):
- **Backend отдаёт** (`backend/src/modules/me/me.service.ts:87-101`): `primaryRole {id,name}|null`, `primaryDepartment {id,name}|null`, `person {id, name, email}`.
- **Frontend ждёт** (`frontend/src/api/structure.api.ts:213-218`, `MyProfileApi`): `role`, `department`, `person.fullName` — **этих полей в ответе нет** → всегда `undefined`.
- **Выстреливает на /me** (`frontend/app/(authenticated)/me/MeClient.tsx`):
  - `:115` `needPosition = … profile?.role == null` → всегда true → баннер «укажите должность» всегда виден;
  - `:124` `profile?.person?.fullName` → undefined → имя не показывается;
  - `:127` `profile?.role?.name, profile?.department?.name` → пустой подзаголовок;
  - шапка «Должность не назначена» и карточка «Назначьте себе должность» (`MyPositionCard.tsx:77`, `currentRole={profile.role}`).
- Доказано на проде: API владельца `primaryRole.name="CEO"`, таблица «Команда» = «CEO», а раздел «Я» = «Должность не назначена».

### Решение (минимальный, по канону «выровнять контракт по факту»)
1. `frontend/src/api/structure.api.ts:213-218` — привести `MyProfileApi` к фактическому ответу:
   - `role` → `primaryRole`, `department` → `primaryDepartment`;
   - `person` → тип `{ id: string; name: string; email: string | null }` (а не `PersonDomainApi` с `fullName`).
2. Поправить читателей под новые имена: `MeClient.tsx:115,124,127,264-265` (`primaryRole`/`primaryDepartment`/`person.name`), `MyPositionCard.tsx:77` (+ тип в `:103`).

### Файлы
`frontend/src/api/structure.api.ts`, `frontend/app/(authenticated)/me/MeClient.tsx`, `frontend/app/(authenticated)/me/MyPositionCard.tsx` (+ возможные другие читатели `MyProfileApi.role`/`.department` — найти по типу).

### Acceptance
- Под аккаунтом с назначенной должностью раздел «Я»: показывает должность, имя в шапке, нет баннера «укажите должность».
- Под аккаунтом без должности — баннер остаётся (регресс-проверка).
- Проверить на проде у `svmazur` (CEO), `chydo_002` (менеджер техподдержки), `ainaz860707` (руководитель отдела внедрения).
- typecheck/lint/build зелёные.

---

## Ф3 — «В задачи» из очереди «Подтверждения» работает

### Корень (доказано)
- **Backend** (`backend/src/modules/tracker/services/intake.service.ts:520-534`): при `decision='accept'` требует `targetProjectId ?? intake.projectId ?? intake.suggestedProjectId`; если все null → `400 target_project_required`. `issues.create(targetProjectId, …)` (`:543`) требует реальный проект — дефолтного проекта в модели нет. `suggestedProjectId` заполняется только слабой эвристикой по идентификатору в названии встречи (`meeting-extract-actions.service.ts:432-452`), для обычных встреч = null.
- **Frontend /actions** (`frontend/app/(authenticated)/actions/ActionsClient.tsx`): `IntakeCard` не имеет пикера проекта; `handleConfirm` (`:510-521`) и тип `CardProps.onConfirm` (`:94-106`) **не несут `targetProjectId`** → шлётся `{source:'intake', resourceId, resolution:'accept'}` без проекта → 400.
- **Тост вводит в заблуждение** (`ActionsClient.tsx:516`): `catch { toast.error('Не удалось — возможно, уже решено. Обновите страницу.') }` — игнорирует реальный `message` сервера («Не указан проект…»).
- Контраст: на экране `/intake` (`IntakeClient.tsx:690-776`) пикер проекта `ProjectPickerDialog` УЖЕ есть и accept шлёт `targetProjectId` корректно. То есть бэк и DTO (`pending-actions.dto.ts:87`) полностью готовы принять проект — на `/actions` просто нет UI.
- В прод-логах `target_project_required` повторяется десятки раз (8:45–9:36).

### Решение (лучшее — переиспользовать существующий пикер)
1. На `/actions` для карточки «Кандидаты в задачи» при клике «В задачи»:
   - если проект кандидата известен (`suggestedProjectId`) — слать его сразу;
   - иначе — открыть пикер проекта (переиспользовать `ProjectPickerDialog` из `/intake`, не дублировать; вынести в общий `src/ui/tracker/` если нужно) и слать выбранный `targetProjectId`.
2. Прокинуть `targetProjectId` через тип `CardProps.onConfirm` (`ActionsClient.tsx:94-106`) и `handleConfirm` → хук → API (хук и backend-DTO уже принимают поле).
3. Расширить `IntakeDetailApi` (`pending-actions.api.ts:71-80`) и провайдер (`intake.provider.ts:96-106`) полями `suggestedProjectId/suggestedProjectName`, чтобы показать предложенный проект.
4. Тост: в `catch` доставать `message` из ошибки api-client (показывать реальную причину), фоллбек — текущий текст.

> Координация с `plans/tz/2026-06-10-intake-project-picker-and-triage-calibration.md`: то ТЗ добавляет «+ Создать проект» в пикер на `/intake`. Здесь — тот же пикер на `/actions`. Реализовать на общем компоненте, чтобы «создать проект» появилось в обоих местах.

### Acceptance
- Playwright на проде: «В задачи» → выбор проекта → задача создаётся (POST confirm 200), карточка уходит из очереди, задача видна в выбранном проекте.
- Принудительный 400 (если возникнет) показывает реальный текст ошибки, а не «возможно уже решено».
- В прод-логах перестаёт расти счётчик `target_project_required`.
- typecheck/lint/build (frontend+backend) зелёные.

---

## Ф4 — Главная «Сегодня»: виджет valueStrip не падает

### Корень (доказано)
`backend/src/modules/dashboard/services/director-dashboard.service.ts:880-890` — `$queryRaw` счётчика «ответов памятью»:
```sql
... AND m."citations" IS NOT NULL
    AND jsonb_typeof(m."citations") = 'array'   -- :888 guard
    AND jsonb_array_length(m."citations") > 0   -- :889 падает: 22023 cannot get array length of a scalar
```
`ChatV2Message.citations` — `Json?` (`prisma/schema.prisma:1946`), не гарантированно массив. Guard `jsonb_typeof = 'array'` стоит, но PostgreSQL **не гарантирует порядок вычисления предикатов `AND` в WHERE** — на части планов `jsonb_array_length` вычисляется до guard на строке-скаляре → ошибка `22023`. Виджет в per-widget try/catch (`:144-151`), поэтому валит не весь дашборд, а пишет ERROR (в прод-логах повтор 8:49/8:52/9:39 для tenant Ооо луа). Тот же незащищённый паттерн — `chat-v2-feedback.service.ts:191-194` (`getChatUsageStats`).

### Решение
Заменить раздельные guard-предикаты на единое `CASE`, где `jsonb_array_length` вызывается только в ветке гарантированного массива (внутри `CASE` порядок детерминирован):
```sql
AND CASE
      WHEN jsonb_typeof(m."citations") = 'array'
      THEN jsonb_array_length(m."citations") > 0
      ELSE false
    END
```
`COALESCE` не спасает (проблема не в NULL, а в вызове функции на не-NULL скаляре). Применить в **обоих** местах (director-dashboard.service.ts:880-890 и chat-v2-feedback.service.ts:191-194) — чинит весь класс.

### Доп. проверка при реализации
- На проде: `SELECT DISTINCT jsonb_typeof(citations) FROM "ChatV2Message"` — подтвердить, какой не-массив пишется (и при необходимости поправить запись citations на стороне ChatV2, чтобы туда всегда шёл массив/`[]`).
- Сверить, что прод-сборка содержит ту же ревизию строки 888 (маловероятная альтернатива — guard добавлен позже, а прод отстаёт).

### Acceptance
- Виджет «Польза за период»/valueStrip считается без ошибок для tenant Ооо луа (period=week/month).
- В прод-логах исчезает `DirectorDashboardService valueStrip fail … 22023`.
- backend typecheck/lint/build зелёные; точечный тест метода `fetchValueStrip`.

---

## Ф5 — Чеклист онбординга «Настройка компании» видит реальные данные

### Корень (доказано)
`frontend/app/(authenticated)/dashboard/DirectorDashboardClient.tsx:222-244` — прогресс «0 из 6» считается по **timestamp-вехам Org** (`welcomeCompletedAt`, `departmentsCompletedAt`, `rolesCompletedAt`, `teamInvitedAt`, `firstMeetingCreatedAt`…), а не по факту существования сущностей. Создание отделов/должностей вне мастера (через /structure или импорт) не штампует эти `*CompletedAt`, поэтому при реально существующих 2 отделах и 3 ролях счётчик = 0/6. Это и держит онбординг-тур (Ф1) и баннеры активными.

### Решение
Считать веху выполненной по принципу «timestamp ИЛИ факт»: например `departmentsCompletedAt != null || count(Department) > 0`, аналогично для ролей/команды/встреч. Реализация — на бэке (модуль `orgs`/onboarding-progress эндпоинт), чтобы фронт получал корректный прогресс. Альтернатива: штамповать вехи при создании сущностей вне мастера (более инвазивно).

### Acceptance
- Для Org с существующими отделами/должностями чеклист показывает их как выполненные (≥2 из 6 у Ооо луа).
- typecheck/lint/build зелёные.

---

## Ф6 — Локализация UI (только русский)

### Корень (наблюдения, нарушение правила «весь UI на русском»)
Сырые enum/англ-термины протекают в UI (в скобках — где локализовано правильно как образец):
- статус идеи `captured` на /week (на /ideas корректно «Зафиксирована»);
- тип сигнала `problem` на /week (на /insights корректно «Проблема»);
- категории шаблонов `COMMERCIAL/MANAGEMENT/OPERATIONS/PEOPLE/TECHNOLOGY` на /team-templates;
- `Wizard за 4 шага`, `GENERIC WEBHOOK` на /settings/integrations;
- «Тема `dark`» в меню аккаунта;
- AI-отчёт «Продажи»: `high` (уровень интереса), `Follow-up письмо`, `Discovery → Demo`;
- описание проекта MTG: «… `legacy` задач … (`action items`)».

### Решение
Найти и применить единые словари локализации enum (idea status, signal type, team category, integration type, theme) — переиспользовать уже существующие мапперы (например тот, что даёт «Зафиксирована»/«Проблема» на /ideas и /insights). Для AI-отчёта продаж — локализовать ярлыки шаблона (high/Follow-up/Discovery→Demo) в промпте/рендере отчёта. Описание виртуального проекта MTG — перевести.

### Acceptance
- Греп по рендеру разделов не находит перечисленных англ-строк в UI.
- Точечная Playwright-проверка /week, /team-templates, /settings/integrations, отчёта продаж.

---

## Ф7 — Интент: вопросы сотрудников не должны становиться «обещаниями» (отдельная калибровка)

### Корень (симптом, требует анализа промпта)
В очереди Ооо луа «Кандидаты в задачи» = реальные запросы сотрудников «какие у меня задачи?», «какие у меня есть задачи?», «/actions» — классификатор принял вопрос/команду за «обещание поставить задачу». Это деградирует очередь и доверие.

### Решение (требует отдельного разбора — не входит в быстрый багфикс)
Найти классификатор, который создаёт intake-кандидатов «обещание→задача» (extract-actions / commitment-detect), добавить фильтр: вопросы и команды (`/actions`, «какие у меня задачи?») не являются обещаниями. Калибровать на реальных примерах. Рекомендуется вынести в отдельное ТЗ с тестом промпта на ключах (DeepSeek/др.).

### Acceptance
- Тест-набор вопросов/команд не порождает кандидатов в задачи; реальные обещания («сделаю X к пятнице») — порождают.

---

## Сводка доказательной базы

| Фаза | Воспроизведено в проде | Корень в коде | Уверенность |
|---|---|---|---|
| Ф1 тур | Playwright (backdrop intercepts; «Пропустить»→шаг 2) | TourBackdrop.tsx:26, welcome.ts:21-61 | высокая |
| Ф2 должность | API CEO vs UI «не назначена» | structure.api.ts:213-218, MeClient.tsx:115/124/127 | высокая |
| Ф3 «В задачи» | POST confirm 400 target_project_required + лог ×много | intake.service.ts:520-534, ActionsClient.tsx:94-106/510-521 | высокая |
| Ф4 valueStrip | прод-лог 22023 ×3 | director-dashboard.service.ts:880-890 | высокая (тип citations не дочитан на проде) |
| Ф5 чеклист 0/6 | UI «0 из 6» при существующих отделах/ролях | DirectorDashboardClient.tsx:222-244 | высокая |
| Ф6 локализация | Playwright (captured/problem/COMMERCIAL/…) | мапперы enum | высокая |
| Ф7 интент | очередь с вопросами как кандидатами | классификатор (не локализован точно) | средняя |

## Итог
Реализовано: нет (ТЗ). Все корни Ф1–Ф6 доказаны чтением кода с обеих сторон контракта и воспроизведены в проде. Ф7 требует отдельной калибровки промпта. Порядок реализации: Ф1 → Ф2 → Ф3 → Ф4 → Ф5 → Ф6 (→ Ф7 отдельно).
