---
type: tz
status: ready-to-implement
feature: session-2026-06-06-tracker-and-meetings
date: 2026-06-06
owner: Сергей (владелец Org «ооо ромашка», sergrv80@gmail.com)
supersedes:
  - plans/tz/2026-06-06-tracker-fixes-and-simplification.md
  - plans/tz/2026-06-06-meeting-join-rejoin-and-share.md
relates_to:
  - plans/analysis/2026-06-06-tracker-ux-audit-and-simplification.md
  - plans/analysis/2026-06-06-meeting-join-link-and-rejoin-gap.md
  - plans/analysis/2026-06-05-manual-qa-RESULTS.md
  - plans/tz/2026-06-05-frontend-detail-pages-and-ui-honesty.md
  - plans/tz/2026-06-05-bonus-access-and-paywall-sync.md
---
> **ЭТО — единое финальное ТЗ по сессии 2026-06-06.** Сюда сведено ВСЁ, что в этой сессии протестировано (живой прогон прода + diag-логи) и проанализировано: раздел **Трекер** и пробел **Встреч** (войти/вернуться/поделиться/пригласить). Бери этот файл и иди писать код.
> Доказательная база (скриншоты потоков, Network/Console, корни в коде) — в анализах из `relates_to`. Два прежних ТЗ (`tracker-fixes-and-simplification`, `meeting-join-rejoin-and-share`) — **поглощены этим файлом** (supersedes), отдельно их не реализовывать.

# Финальное ТЗ — Трекер + Встречи (сессия 2026-06-06)

## Как читать / порядок работы
- **Часть 0** — что уже сделано в ветке `sergdev` (только выкат, НЕ кодить заново).
- **Часть А** — Трекер (фазы A1…A7).
- **Часть Б** — Встречи (фазы B1…B5).
- В конце — единый граф зависимостей/волны, прод-деплой, DoD.
- Номера строк — на 2026-06-06 (ветка `sergdev`); перед правкой перечитывать по якорю-символу. UI конечного пользователя — **только русский**, парные цветовые токены, инварианты Z (CLAUDE.md) не нарушать.

## Вне scope этой сессии (есть отдельные ТЗ — не дублировать)
- **Пэйвол/бонус-доступ** (S1-11: `subscription.status=DEMO` при бонусном тарифе) → `plans/tz/2026-06-05-bonus-access-and-paywall-sync.md`. Здесь НЕ трогаем гейты.
- Прочие области full-audit (дашборды, биллинг и т.п.) — свои ТЗ.

---

# Часть 0 — Уже реализовано в `sergdev` (ТОЛЬКО ВЫКАТ, не кодить)

Прод (`meet.crossmark.ru`) на 2026-06-06 собран из СТАРОГО билда: заголовки «— Z», детальные страницы трекера падают. В `sergdev` это уже починено в **ТЗ-2 `2026-06-05-frontend-detail-pages-and-ui-honesty.md`** (реализовано целиком, 5 коммитов):
- Ф1 — async `params` на 26 детальных страницах (`tables/[id]`, `issues/[id]`, `sprints/[id]`, `roles/[id]`, `persons/[id]`, …) — закрывает S1-01 (таблица/задача/спринт «не открывается»).
- Ф2 — бренд «Кора» вместо «Z» в 66 `metadata.title` — S1-02/S1-10.
- Ф3 — единый «Консьерж» + один плавающий помощник — S1-03/S1-04.
- Ф4 — англицизмы мастера встречи + категория шаблона **«technology»→«Технологии»** (фронт-маппинг) — S4-02/S10-03.
- Ф5 — фидбэк дампа (баннер «Мысль сохранена…» + ссылки) — S1-07.

**Действие 0.1 (deploy):** выкатить `sergdev` на прод (см. «Прод-деплой» ниже). После выката проверить вживую: открыть таблицу/задачу/спринт → рендерятся; `<title>` = «… — Кора»; дамп показывает баннер.
**Действие 0.2 (микро-правка, входит в A5):** в баннере дампа ссылка ведёт на `/intake` («Открыть Входящие»), но дамп идёт в память/Идеи, не во Входящие (подтверждено diag: dump → Document+RawEvent → knowledge-core). Поправить на `/ideas` — `frontend/app/(authenticated)/dump/DumpClient.tsx:118-124`.

> Эти пункты в фазах А/Б **не дублируются** — они здесь как зависимость-деплой.

---

# Часть А — Трекер

## Решения владельца (Трекер)
| # | Решение |
|---|---|
| ТР1 | Единый термин **«Спринт»** везде; «Цикл/Циклы» (UI) → «Спринт/Спринты». Внутренние имена Prisma `Cycle`/`cycleId`/`*ViewEnabled` НЕ трогать. |
| ТР2 | Новая группа меню **«Задачи»** (Проекты · Спринты · Входящие · Архив спринтов); **Дамп**+**Таблицы** → в «Память компании»; **Карточки** → рядом с «Встречи». |
| ТР3 | Развести имена «Входящих»: глобальные `/intake`=«Входящие» (триаж); `/me/inbox`→«Мои задачи»; проектный intake — фильтровать по проекту. «Подтверждения» не трогаем. |
| ТР4 | Подвкладки проекта: на виду Обзор·Доска·Список·Календарь·Спринты·Настройки; остальное под «Ещё ▾». |

## Фаза A1 — «Принять» во Входящих: выбор проекта 🔴
**Корень (живой прогон + diag):** «Принять» шлёт `{decision:'accept'}` без проекта; бэк `intake.service.ts:240-254` требует `targetProjectId ?? intake.projectId ?? suggestedProjectId` → иначе `400 target_project_required` (молча, без тоста). DTO `triage-intake.dto.ts:16-44` **уже принимает `targetProjectId`** → фикс ЧИСТО ФРОНТОВЫЙ.
**Файлы:** `frontend/app/(authenticated)/intake/IntakeClient.tsx:124-129` (`handleAccept`); `frontend/src/api/tracker/intake.api.ts:57-100` (`triage`, `targetProjectId?` уже есть); проектный `frontend/app/(authenticated)/projects/[slug]/intake/*` (`IntakeBoard`, грузит глобальный список без `projectId`); список проектов — `projectsApi.list`.
**Что входит:**
1. Глобальные `/intake`: «Принять» при отсутствии резолвящегося проекта → открыть диалог выбора проекта (список + поиск), затем `triage(..., {decision:'accept', targetProjectId})`. Если проект уже определён — принимать как сейчас, но передавать `targetProjectId` явно.
2. Проектный `/projects/[slug]/intake`: грузить список с фильтром по текущему проекту (резолв `slug→projectId`); «Принять» всегда шлёт `targetProjectId` = id текущего проекта.
3. При 400/ошибке `triage` — тост с `error.message` (не молчать).
**Что НЕ входит:** изменение бэкенда `triage`; `IntakeAutoTriageWorker`.
**Acceptance:** для входящей без проекта «Принять» открывает пикер → `POST /intake/:id/triage` с непустым `targetProjectId` → 200; проектный intake фильтрует `GET /intake` по проекту и шлёт его id; при 400 виден тост (grep `toast.error`); typecheck/lint/build зелёные.
**Закрывает:** аудит §3.2.

## Фаза A2 — Единый «Спринт» + «Архив спринтов» вместо «гипотез» + длительность
**Файлы:** `frontend/app/(authenticated)/sprints/archive/page.tsx:6` (`title:'Архив гипотез — Кора'`); `SprintArchiveClient.tsx:112` (`<h1>Архив гипотез`), `:114-116` подзаголовок, `:122-137` тайлы «Подтвердились/Не подтвердились», `:385-387` «Гипотеза не была зафиксирована», `:422-429` `computeDurationDays` (лишний `+1`); `ProjectViewShell.tsx:42` (`'Циклы'`); `SprintsListClient` подзаголовок «Циклы команды»; диалог create «Цикл внутри проекта».
**Что входит:**
1. ТР1: UI-строки «Цикл/Циклы»→«Спринт/Спринты» (вкладка проекта, подзаголовок списка, диалог создания, прочие пользовательские вхождения). Внутренние `cycleId`/`cycleViewEnabled` не трогать.
2. «Архив гипотез»→«Архив спринтов» (`title`+`<h1>`); подзаголовок без «подтвердилось/гипотеза»; тайлы «Подтвердились/Не подтвердились/В процессе»→«Завершены/Отменены/В процессе» (маппинг на статусы цикла completed/cancelled/in_progress, данные не ломать); «Гипотеза не была зафиксирована»→«Цель спринта не зафиксирована».
3. `computeDurationDays`: убрать `+1` → `Math.max(1, Math.round((e-s)/86_400_000))` (6→20 июн = 14).
**Что НЕ входит:** переименование Prisma `Cycle`/полей; бэк-расчёты.
**Acceptance:** grep пользовательских «Цикл/Циклы» в `sprints`/`projects` = 0 (кроме `cycleId`/`cycleViewEnabled`/импортов); «гипотез»/«Подтвердились» в archive-клиенте = 0; `computeDurationDays` без `+1` (вход 06→20 июн = 14); вкладка проекта `label:'Спринты'`; build зелёный.
**Закрывает:** §3.4, §3.5, §4.3.

## Фаза A3 — Реструктуризация меню «Задачи» (ТР2 + ТР3)
**Файлы:** `frontend/src/ui/components/app-shell/Sidebar.tsx:234-267` (`DAILY_GROUP`), `:269-288` (`ME_GROUP`), `:204-222`+`:527-538` (`MEMORY_GROUP`), `:411-418`+`:505-515` (динамическая вставка «Входящие» owner/admin); `frontend/src/lib/nav-help.ts:36-38` (описание `/intake`); подпись `/me/inbox` (мобайл).
**Что входит:**
1. Новая группа `TASKS_GROUP` «Задачи»: Проекты · Спринты · Входящие(динамич. owner/admin + бейдж) · Архив спринтов.
2. Из `DAILY_GROUP` убрать Дамп/Таблицы/Проекты/Спринты/Архив; оставить Команда · Главная · Встречи · **Карточки**(рядом с Встречи) · Помощник компании.
3. Дамп+Таблицы → `MEMORY_GROUP`.
4. Порядок групп: Каждый день → **Задачи** → Моё пространство → Память компании → Управление → Настройки.
5. ТР3: подпись `/me/inbox`→«Мои задачи»; `nav-help` для `/intake` — про очередь триажа.
**Что НЕ входит:** слияние с «Подтверждениями» (vNext); права/гейты видимости (owner/admin для Входящих сохранить); правка страниц.
**Acceptance:** в `Sidebar.tsx` есть группа `label:'Задачи'` с `/projects`,`/sprints`,`/sprints/archive`,динамич `/intake`; `DAILY_GROUP` без `/dump,/tables,/projects,/sprints`, с `/cards` после `/meetings`; `MEMORY_GROUP` с `/dump,/tables`; бейдж «Входящие» сохранён; `/me/inbox`=«Мои задачи»; навигация без 404; build зелёный.
**Закрывает:** §4.1, §4.2(имена), §4.5.

## Фаза A4 — «Ещё ▾» для подвкладок проекта (ТР4)
**Файлы:** `frontend/app/(authenticated)/projects/[slug]/ProjectViewShell.tsx:23-54` (`buildTabs`, часть уже за `*ViewEnabled`), `:71-73` (фильтр).
**Что входит:** primary (на виду): Обзор·Доска·Список·Календарь·**Спринты**(переименов. в A2)·Настройки; secondary («Ещё ▾»): Документы·Приложения·Загруженность·Входящие·Гант. Сохранить фильтрацию `*ViewEnabled`. Активная secondary-вкладка подсвечивает «Ещё ▾».
**Что НЕ входит:** удаление вкладок; изменение флагов.
**Acceptance:** inline-вкладок ≤6; Документы/Приложения/Загруженность/Входящие/Гант в «Ещё»; переход из «Ещё» работает; build зелёный.
**Закрывает:** §4.4.

## Фаза A5 — Язык/тон/плюрализация + шаблоны + бэк-промпт + ссылка дампа
**Файлы:** `IntakeClient.tsx:269` («Triage … API»), `:270` («твоя задача»); `IssueCard.tsx:69` («Оценка в попугаях»), `:72` («{n} меток»), `:76` («{n} встреч»); seed `backend/src/modules/tracker/seed/team-templates-data.ts:113` («SDR»), `:115` («BANT/CHAMP»); бэк-промпт `backend/src/modules/tracker/services/issue-infer-fields.service.ts:216` («Z/Кора»); `DumpClient.tsx:118-124` (ссылка).
**Что входит:**
1. IntakeClient: «Triage входящих задач … из писем, чатов, встреч и API»→«Разбор входящих задач … из писем, чатов, встреч и внешних сервисов»; «твоя задача подтвердить»→«ваша задача — подтвердить».
2. IssueCard: «Оценка в попугаях»→«Оценка сложности»; «{n} меток»→`pluralRu(n,['метка','метки','меток'])`; «{n} встреч»→`pluralRu(n,['встреча','встречи','встреч'])` (утилита `pluralRu` уже есть).
3. Шаблоны (через **patch**, не пересев — `safe-seed-rules`): «Специалист по квалификации (SDR)»→«Специалист по квалификации»; «… по BANT/CHAMP»→«… по методике квалификации». Правки в `team-templates-data.ts` + идемпотентный `backend/scripts/patch-team-templates-ru.ts` (`createPrismaClient()` из `_lib/prisma`, импорт `../src`, регистрация в `apply-prod-deploy.ts` STEPS, phase update, `skipBootstrap:true`). **Категорию «technology» НЕ трогать — уже «Технологии» через фронт-маппинг (ТЗ-2 Ф4).**
4. Бэк-промпт `issue-infer-fields.service.ts:216` «Z/Кора»→«Кора» (разовая правка стабильной части SYSTEM — кэш переустановится сам).
5. Ссылка дампа (Действие 0.2): `DumpClient.tsx:118-124` «Открыть Входящие» (`/intake`) → «Открыть Идеи» (`/ideas`).
**Что НЕ входит:** AI-сгенерированный текст карточек Входящих («email-рассылок» и пр. — динамика); категория «technology» (готова); массовый пересев шаблонов.
**Acceptance:** grep «Triage|в попугаях|твоя задача|BANT|CHAMP» в указанных файлах = 0; IssueCard использует `pluralRu`; `patch-team-templates-ru.ts` идемпотентен и в STEPS; `issue-infer-fields.service.ts:216` без «Z/Кора»; DumpClient ссылка `href="/ideas"`; typecheck/lint/build (front+back) зелёные.
**Закрывает:** §3.7, §3.3(бэк-остаток), §3.6(ссылка).

## Фаза A6 — Скрыть теневой проект «Спринт компании» из `/projects`
**Файлы:** `backend/src/modules/tracker/services/sprints.service.ts:328-434` (`quickCreate` создаёт Project при scope≠project), `:731-742` (`buildProjectName`, scope='org'→«Спринт компании»); `projects` list (`GET /projects`); `backend/prisma/schema.prisma` модель `Project (~7874)`.
**Что входит:**
1. Prisma: `Project.systemGenerated Boolean @default(false)`. **Версионируемая миграция** (`prisma:migrate -- --name project_system_generated`, ревью SQL — `prisma-db-push-rules`), затем `prisma:generate`.
2. `quickCreate`: при scope='org'-контейнере ставить `systemGenerated:true`. [ASSUMPTION: скрываем только org-scope «Спринт компании»; клиент/поставщик/сотрудник/отдел — осмысленные проекты, оставляем видимыми.]
3. `GET /projects`: по умолчанию фильтр `systemGenerated:false`. Спринты этих контейнеров доступны через раздел «Спринты».
4. Идемпотентный `backend/scripts/backfill-system-generated-projects.ts` (пометить существующие org-контейнеры), регистрация в `apply-prod-deploy.ts` STEPS.
**Что НЕ входит:** удаление проектов; скрытие проектов с реальным scope.
**Acceptance:** схема содержит `systemGenerated`; миграция-файл в `prisma/migrations/`; после общего спринта `GET /projects` без «Спринт компании», раздел «Спринты» его показывает; backfill идемпотентен; prisma:generate + build зелёные.
**Закрывает:** §3.8 (теневой проект).

## Фаза A7 — Консолидация поллинга бейджей навигации (консервативно)
**Контекст:** на каждой странице летят `GET /intake?status=pending&limit=1`, `/me/inbox/count`, `/pending-actions/count` (хуки `useIntakePendingCount` и сосед.).
**Что входит:** единый интервал поллинга бейджей + SWR `dedupingInterval` (через существующий конфиг/константу, не хардкод вразнобой). Не трогать feed/proactive/clone-access/effective-access (vNext, отдельное perf-ТЗ).
**Что НЕ входит:** общая оптимизация поллинга кабинета; серверные изменения.
**Acceptance:** бейдж-хуки используют единый интервал + dedup (grep-маркер); бейдж «Входящие» обновляется после триажа; build зелёный.
**Закрывает:** §3.8 (поллинг, частично).

---

# Часть Б — Встречи (войти / вернуться / поделиться / пригласить)

## Решения владельца (Встречи)
| # | Решение |
|---|---|
| ВР1 | Ядро шаринга/возврата — фронт (ссылка `/m/{id}` детерминирована, бэкенд rejoin `POST /meetings/:id/join` уже работает). |
| ВР2 | host-ссылка = `/m/{id}` (гость вводит имя / входит по per-invitee ссылке). Новые секрет-токены НЕ вводить. |
| ВР3 | У хоста добавить «Выйти» (disconnect, встреча остаётся active) ОТДЕЛЬНО от «Завершить». |
| ВР4 | «Скопировать ссылку» и «Вернуться» — **явно видимы**, не в hover/«Ещё». |
| ВР5 | ДВА способа допригласить (оба в scope): ручная ссылка + авто-приглашение (выбрать сотрудника→почта/Телеграм), доступны и ПОСЛЕ создания/во время встречи (B5). |
| ВР6 | Существующую авторассылку ПРИ СОЗДАНИИ НЕ менять/НЕ удалять — только переиспользовать. |
| ВР7 | «Пригласить» и «Скопировать ссылку» после создания — и в детали встречи, и в тулбаре комнаты. |

**Хелпер:** `isJoinableStatus(status) = status==='scheduled' || status==='active'` — единый критерий «Войти/Скопировать/Пригласить» vs «Открыть результат».

## Фаза B1 — «Войти» + «Скопировать ссылку» + «Пригласить» у идущей встречи (платформа)
**Файлы:** `frontend/src/ui/components/meetings-journal/MeetingsJournalReal.tsx:886-1050` (`MeetingDetailPane`, сейчас только «Открыть результат» :969-973), `:435-520` (`MeetingRowCard`); `frontend/src/api/meetings.api.ts:66` (`{id,url}`).
**Видимость (ВР4):** действия видны сразу, не в hover.
**Что входит:** в `MeetingDetailPane` при `isJoinableStatus` — «Войти в встречу» (`/m/<id>`), «Скопировать ссылку» (`${origin}/m/<id>`+тост), «Пригласить» (открывает `InviteDialog` из B5). В `MeetingRowCard` — постоянно видимые «Войти»/«Скопировать ссылку». Бейдж «идёт» у active. Для не-joinable — как сейчас (результат).
**Acceptance:** для active/scheduled в детали видны «Войти»/«Скопировать ссылку»/«Пригласить»; copy кладёт `…/m/<id>`+тост; для `ai_ready` действий нет; build зелёный.
**Закрывает:** пробел встреч №1.

## Фаза B2 — Возврат хоста (rejoin) + хостовое «Выйти»
**Файлы:** `frontend/app/(public)/m/[id]/MeetingPageShell.tsx:54-70` (авто-join, `:56` `autoJoinAttempted`, `:170-177` пустой скелет); `meeting-room/MeetingRoom.tsx:135-138` (`onLeave`); `meeting-room/ControlsBar.tsx:169-176` (хост «Завершить»), `:180-191` (гость «Выйти»).
**Что входит:**
1. Хостовое «Выйти» в `ControlsBar` (disconnect+`onLeave`, БЕЗ завершения); «Завершить» оставить (красная, с подтверждением).
2. После `onLeave`, если встреча joinable — вместо пустого скелета блок «Вы вышли из встречи» + «Вернуться в встречу» (повторный join, сбрасывая `autoJoinAttempted`) + «Скопировать ссылку».
3. Для `completed/ai_*` — существующий finished-плейсхолдер.
**Acceptance:** у хоста две кнопки «Выйти»/«Завершить»; после «Выйти» встреча в БД `active` (diag); на `/m/<id>` блок «Вернуться в встречу», клик → `POST /meetings/<id>/join → 200`; повтор многократно; build зелёный.
**Закрывает:** пробел встреч №2.

## Фаза B3 — Надёжная «Ссылка» в комнате + «Пригласить»
**Файлы:** `meeting-room/ControlsBar.tsx:145-149` (`copyLink()`→`/m/{id}`; живой прогон: `NotAllowedError`, без тоста).
**Что входит:** `copyLink()` — успех `toast.success('Ссылка скопирована')`; ошибка clipboard → fallback (поповер с выделенной ссылкой / `execCommand('copy')`), не молча. Подпись/тултип «Скопировать ссылку». Кнопка «Пригласить» у хоста (открывает `InviteDialog` из B5).
**Acceptance:** успех→тост (grep «Ссылка скопирована»); отказ clipboard→fallback виден; build зелёный.
**Закрывает:** пробел встреч №3.

## Фаза B4 — Лобби: «Скопировать ссылку» до входа
**Файлы:** `frontend/app/(public)/m/[id]/MeetingPageShell.tsx` (пре-join лобби хоста); образец copy — `CreateMeetingFormV2.tsx:441-493`.
**Что входит:** на пре-join лобби для хоста (joinable) — «Скопировать ссылку» (`/m/{id}`+тост) рядом с «Войти». Гостю не показывать.
**Acceptance:** на лобби `/m/<id>` для хоста есть «Скопировать ссылку»; для гостя нет; build зелёный.
**Закрывает:** lobby-часть пробела №1.

## Фаза B5 — Авто-приглашение ПОСЛЕ создания / во время встречи (reuse, не ломать)
**Переиспользуем (НЕ дублировать, НЕ удалять — ВР6):** пикер `CreateMeetingFormV2.tsx:160-174,322` (`<ParticipantPicker showChannels/>`); контракт `{userId,personId,email,sendVia:['email'|'telegram'][]}` (`create-meeting.dto.ts:35-46`); бэк-логика pre-seed Participant + `deliverMeetingInvites` (`meetings.service.ts`).
**Что входит:**
1. Бэкенд: вынести приём-invitees из `createForUser` в метод `addInvitees(tenantId, meetingId, invitees, actorUserId)` (pre-seed Participant + `deliverMeetingInvites`), **без изменения поведения при создании** (создание зовёт тот же метод). Новый `POST /api/v1/meetings/:id/invitees` (Zod-DTO = тот же массив invitees; Swagger; коды ошибок), `@RequireSubscription`, `TenantGuard`, доступ только хост, разрешён при `isJoinableStatus`. Идемпотентность: повтор того же userId/email = no-op.
2. Фронт: `InviteDialog` (`ParticipantPicker showChannels` + «Отправить приглашение» → `meetingsApi.addInvitees(id, invitees)`, тосты). Открывается «Пригласить» из B1 (детали) и B3 (комната). Новый метод `meetings.api.ts`: `addInvitees(id, invitees)`.
**Что НЕ входит:** правка/удаление create-time invite (только рефактор-вынос без смены поведения); отзываемые/ротация токенов; приглашение гостем.
**Acceptance:** `POST /meetings/<id>/invitees {invitees:[{userId,sendVia:['telegram']}]}` для active → 200/201, Participant `invited` + ушло сообщение со ссылкой `…/m/<id>?inv=<token>` (diag); повтор = no-op; **регресс `bunx vitest run backend/.../meetings.service.createForUser.spec.ts` зелёный**; «Пригласить» открывает `InviteDialog` в детали и комнате; Swagger показывает эндпоинт с `@RequireSubscription`; typecheck/lint/build (front+back) зелёные.
**Закрывает:** второй способ допригласить (ВР5) без поломки существующего (ВР6).

---

# Единый граф зависимостей / волны

**Независимы (разные файлы):** A1, A2, A5, A6, A7, B1, B4, B5-бэк.
**Пересечения:** A2 правит `ProjectViewShell.tsx`/`Sidebar.tsx`(подписи спринтов) ← делать ДО A3 (структура `Sidebar`) и A4 (подвкладки). B2 и B3 общий `ControlsBar.tsx` → B3 раньше B2 или один агент. Кнопка «Пригласить» (B1/B3) зависит от B5 (`InviteDialog`+эндпоинт) → B5-бэк раньше размещения.

**Рекомендуемые волны:**
- **Волна 0:** выкат `sergdev` на прод (Часть 0).
- **Волна 1 (бэк/независимое):** A1, A6, A7, B5-бэк (эндпоинт+`InviteDialog`), A5-бэк(patch+промпт). ∥
- **Волна 2:** A2 → затем A3 ∥ A4; параллельно B1 ∥ B4; B3 → B2 (общий ControlsBar) + размещение «Пригласить» (B1/B3).
- **Волна 3:** A5-фронт (строки), финальная сверка.

(Порядок реализации по важности, если последовательно: A1 → B2 → B1 → B3 → A2 → A3 → A4 → B5 → A5 → A6 → A7 → B4.)

# Прод-деплой
- **Деплой `sergdev`** (Часть 0): обычный `docker compose up -d --build` (front+back). После — проверить детальные страницы/бренд/дамп на проде.
- **A6:** версионируемая миграция `Project.systemGenerated` (применится `migrate deploy` авто) + backfill — prod-deploy-log Шаг 4 + Шаг 8; `apply-prod-deploy.ts --mode update`.
- **A5:** patch шаблонов — prod-deploy-log Шаг 6; в STEPS.
- **B5:** новый эндпоинт — prod-deploy-log Шаг 12 (Swagger smoke). Миграций нет.
- Остальное (A1–A4, A7, B1–B4) — фронт/бэк билд без БД-операций.

# DoD
- Все фазы `[x]`, Acceptance каждой выполнен (grep/typecheck/lint/build/ручные пути: «открыть таблицу/задачу/спринт», «принять задачу из встречи в проект», «войти→выйти→вернуться→скопировать ссылку→пригласить»).
- `bun run typecheck && lint && build` зелёные (frontend+backend, вкл. `.spec`); регресс `createForUser.spec.ts` зелёный.
- second-brain: `01_projects/frontend-pages.md`, `frontend-contexts-hooks.md`, `api-layer.md` (новый эндпоинт), `02_architecture/data-model.md` (колонка `systemGenerated`); prod-deploy-log Шаги 4/6/8/12.
- Реестр «не сделано»: отложенные хвосты (слияние Входящие+Подтверждения; общий поллинг кабинета; `IntakeAutoTriageWorker take:40`; per-guest отзываемые ссылки) — строками со ссылкой сюда.
- Рефлексия в `05_история/`.

# Итог

**Реализовано целиком (2026-06-06, ветка `sergdev`).** Все 12 фаз (A1–A7, B1–B5) выполнены, приняты и закоммичены отдельными коммитами; acceptance каждой проверен оркестратором (grep-маркеры, typecheck, lint, build, тесты).

| Фаза | Коммит | Суть |
|---|---|---|
| A1 | `daf1ef8d` | Пикер проекта при «Принять» во Входящих + тост ошибки (фронт) |
| A6 | `90b938a4` | `Project.systemGenerated` + скрытие теневого «Спринт компании» из `/projects` + миграция + backfill |
| A5-back | `f73c6f9c` | Русификация ролей шаблона продаж (patch) + бэк-промпт «Кора» |
| A7 | `9a17cfbc` | Консолидация поллинга бейджей навигации (interval + dedup) |
| B5 | `18ef4580` | `POST /meetings/:id/invitees` (host-only, joinable, идемпотентно) + `InviteDialog` |
| B1 | `86d0b5d8` | «Войти/Скопировать ссылку/Пригласить» у идущей встречи в журнале |
| B3+B2 | `b56dd097` | Надёжный copyLink (fallback-модалка) + «Пригласить» + хостовое «Выйти» в комнате |
| B2+B4 | `ef207417` | Возврат хоста после выхода (rejoin) + «Скопировать ссылку» в лобби |
| A2 | `b74a805e` | Единый «Спринт», «Архив спринтов», `computeDurationDays` без `+1` |
| A3 | `1cf8e8d2` | Группа меню «Задачи»; Дамп/Таблицы → «Память компании»; `/me/inbox`→«Мои задачи» |
| A4 | `392306c7` | Подвкладки проекта primary + «Ещё ▾» |
| A5-front | `25fe0739` | Язык/тон/плюрализация строк + ссылка дампа → `/ideas` |

**Верификация:** frontend build ✅, backend build ✅, `frontend test:unit` 287/287 ✅, backend `meetings`+`tracker/services` 226/226 ✅ (вкл. регресс `createForUser` + новые `addInvitees`-тесты).

**Прод-операции** (детали — `docs/operations/prod-deploy-log.md` → блок «2026-06-06 — Трекер + Встречи»): миграция `project_system_generated` (авто на `up -d`), patch `patch-team-templates-ru.ts` (Шаг 6), backfill `backfill-system-generated-projects.ts` (Шаг 8), Swagger-smoke нового эндпоинта (Шаг 12). Часть 0 (ТЗ-2) выкатывается тем же `docker compose up -d --build`.

**Отложенные хвосты** (в реестре `second-brain/04_не-сделано/README.md`, 2026-06-06): слияние Входящие+Подтверждения; общий поллинг кабинета; `IntakeAutoTriageWorker take:40`; отзываемые токены приглашений; семантика summary архива (бэк); дубль `pluralRu`; `bg-slate-600` в `ControlsBar`.
