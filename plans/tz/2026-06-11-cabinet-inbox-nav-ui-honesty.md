---
type: tz
status: ready-to-implement
feature: cabinet-inbox-nav-ui-honesty
date: 2026-06-11
owner: Сергей (sergrv80@gmail.com)
relates_to:
  - plans/analysis/2026-06-11-finishable-now-roadmap.md
  - plans/tz/2026-06-10-intake-project-picker-and-triage-calibration.md
  - plans/tz/2026-06-10-onboarding-nav-and-prod-retest-followup.md
  - plans/tz/2026-06-11-cabinet-leftovers-ui-probe-chat.md
---

> Сводное ТЗ-2 «Кабинет: Входящие, навигация и UI-честность» — свести разрозненное в один контракт на ОБЕ волны.
> Исследование + состязательное доказательство 7 развилок выполнены (две verification-волны + adversarial decision-разбор).
> Все продуктовые решения владельцем приняты (см. «Принятые решения»). Единственный остаточный вход владельца — финальная строка бренда (дефолт задан).
> Подробное доказательство по развилкам — в `plans/analysis/2026-06-11-finishable-now-roadmap.md` и истории сессии 2026-06-11.

# ТЗ-2 — Кабинет: Входящие, навигация и UI-честность

## Цель

Добить продуктовую честность кабинета: убрать машинный/чужой текст и регрессии, дать создавать проект не выходя из разбора входящих, разгрузить меню новичка. Делаем **обе волны** (всё доделать).

**Зачем.** Сейчас кабинет выглядит «сырым»: в админке светится старый бренд «Z-Admin»; в пикерах сотрудников (глава отдела, владелец цели, исполнитель, участники доступа) вместо имён — пустота, а в одном месте — рантайм-краш; создать проект из «Входящих» нельзя (форма требует технические `slug`/`identifier`); на странице документов колонки «кто загрузил / размер / тип» рисуют «—»; новичок видит ~30 пунктов меню сразу. Это мелочи поодиночке, но вместе они подрывают доверие к продукту.

## REALITY-CHECK (факт по коду на 2026-06-11)

Проверено двумя verification-волнами + личной перепроверкой. Источник правды — код, не прежние ТЗ.

| Пункт | Фактический статус | Доказательство (anchor) |
|---|---|---|
| **D9 англицизмы превью встречи** | ✅ **УЖЕ СДЕЛАНО** — компонента `MeetingDetailPane` не существует; превью русифицированы (`MEETING_TYPE_LABEL_RU`, «хост/гость/ведущий», «Краткое содержание»); англ. «Team sync» живёт только в `MeetingsJournalDesignReference.tsx` (дизайн-мокап, не в проде). **В scope НЕ входит.** | glob `**/MeetingDetailPane*` пуст; `frontend/src/domain/meeting.ts` `MEETING_TYPE_LABEL_RU` |
| **D7 пустые имена** | ⚠️ **БАГ, но не там, где указывал роадмап.** Страница `/persons` (`PersonsListClient`) работает (ходит в `/knowledge/entities`, читает `canonicalName`). Реальный дефект — у `personsDomainApi.list`/`.byId` (`structure.api.ts`) нет обратного маппера `name→fullName`, тогда как у `create/update` он есть. Пустые имена в 5 поверхностях + краш. | `structure.api.ts` `personsDomainApi` (:276-286 без маппера, :288-315 маппер есть) |
| **D2 автоген slug/identifier** | ❌ не сделано в `ProjectsService.create`, **но утилиты уже написаны и оттестированы** (`generateProjectSlug`/`generateProjectIdentifier` в `translit.ts`), используются в `sprints.service.ts`. Фикс = переиспользование. | `backend/src/modules/tracker/utils/translit.ts:135-181` |
| **D10 документы** | ❌ Контракт DTO документов **разошёлся целиком**: фронт `DocumentApi` ждёт `sizeBytes/uploaderName/attachedRoleName/parsedAt`, бэк `toDocumentDto` отдаёт `originalSize/uploaderId/attachedRoleId` без имён. Не «3 поля», а выравнивание контракта. `parsedAt`-колонки в БД НЕТ. | `documents.dto.ts:252`, `documents.api.ts:54-82`, controller `:352/:396/:425` |
| **D10 pluralRu** | ❌ дубль не «3 копии», а **7+ во фронте + ≥5 на бэке** (включая `pluralMinutes/Hours/Days`), сигнатуры разные. | grep `pluralRu`/`plural*` |
| **D1 пикер** | ❌ `ProjectPickerDialog` (`IntakeClient.tsx`) НЕ создаёт проект (футер только «Отмена», `projectsApi.create` не импортирован). | `IntakeClient.tsx` `ProjectPickerDialog` |
| **D6 ребренд** | ❌ «Z-Admin» в логотипе/крошках/title. **НО:** всего вхождений ~181/156 файлов, из них brand-UI лишь ~70 (логотип 1 + ~36 крошек + ~34 title); остальные 120+ — комментарии/имя роли `super_admin`, **трогать нельзя**. | `AdminShell.tsx:98`, `admin/layout.tsx:7` |
| **D3/D4 навигация** | ❌ механизм сворачивания есть только у `REFERENCE_GROUP`; `primary-nav.ts` нет; `/feed` в desktop нет; welcome-тур не автозапускается. | см. ТЗ `2026-06-10-onboarding-nav...` (актуально) |
| **D5 слияние** | ❌ /intake и /actions раздельны, **НО** /actions УЖЕ агрегирует intake (Action Center, `IntakePendingProvider`). Слияние ломает рабочую двухуровневую модель → **ОТЛОЖЕНО** (продуктовое решение). | `backend/.../actions` `IntakePendingProvider` source `'intake'` |
| **D8 уведомление** | ❌ completed без записи молчит; **в backend нет модуля notifications**. | `livekit-events.handler.ts` `onRoomFinished` |

## Принятые решения владельца (НЕ пересматривать)

Доказательства — adversarial decision-разбор 2026-06-11 (7 развилок, proposer + независимый оппонент). Владелец одобрил все.

| # | Решение | Обоснование (почему) |
|---|---|---|
| Р1 | **Две волны.** Волна 1 = {D6, D7, D1+D2, D10} (ничего из навигации, без миграций); Волна 2 = {D4, D3, D5-отложено, D8} под отдельное ревью. | Изолировать рискованную перестройку `Sidebar.tsx` (1106 строк, role-gating) от косметики — прямой совет исходного ТЗ онбординга «не крамить рефактор в конце большого свипа». D1 в Волне 1 (а не Волне 2): пикер не трогает Sidebar ни строкой, а D1+D2 — одно цельное ТЗ. |
| Р2 | **D6: единая константа `ADMIN_BRAND` + `title.template` + узкий vitest-гард**, прицельный codemod 3 конструктов. Бренд — **«Кора-Админ»** (дефолт; подтверждает владелец). | `fix-the-whole-class` + защита от регрессии (новая страница не притащит «Z-Admin»). НЕ менять 120+ комментариев/имя роли. |
| Р3 | **D7: обратный маппер в api-слое** (`personsDomainApi.list` И `.byId`), один хелпер `mapPersonFromApi` + сырой тип. | `frontend-rules` (ApiDto→DomainModel в api-слое), зеркало уже существующего `create/update`-маппера, `fix-the-whole-class` (2 функции = все 5 потребителей). НЕ переименовывать контракт бэка (каскад). |
| Р4 | **D2: серверная автогенерация** (`slug/identifier` `.optional()`, генерация внутри `$transaction`, готовые утилиты), фронт шлёт только `{name}`. | Сервер — единственный арбитр уникальности; финальный гарант = DB-constraint (P2002). Клиентская генерация = вторая копия транслита (нарушение `fix-the-whole-class`). |
| Р5 | **D10 документы: выровнять контракт `toDocumentDto`** к `DocumentApi` (`orgId/sizeBytes/uploaderName/attachedRoleName`), `parsedAt=null` БЕЗ миграции. | `parsedAt` на экране не рендерится → колонку не заводим («не плодить колонки на прод-БД клиентов»). `updatedAt` как parsedAt отвергнут — врёт (сдвигается при атрибуции). |
| Р6 | **D5 слияние — ОТЛОЖЕНО** из ТЗ-2, оформить отдельным мини-дизайном. | Продуктовое решение про права/смысл; /actions уже агрегирует intake — грубое слияние ломает модель и конфликтует с `/me/inbox`. Не блокирует остальные пункты. |
| Р7 | **pluralRu — фоновая уборка** (Волна 2 или отдельный мелкий PR), не Волна 1. | Видимой пользователю ценности ноль (надписи уже русские); риск регрессии в `contribution.ts` (возвращает строку с числом). |

**Единственный остаточный вход владельца:** финальная строка бренда — `[ASSUMPTION: ADMIN_BRAND = 'Кора-Админ']`. Альтернатива «Кора — Управление» (нулевой англицизм). При архитектуре Р2 это правка **одной строки-константы** — не блокирует старт.

## Доказательство выбора

Полная состязательная таблица 7 развилок (proposer + оппонент, с `file:line`) — `plans/analysis/2026-06-11-finishable-now-roadmap.md` и рефлексия сессии 2026-06-11. Здесь — выводы (Принятые решения выше). Оппонент перевернул только F1 (D1 → Волна 1); остальные 6 устояли с обязательными поправками, учтёнными в фазах.

## Требования (R1…Rn)

- **R1.** Когда пользователь открывает любую страницу `/admin/*`, система shall показывать бренд «Кора-Админ» (логотип, хлебные крошки, title вкладки) и нигде в видимом UID админки — «Z-Admin».
- **R2.** Если в каталогах `frontend/app/(admin)` или `frontend/src/ui/components/admin` появляется видимый литерал «Z-Admin» (логотип/крошка/title), то гард-тест shall падать.
- **R3.** Когда фронт получает список или карточку сотрудника через `personsDomainApi.list`/`.byId`, система shall отдавать объект с непустым `fullName` (и `departmentId/departmentName/roleId/roleName`), а не `undefined`.
- **R4.** Когда открыта страница групп доступа и у сотрудника нет имени, система shall не падать (опциональный доступ к `fullName`).
- **R5.** Когда пользователь в `ProjectPickerDialog` нажимает «Создать проект» и вводит только название, система shall создать проект и продолжить accept входящей в новый проект без перезахода.
- **R6.** Когда `POST /api/v1/projects` приходит тело без `slug`/`identifier`, система shall сгенерировать их из `name` (транслит + уникальный suffix) внутри транзакции; при гонке уникальности slug — поймать P2002.
- **R7.** Если в теле `POST /projects` передан явный занятый `slug`, система shall вернуть `409 project_slug_taken` (поведение сохранено).
- **R8.** Когда фронт получает документ через `documentsApi`, система shall отдавать `sizeBytes` (из `originalSize`), `uploaderName` (из связи uploader), `attachedRoleName` (из связи attachedRole); `parsedAt` — `null`.
- **R9.** Когда рендерится `ControlsBar`, разделители shall использовать токен `bg-border`, а не `bg-slate-600`.
- **R10.** Когда расчёт `SprintArchiveSummaryApi` агрегирует циклы, семантика shall быть по статусу цикла (`completed/cancelled`), а не `confirmed/rejected`.
- **R11.** Когда новый пользователь (нет localStorage-ключей) открывает кабинет, второстепенные группы меню (Чаты, Управление, Память) shall быть свёрнуты; видимых пунктов ≤ ~15.
- **R12.** Когда mobile- и desktop-навигация строятся, оба shall брать ежедневные пункты из единого `PRIMARY_NAV_ITEMS`; набор mobile shall быть подмножеством desktop (гард-тест).
- **R13.** Когда документировано отложенное (D5, D8, `parsedAt`, pluralRu), каждое shall иметь строку в `second-brain/04_не-сделано/README.md`.

## Scope

**Входит (Волна 1):** D6 ребренд · D7 маппер имён · D1+D2 пикер+автоген · D10 (ControlsBar · документы-контракт · Архив спринтов).
**Входит (Волна 2):** D4 primary-nav+/feed+гард · D3 сворачивание групп+welcome-автозапуск · D8 уведомление (или вынос в отдельный план) · pluralRu-уборка (опц.).
**Не входит:**
- **D9** (англицизмы превью) — уже сделано (REALITY-CHECK).
- **D5 слияние** Входящие+Подтверждения — отложено владельцем (Р6) → отдельный мини-дизайн `plans/analysis/`, строка в 04_не-сделано. НЕ кодить.
- **Колонка `parsedAt` в БД** — не заводим (Р5); если позже UI начнёт показывать дату разбора — отдельное vNext-ТЗ.
- **Уникальный constraint на `Project.identifier`** — не вводим (остаётся `@@index`).
- Калибровка авто-триажа (Фаза 3 ТЗ `intake-project-picker`) — отдельный трек, не сюда.

## Граничные контракты с другими ТЗ

- **ТЗ `2026-06-10-intake-project-picker...`** — детальный контракт D1 (Фаза 1) и D2 (Фаза 2) живёт там; здесь — дельты (Р4: D1 шлёт только `{name}`; D2 генерит внутри `$transaction`). Не дублируем, ссылаемся.
- **ТЗ `2026-06-10-onboarding-nav...`** — детальный контракт D3 (Ф1) и D4 (Ф2) живёт там; здесь Волна 2 = его Ф1/Ф2 без изменений.
- **ТЗ `2026-06-11-cabinet-leftovers-ui-probe-chat`** (ТЗ-1) — соседний свип UI-протечек; не пересекается по файлам (enum→русский, probe, чат-стрим). Перед стартом — `git fetch`, сверить, что не трогаем одни строки.

## Границы фичи

- ✅ **Always:** русский UI (`admin_ui_russian_only`); парные токены `bg-{color}`+`text-{color}-fg`; маппинг ApiDto→Domain в api-слое; re-Read каждого файла после правки + `git status` перед коммитом; Ship-On (всё включённым, без OFF-флагов).
- ⚠️ **Ask first:** изменение строки бренда сверх «Кора-Админ»; любое касание схемы Prisma (по плану — НЕ требуется ни в одной фазе); вынос D8 в отдельное ТЗ.
- 🚫 **Never:** миграции БД в Волне 1; массовый replace «Z-Admin» по подстроке (только 3 конструкта); переименование контракта `/api/v1/persons` на бэке; OFF-флаг «понаблюдаем→включим»; трогать `MeetingsJournalDesignReference.tsx` (мокап).

---

# ВОЛНА 1 — косметика + слой domain + готовая бэк-утилита (без миграций)

> Чистый `docker compose up -d --build`. Ничего из навигации. Фазы независимы, кроме Ф4 (D1) зависит от Ф3 (D2).

## Ф1 — D6 ребренд «Z-Admin» → «Кора-Админ» `[ ]`

**Цель:** заменить видимый бренд админки в 3 конструктах через единый источник + машинный гард. **Закрывает: R1, R2.**

**Картография (anchor; номера строк перепроверить перед правкой):**
- Логотип: `frontend/app/(admin)/admin/AdminShell.tsx:98` — литерал `Z-Admin` внутри `<span>` (рядом `Shield`, `⌘K`).
- Корневой title: `frontend/app/(admin)/admin/layout.tsx:7` — `metadata = { title: 'Z-Admin' }`.
- Крошки: `~36` файлов с `{ label: 'Z-Admin', href: '/admin' }`; рендер — `AdminBreadcrumbs.tsx` (рендерит `item.label` как есть); среди 36 — JSDoc-пример в `AdminBreadcrumbs.tsx` (тоже поправить, иначе гард поймает).
- Title-страниц: `~34` файла `(admin)/admin/**/page.tsx|layout.tsx` с `title` вида `'Z-Admin — …'` / `'… · Z-Admin'`.
- **НЕ трогать:** ~120+ вхождений `Z-Admin` в комментариях/JSDoc и как внутреннее имя роли `super_admin` (напр. `OrgSwitcher.tsx` комментарий, `entitlement-context`, `auth-context`).

**Что входит:**
1. Новый модуль `frontend/src/ui/components/admin/brand.ts`:
   ```ts
   export const ADMIN_BRAND = 'Кора-Админ'; // [ASSUMPTION] подтверждает владелец; альт. 'Кора — Управление'
   export const adminRootCrumb = () => ({ label: ADMIN_BRAND, href: '/admin' });
   ```
2. `AdminShell.tsx:98` → `{ADMIN_BRAND}`.
3. `admin/layout.tsx` → `metadata: Metadata = { title: { default: ADMIN_BRAND, template: \`%s · ${ADMIN_BRAND}\` } }`. На ~34 дочерних страницах укоротить `title` до суффикса раздела (напр. `'Дашборд'` вместо `'Z-Admin — Дашборд'`). Формат итогового заголовка вкладки — `'Раздел · Кора-Админ'` (**осознанная унификация порядка**, не no-op).
4. ~36 крошек: `{ label: 'Z-Admin', href: '/admin' }` → `adminRootCrumb()` (прицельный codemod по точному конструкту).
5. Гард: `vitest`-греп-тест (напр. `frontend/src/ui/components/admin/brand.guard.spec.ts`), сканирующий **только** `frontend/app/(admin)` и `frontend/src/ui/components/admin`, падающий при встрече литерала `Z-Admin` в 3 конструктах (`title:`, `label: 'Z-Admin'`, span логотипа). НЕ ESLint `no-restricted-syntax` на любой `Literal /Z-Admin/` (зацепит комментарии/тесты вне админки).

**Что НЕ входит:** комментарии и имя роли `super_admin`; (authenticated)-сайдбар Org-admin (это другая роль/бренд).

**Acceptance:**
- grep `Z-Admin` по `frontend/app/(admin)` + `frontend/src/ui/components/admin` в JSX/title/label-конструктах → 0 (только комментарии/имя роли остаются).
- grep `Кора-Админ` → находит `brand.ts`; логотип и крошки рендерят «Кора-Админ».
- Новый гард-тест зелёный; при искусственном возврате `title: 'Z-Admin — X'` — краснеет.
- `bun run typecheck && bun run lint && bun run build` (frontend) зелёные.

## Ф2 — D7 обратный маппер имён сотрудников `[ ]`

**Цель:** устранить дрейф `name↔fullName`: пустые имена в 5 поверхностях + краш. **Закрывает: R3, R4.**

**Картография:**
- Бэк отдаёт (НЕ менять): `PersonListItemDto { name, email, userId, primaryDepartmentId, primaryDepartmentName, currentRoleId, currentRoleName, invitationStatus, createdAt, … }` — `backend/src/modules/persons/dto/persons.dto.ts:113-126`.
- Фронт ждёт: `PersonDomainApi { fullName, departmentId, departmentName, roleId, roleName, userId, invitationStatus, createdAt }` — `frontend/src/api/structure.api.ts:88-100`.
- Эталон-зеркало (write-маппер уже есть): `structure.api.ts:288-315` (`create`/`update` мапят `fullName→name`, `departmentId→primaryDepartmentId`).
- Без маппера (read): `personsDomainApi.list` (`:276-280`), `personsDomainApi.byId` (`:282-286`).
- Потребители `.fullName`: `DepartmentsTab.tsx:463` (list) и `:330` (byId), `RoleDetailClient.tsx`, `GoalsClient.tsx`, `SprintCreateWizard.tsx`, `AccessGroupsClient.tsx:541` (**краш** `p.fullName.toLowerCase()` без `?.`).
- Прямые вызовы мимо `usePersons`: `AccessGroupsClient.tsx:529`, `RoleDetailClient.tsx:85` (поэтому правка в хуке `usePersons` НЕ закрыла бы класс).

**Что входит:**
1. Сырой тип ответа бэка в `structure.api.ts`:
   ```ts
   interface PersonListItemApi {
     id: string; name: string; email: string | null; userId: string | null;
     primaryDepartmentId: string | null; primaryDepartmentName: string | null;
     currentRoleId: string | null; currentRoleName: string | null;
     invitationStatus: PersonDomainApi['invitationStatus']; createdAt: string;
   }
   ```
2. Приватный чистый хелпер `mapPersonFromApi(raw: PersonListItemApi): PersonDomainApi` — 5 переименований: `name→fullName`, `primaryDepartmentId→departmentId`, `primaryDepartmentName→departmentName`, `currentRoleId→roleId`, `currentRoleName→roleName`; `email/userId/invitationStatus/createdAt` — как есть; `orgId` берётся из аргумента вызова (как в остальных методах).
3. `personsDomainApi.list` → мапит `items` через хелпер, сохраняя контейнер `{ items, total }`. `personsDomainApi.byId` → мапит `{ person }`.
4. `AccessGroupsClient.tsx:541` → `p.fullName?.toLowerCase()` (защита в глубину).
5. `frontend/src/api/structure.persons.spec.ts` — добавить кейсы на **обратный** маппинг: мок ответа `{ items: [{ name, primaryDepartmentId, … }] }` → ожидать `{ fullName, departmentId, … }`; то же для `byId`.

**Что НЕ входит:** переименование полей на бэке; страница `/persons` (`PersonsListClient` — другой поток, работает); новый `src/domain/person.ts` (эталон модуля — маппинг внутри `personsDomainApi`).

**Acceptance:**
- В `personsDomainApi.list`/`.byId` есть вызов `mapPersonFromApi`; grep подтверждает.
- `bunx vitest run frontend/src/api/structure.persons.spec.ts` — зелёный, покрывает list+byId обратный маппинг.
- Ручная проверка (или RTL): `DepartmentsTab` глава отдела, `GoalsClient` владелец цели, `AccessGroupsClient` участники — показывают имена, не пустоту; страница групп доступа не падает.
- `bun run typecheck && bun run lint` (frontend) зелёные.

## Ф3 — D2 серверная автогенерация slug/identifier `[ ]`

**Цель:** убрать обязательный ручной ввод `slug`/`identifier`; сервер генерит из `name`. **Закрывает: R6, R7.** (Подложка под Ф4.)

**Картография:**
- DTO: `backend/src/modules/tracker/dto/projects/create-project.dto.ts:14-23` — `slug`/`identifier` оба `required`, схема `.strict()` (:39).
- Сервис: `backend/src/modules/tracker/services/projects.service.ts:48-132` — `create`. Сейчас: дотранзакционная `findUnique` по slug → `409 project_slug_taken` (:53-63), затем `$transaction` (:65) с `slug: dto.slug, identifier: dto.identifier` (:69-70).
- Готовые утилиты: `backend/src/modules/tracker/utils/translit.ts` — `generateProjectSlug(name, tenantId, client)` (:135-150, суффикс `-2..-5`, `throw 'slug_collision'`), `generateProjectIdentifier(name, tenantId, client)` (:160-181, max 5 симв, `throw 'identifier_collision'`). Принимают `PrismaService | Prisma.TransactionClient`.
- Боевой образец вызова внутри `$transaction`: `backend/src/modules/tracker/services/sprints.service.ts:428-434`.
- Тесты утилит уже есть: `translit.spec.ts` (коллизии slug/identifier).
- Схема: `Project` — `@@unique([tenantId, slug])`, `identifier` только `@@index([tenantId, identifier])` (НЕ unique, оставляем).

**Что входит:**
1. `CreateProjectSchema`: `slug` и `identifier` → `.optional()` (regex-валидация остаётся **для случая «передан»**). `.strict()` сохранить.
2. `ProjectsService.create`:
   - **Убрать** дотранзакционную `findUnique` по slug (:53-63) в безусловном виде. Сохранить ветку `409 project_slug_taken` **только** для случая, когда `dto.slug` передан явно и занят.
   - Внутри `$transaction` (tx) перед `tx.project.create`: если `dto.slug` не передан → `slug = await generateProjectSlug(dto.name, tenantId, tx)`; если `dto.identifier` не передан → `identifier = await generateProjectIdentifier(dto.name, tenantId, tx)`.
   - Финальный гарант уникальности — DB-constraint: поймать `Prisma P2002` на `tenantId_slug` при `tx.project.create` (гонка параллельной транзакции) → один ретрай генерации либо `409`. («Атомарно без гонок» — НЕ заявлять; soft-проверка в tx + constraint.)
3. Тонкий тест на ветку «slug/identifier не переданы → автоген» (по образцу `translit.spec.ts`), без полного collision-харнесса (он уже есть).

**Что НЕ входит:** уникальный constraint на `identifier` (миграция); переписывание утилит; калибровка авто-триажа.

**Acceptance:**
- `POST /projects` с телом `{ "name": "Маркетинг" }` (без slug/identifier) → 201, проект с валидными авто-`identifier` (заглавные латинские 2–5) и уникальным `slug`.
- Повторный `POST /projects` с тем же `name` → второй проект с другим `slug` (суффикс), без 409.
- Явный занятый `slug` → по-прежнему `409 project_slug_taken`.
- `bunx vitest run` нового теста зелёный; `bun run typecheck && bun run build` (backend) зелёные.
- grep подтверждает вызов `generateProjectSlug`/`generateProjectIdentifier` в `projects.service.ts`.

## Ф4 — D1 inline-создание проекта в пикере `[ ]`

**Цель:** дать создать проект прямо в `ProjectPickerDialog`, не выходя из разбора входящих. **Закрывает: R5.** **Зависит от Ф3** (фронт шлёт только `{name}`).

**Картография (детальный контракт — в ТЗ `2026-06-10-intake-project-picker...` Фаза 1):**
- `frontend/app/(authenticated)/intake/IntakeClient.tsx` — `ProjectPickerDialog` (футер только «Отмена»; `useProjects`; `onSelect(projectId)`).
- API: `frontend/src/api/tracker/projects.api.ts` — `projectsApi.create(orgId, body)`; `useProjects().mutate`.

**Что входит (дельта к ТЗ intake-picker, с учётом Ф3):**
1. Кнопка «+ Создать проект» в `ProjectPickerDialog` → режим мини-формы (одно обязательное поле «Название проекта», 1–200; список/поиск скрываются).
2. Submit: `projectsApi.create(orgId, { name })` — **только name** (slug/identifier генерит сервер, Ф3). После успеха: `await mutate()` + сразу `onSelect(created.id)` → accept продолжается в новый проект, модалка закрывается.
3. UX-состояния (`frontend-rules`): loading («Создаём…», поля disabled, без двойного сабмита); ошибка — человекочитаемый тост, форма не теряет введённое; русский UI целиком.
4. `CreateProjectRequest` (`projects.api.ts`) — `slug`/`identifier` сделать опциональными в типе (синхронно с Ф3 DTO).

**Что НЕ входит:** полноценный визард проекта (статусы/участники/шаблон); ручной ввод slug/identifier (намеренно скрыт); клиентский авто-суффикс при 409 (не нужен — сервер генерит).

**Acceptance:**
- В модалке есть «+ Создать проект»; по клику — форма с одним полем «Название».
- Ввод названия → submit создаёт проект (`POST /projects` с телом `{name}`), модалка не уходит на список, а продолжает accept; входящая принята, задача в новом проекте.
- Loading блокирует двойной сабмит; ошибка не роняет диалог; весь текст русский.
- (Если RTL-инфра) мини-тест: submit зовёт `projectsApi.create({name})` затем `onSelect(createdId)`.

## Ф5 — D10 мелочи-долги `[ ]`

**Цель:** закрыть видимые долги. **Закрывает: R8, R9, R10.**

**5a. ControlsBar токен.** `frontend/src/ui/components/meeting-room/ControlsBar.tsx:139` и `:154` — `bg-slate-600` → `bg-border` (2 места). Acceptance: grep `bg-slate-600` по `ControlsBar.tsx` → 0.

**5b. Контракт документов (выравнивание `toDocumentDto` к `DocumentApi`).**
- Картография: бэк `toDocumentDto(doc: Document): DocumentDto` — `documents.dto.ts:252-273` (отдаёт `originalSize/uploaderId/attachedRoleId`, нет имён/`parsedAt`); зовётся в `documents.controller.ts:352` (список), `:396` (patch), `:425` (деталь). Источники: `documents.service.ts:460` (`findMany` список) и `:427` (`findUnique` деталь) — **без `include`** uploader/attachedRole. Фронт-контракт: `documents.api.ts:54-82` (`DocumentApi`: `sizeBytes/uploaderName/attachedRoleName/parsedAt`, `orgId`).
- Что входит:
  1. В `documents.service.ts` list (`:460`) и detail (`:427`) добавить `include: { uploader: { select: { name: true } }, attachedRole: { select: { name: true } } }`. *(Перед правкой — перечитать `schema.prisma model Document`: подтвердить имена relations `uploader`/`attachedRole` и что у `Person`/`Role` поле имени — `name`.)*
  2. Расширить сигнатуру `toDocumentDto(doc: Document & { uploader?: { name } | null; attachedRole?: { name } | null })` и привести **`DocumentDto` к контракту `DocumentApi`**: `orgId` (из `tenantId`), `sizeBytes` (из `originalSize`), `uploaderName` (из `uploader?.name ?? null`), `attachedRoleName` (из `attachedRole?.name ?? null`), `parsedAt: null`. Сохранить уже совпадающие поля (`docType/attachedThemeId/attachedProjectId/suggested*` и т.д.).
  3. В `documents.api.ts:81` — комментарий: «источник `parsedAt` пока отсутствует, всегда `null` (см. 04_не-сделано), это не баг маппера».
- Что НЕ входит: колонка `parsedAt` в БД (Р5); миграции.
- Acceptance: ответ `GET /api/v1/documents` содержит непустые `sizeBytes/uploaderName/attachedRoleName` для документов с загрузчиком/ролью; `parsedAt: null`; UI `DocumentsListClient` показывает имя загрузчика и размер, а не «—». `bun run typecheck && bun run build` (backend) зелёные.

**5c. Семантика Архива спринтов.** `SprintArchiveSummaryApi` считает `confirmed/rejected` вместо `completed/cancelled` по статусу цикла. *(Картография: найти расчёт на бэке — `second-brain/04_не-сделано/README.md:75` указывает место; перечитать перед правкой.)* Привести агрегат к семантике статуса цикла. UI-релейбл (A2) уже сделан — менять только бэк-расчёт. Acceptance: тайлы Архива спринтов отражают `completed/cancelled`; существующий тест (если есть) обновлён/добавлен.

**Что НЕ входит в Ф5:** `parsedAt`-колонка; pluralRu (Волна 2/отдельный PR).

---

# ВОЛНА 2 — навигация + отложенное (отдельное ревью)

> Перестройка `Sidebar.tsx` (~1106 строк, role-gating) под отдельную внимательную приёмку. Порядок: Ф6 (D4) → Ф7 (D3) → Ф8 (D5-фиксация) → Ф9 (D8). pluralRu — Ф10 (опц.).

## Ф6 — D4 единый primary-nav + `/feed` в desktop `[ ]`

**Контракт — ТЗ `2026-06-10-onboarding-nav...` Ф2 (Р11), без изменений.** **Закрывает: R12.**
Кратко: создать `frontend/src/ui/components/app-shell/primary-nav.ts` (`PRIMARY_NAV_ITEMS`: inbox/projects/feed/check-ins/me); `TrackerBottomNav` берёт пункты оттуда (сохранить badge inbox); добавить `/feed` (Лента) в desktop `Sidebar` (в DAILY/meGroup); гард-тест `nav-subset.spec.ts` (mobile ⊆ desktop).
Anchor: `frontend/src/ui/tracker/TrackerBottomNav.tsx:36-42` (хардкод ITEMS), `Sidebar.tsx` (нет `/feed`), страница `app/(authenticated)/feed/page.tsx` существует.
**Acceptance:** см. ТЗ onboarding-nav Ф2; гард-тест зелёный; `typecheck+build+test:unit` зелёные.

## Ф7 — D3 сворачивание групп + автозапуск welcome-тура `[ ]`

**Контракт — ТЗ `2026-06-10-onboarding-nav...` Ф1 (Р10), без изменений.** **Закрывает: R11.**
Кратко: `CHATS_GROUP` (`Sidebar.tsx:312`), `MANAGEMENT_GROUP` (`:357`), динамическую `memoryGroup` (`:577`) перевести в default-collapsed по паттерну `REFERENCE_GROUP` (`:382-421`: `hideGroupLabel` + единственная `collapsibleSubgroups` с `defaultCollapsed: true` + `storageKey 'sidebar.<key>.open'`); role-gating сохранить. Подключить ненавязчивый автозапуск welcome-тура (`startIfNotCompleted('welcome')` на странице первого входа, гейт по tour-progress, **без** нового first-login флага; форс-тур не возвращать).
Anchor: рантайм `SidebarSubgroup` (`Sidebar.tsx:757-833`); `welcome.ts`; `useTour`.
**Acceptance:** новый пользователь видит ≤~15 пунктов; раскрытие группы persist'ится; активный пункт авто-раскрывает группу; welcome-тур показывается один раз, «Пропустить» работает; `typecheck+build+test:unit` зелёные.

## Ф8 — D5 фиксация отложенного слияния `[ ]`

**Цель:** документально закрыть судьбу D5 (НЕ кодить слияние). **Закрывает: R13 (часть).**
**Что входит:**
1. Строка в `second-brain/04_не-сделано/README.md` (Открыто): дата · «единый навигационный вход Входящие+Подтверждения» · почему (разные права/смысл; `/actions` уже агрегирует intake через Action Center — слияние ломает двухуровневую модель, `/inbox` конфликтует с `/me/inbox`) · кто разблокирует: владелец · ссылка на будущий мини-дизайн.
2. (Опц.) заглушка `plans/analysis/2026-06-11-inbox-actions-merge-mini-design.md` со `status: needs-research` и блоком «что выбрать»: целевой URL/название · вкладки и видимость по ролям · объединение бейджей · редиректы со старых `/intake` и `/actions`.
**Что НЕ входит:** любой код слияния, новый роут `/inbox`, изменение бейджей.
**Acceptance:** строка в реестре присутствует; кода навигации D5 нет (grep `'/inbox'` нового роута → 0).

## Ф9 — D8 уведомление «встреча без записи — анализа не будет» `[ ]`

**Цель:** при completed-встрече без записи уведомить владельца встречи, что анализа не будет.
**Картография:** `backend/src/modules/webhooks/livekit-events.handler.ts` `onRoomFinished` (`:224-229`, только метрика+лог); AI-pipeline (`enqueueTranscribe`) — только в `meeting-finalization.service.ts` `promoteMeetingToReady` при `allReady`, вызывается лишь из `egress_ended`/reconcile; reconcile-крон фильтрует `compositeEgressId: { not: null }`. **В backend нет модуля notifications** (`notify.worker.ts` пишет лишь `MeetingEvent ai_notified`, «фронт узнаёт через polling»).
**Решение по судьбе:** контракт уведомления неочевиден (нужен канал доставки). **Если** на старте Ф9 контракт не тривиален (нет готового in-app/conversational канала) — **вынести D8 в отдельное ТЗ** `plans/tz/2026-06-11-meeting-no-recording-notification.md` (`[ASSUMPTION]` подтвердить у владельца канал: in-app событие vs Telegram vs push) и закрыть Ф9 строкой в 04_не-сделано, НЕ блокируя выкат Ф6/Ф7. **Иначе** (если найден готовый канал событий, который читает фронт) — добавить ветку: completed без `Recording`/транскрипта спустя грейс-период → событие `meeting_no_analysis` владельцу встречи.
**Что НЕ входит:** строить полноценный модуль notifications в рамках косметического ТЗ-2.
**Acceptance:** либо реализована ветка уведомления (событие формируется при completed-без-записи, проверяемо), либо D8 вынесен отдельным ТЗ + строка в 04_не-сделано (R13).

## Ф10 — pluralRu консолидация (опц., фоновая уборка) `[ ]`

**Цель:** свести 7+ фронт + ≥5 бэк копий `pluralRu` к единому util + гард. Видимой ценности ноль → низкий приоритет, можно отдельным мелким PR.
**Что входит:** единый util `frontend/src/lib/i18n/plural.ts` и `backend/src/common/utils/plural-ru.ts`, сигнатура **tuple** `(n, [one, few, many])` (у неё уже есть тест `weekly-per-person.test.ts`); заменить все вхождения; ESLint/vitest-гард против новых `plural*`-объявлений.
**Главный риск:** `contribution.ts` возвращает строку **с числом** `${n} ${form}` — проверить 5 потребителей поштучно (re-Read), иначе число задвоится/пропадёт; `event-reminders` `pluralMinutes/Hours/Days` — специализированные обёртки (правильные формы минут/часов/дней).
**Реализация:** `tz-orchestrator` по файлам с `typecheck`+`vitest` на каждый шаг; гард в том же коммите, что util.
**Acceptance:** одна реализация на сторону; все вызовы переведены; гард краснеет на новой копии; `typecheck+build+test` зелёные.

---

## Pre-mortem / Риски

- **D6 codemod по подстроке** зацепит 120+ комментариев/имя роли `super_admin` → **только** прицельные 3 конструкта; гард узкий по каталогам админки. Re-Read каждого файла + `git status` перед коммитом.
- **D7 забыть `byId`** → карточка главы отдела (`DepartmentsTab.tsx:330`) останется битой. Обе функции в одной правке + тест на byId.
- **D2: дотранзакционная проверка slug** (`projects.service.ts:53-63`) сейчас безусловная — при автоген-ветке её надо перенести/убрать, иначе задвоит. P2002 — финальный гарант, не «атомарность».
- **D10 документы:** перед `include` перечитать `schema.prisma model Document` — подтвердить имена relations и поле имени у `Person`/`Role`; смена формы `DocumentDto` затрагивает 3 точки контроллера (:352/:396/:425) — все обновить.
- **D5/D8/pluralRu/parsedAt** — отложенное обязано получить строку в `04_не-сделано` (R13), иначе долг потеряется.
- **Параллельные сессии:** перед каждой волной `git fetch` + `git log --since="1 day"`; ТЗ-1 (`cabinet-leftovers`) трогает соседние UI-зоны — сверить, что не пересекаемся по строкам.

## Ревью-аспекты (для `strict-production-review-gate`)

- Контракты ApiDto↔DTO: после Ф2/Ф5b фронт-типы и бэк-DTO совпадают по именам полей (нет нового дрейфа).
- D2: транзакционная целостность (генерация + insert + дефолтные state/board/member в одной tx); обработка P2002.
- D6 гард реально падает на регрессии (негативный тест).
- Нет миграций/ENV/seed в Волне 1 (Ship-On без флагов).

## Idempotency / Feature-flags / Prod-deploy

- **Флагов нет** (Ship-On, всё включённым). Ни одного OFF-флага.
- **Миграций нет** ни в одной фазе (D10 — без колонки `parsedAt`). Волна 1 и Волна 2 (Ф6/Ф7) — чистый `docker compose up -d --build`.
- **prod-deploy-log:** Волна 1 — `prod-операций нет` (только сборка фронт+бэк). Волна 2 — то же, если D8 не вводит очередь/событие; если Ф9 реализует уведомление с новым событием/cron — обновить `prod-deploy-log.md` Шаг 12 (smoke) и `01_projects/ai-jobs.md`.

## Производные заметки (second-brain) — обновить по DoD

- D7/D10 (контракты) → `02_architecture/code-pitfalls.md` (дрейф ApiDto↔DTO как класс).
- D1/D2 → `01_projects/tracker.md` (создание проекта из пикера, серверный автоген).
- D6 → `01_projects/admin.md` (бренд «Кора-Админ», единый источник).
- D5/D8/parsedAt/pluralRu → `04_не-сделано/README.md` (Открыто).

## DoD (общий чек качества каждой фазы)

- `bun run typecheck` (вкл. `.spec`) · `bun run lint` · `bun run build` зелёные (frontend и/или backend по фазе).
- Затронутые тесты `bunx vitest run <файл>` зелёные; для D2/D6/D7 — добавлены/расширены.
- `git status` проверен, в коммит только свои файлы; коммит `тип(область): …` по фазам.
- Производные заметки second-brain обновлены по таблице выше.
- Отложенное → строка в `04_не-сделано` (R13).

## Итог

Реализуемо двумя волнами. **Волна 1** (Ф1–Ф5) — косметика + слой domain + готовая бэк-утилита, без миграций, всё включённым, видимая ценность за первый выкат (бренд, имена, пикер, документы). **Волна 2** (Ф6–Ф10) — навигация под отдельное ревью + фиксация отложенного. Развилок к владельцу нет, кроме финальной строки бренда (дефолт «Кора-Админ», правка одной константы). Заполнит оркестратор: статусы `[x]`, что осталось.
