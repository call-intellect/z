# ТЗ: Чистка «Админки компании» — убрать расходы + развести с «Настройками»

**Дата:** 2026-06-02
**Тип:** Frontend (навигация + страницы) + Backend (удаление org-usage контроллера)
**Зонтик:** —
**Статус:** черновик, к реализации не приступали

---

## 1. Проблема (зачем это ТЗ)

Сейчас в кабинете три бага, замеченных владельцем Org:

1. **Дублирование «Настройки» ↔ «Админка компании».** Оба пункта левого рейла ведут в один и тот же второй сайдбар (`SettingsSidebar`). `/settings/admin/*` физически вложен в `/settings`, поэтому переиспользует ту же навигацию, где admin-разделы уже показаны подсекцией «АДМИНКА». Отличие — только стартовая страница. Никакого осмысленного «Админка vs Настройки» нет.

2. **Двойной сайдбар (визуальное «наложение»).** `settings/admin/layout.tsx` рисует `SettingsSidebar` второй раз поверх родительского `settings/layout.tsx` → на экране три колонки (меню + меню + контент).

3. **Расходы/себестоимость на глазах у клиента.** Владелец Org не должен видеть стоимость LLM, названия провайдеров (deepseek/ollama) и разбивку по функциям. Он оплатил тариф — остальное на нас (платформе). Это наша себестоимость и наш стек.

Плюс ревизия наполнения «Админки компании» показала: половина вкладок там лишние (см. §3).

---

## 2. Целевая структура навигации

Развести на **две независимые поверхности**, каждая со своим сайдбаром (согласовано 2026-06-02).

### 2.1. «Настройки» (`/settings`) — личное + Org
Левый сайдбар (`SettingsSidebar`, очищенный — убрать подсекцию «АДМИНКА»):
- Профиль
- Безопасность
- Внешний вид
- Организация _(здесь же управление участниками и ролями)_
- Теги
- Интеграции
- Уведомления
- Экспорты
- **Владелец Org:** Подписка и оплата · Тариф и лимиты

### 2.2. «Админка компании» (новый путь `/company-admin`) — управление памятью компании
Новая route-группа со **своим** layout-ом и **своим** сайдбаром `CompanyAdminSidebar` (не переиспользует `SettingsSidebar` — этим лечится баг двойного сайдбара). Только owner/admin.

Вкладки (итог ревизии §3):
- **Доступ к памяти** — кто из сотрудников видит регламенты / сущности
- **Источники** — каналы входящих знаний (бот / звонки / почта / веб-форма)
- **Встречи** — по каким типам встреч считать оценку качества

Стартовая страница админки: **Доступ к памяти**.

---

## 3. Ревизия вкладок: что оставить / убрать / перенести

| Вкладка (текущий путь) | Что делает по факту | Решение |
|---|---|---|
| **Экономика** `/settings/admin/usage` | Расход $, fail rate, провайдеры deepseek/ollama, Топ функций, CSV | ❌ **Удалить целиком** (расходы клиенту не показываем) |
| **Ядро знаний** `/settings/admin/knowledge-core` | Тех. отладка: воркеры, метрики, журнал, граф связей, reprocess + карточка «LLM расход» | ❌ **Удалить из клиента целиком** (инженерная отладка не для владельца + утечка cost). Frontend: страница/клиент + `org-admin-knowledge.api.ts` + домен (если осиротели). Backend: `OrgAdminKnowledgeController`+сервис — удалить если стали orphan (нет других потребителей), иначе хотя бы вырезать `llm.costUsd` из ответа. Возможный будущий перенос debug под супер-админку — отдельная задача. |
| **Доступ к памяти** `/settings/admin/memory-access` | Видимость регламентов/сущностей для member | ✅ **Оставить**, перенести в `/company-admin/memory-access` |
| **Источники** `/settings/sources` | CRUD каналов-источников + тест/вкл/выкл | ✅ **Оставить**, перенести в `/company-admin/sources` |
| **Встречи** `/settings/admin/meetings` | Тумблеры «считать оценку качества по типу встречи» | ✅ **Оставить**, перенести в `/company-admin/meetings` |
| **Участники** `/settings/admin/members` | `redirect` на `/settings/organization` | ❌ **Не включать** — это дубль «Организации», которая остаётся в «Настройках» |

---

## 4. Полный перечень мест с расходами под удаление

| # | Файл / путь | Что | Действие |
|---|---|---|---|
| 1 | `frontend/app/(authenticated)/settings/admin/usage/OrgUsageClient.tsx` | «Экономика организации» целиком | Удалить файл |
| 2 | `frontend/app/(authenticated)/settings/admin/usage/page.tsx` | Роут страницы | Удалить файл |
| 3 | `frontend/src/api/org-admin-usage.api.ts` | Org-клиент usage (единственный потребитель — OrgUsageClient) | Удалить файл |
| 4 | `frontend/app/(authenticated)/settings/admin/knowledge-core/KnowledgeCoreClient.tsx` (≈260-290) | Карточка «LLM расход» (costUsd 24ч/7д) | Удалить блок карточки + неиспользуемый импорт `formatUsd` |
| 5 | `backend/src/modules/admin/controllers/org-admin-usage.controller.ts` | Контроллер `/api/v1/org-admin/usage/*` | Удалить файл |
| 6 | `backend/src/modules/admin/admin.module.ts` (стр. 20, 130) | Импорт + регистрация `OrgAdminUsageController` | Убрать обе строки |

**Не трогать (легитимно):**
- `frontend/src/domain/admin-usage.ts` (`formatUsd` и пр.) — используется супер-админкой.
- `frontend/src/api/admin-usage.api.ts`, `AdminUsageService` (бэкенд) — общий сервис, нужен супер-админке `/admin/*`.
- Подписка/Тариф — цена тарифа это покупка клиента, LLM-стоимости там нет (проверено).
- Вся аналитика расходов в `(admin)/admin/*` — только `isSuperAdmin`, клиент туда не попадает.

**Опционально (defense-in-depth):** убрать поле `llm.costUsd` из ответа `OrgAdminKnowledgeController`, чтобы себестоимость не отдавалась по API даже при прямом запросе. Если оставляем knowledge-core доступным по URL — это желательно.

---

## 5. Фазы реализации

### Фаза 1 — Убрать расходы `[x]`
1. Удалить `OrgUsageClient.tsx` + `usage/page.tsx`.
2. Удалить `org-admin-usage.api.ts`.
3. Удалить карточку «LLM расход» в `KnowledgeCoreClient.tsx` + чистка импорта `formatUsd`.
4. Удалить `org-admin-usage.controller.ts`, убрать импорт+регистрацию в `admin.module.ts`.
5. (Опц.) Убрать `llm.costUsd` из `org-admin-knowledge.controller.ts` / сервиса + типа в `frontend/src/domain/org-admin-knowledge.ts`.
6. Верификация: backend `bun run typecheck` (нет битых импортов `OrgAdminUsageController`), frontend `bun run typecheck` (нет импортов `orgAdminUsageApi`).

### Фаза 2 — Новая поверхность «Админка компании» `[x]`
1. Создать route-группу `frontend/app/(authenticated)/company-admin/`:
   - `layout.tsx` — двухколоночный (как settings-layout), но с `<CompanyAdminSidebar/>`.
   - `page.tsx` — `redirect('/company-admin/memory-access')`.
2. Создать `frontend/app/(authenticated)/company-admin/CompanyAdminSidebar.tsx` — отдельный сайдбар с пунктами: Доступ к памяти, Источники, Встречи. Guard: только owner/admin (через `useAuth().currentOrgRole`).

### Фаза 3 — Перенос рабочих вкладок `[x]`
1. `company-admin/memory-access/page.tsx` → рендерит существующий `MemoryAccessClient` (клиент переносим/реиспользуем как есть).
2. `company-admin/sources/page.tsx` → рендерит существующий `SourcesClient`.
3. `company-admin/meetings/page.tsx` → рендерит существующий `MeetingsAdminSettingsClient`.
4. Поправить относительные импорты (напр. `../useCurrentOrgId`, `useCurrentOrgId.ts` — перенести в `company-admin/` или импортировать общий).

### Фаза 4 — Почистить «Настройки» `[x]`
1. В `frontend/app/(authenticated)/settings/SettingsSidebar.tsx` убрать подсекцию «АДМИНКА» (`ADMIN_ITEMS` + блок рендера). `OWNER_ITEMS` (Подписка, Тариф) — оставить.
2. Удалить дублирующий `settings/admin/layout.tsx` (его роль больше не нужна).

### Фаза 5 — Левый рейл + редиректы `[x]`
1. `frontend/src/ui/components/app-shell/Sidebar.tsx` (≈403-410): пункт «Админка компании» → `href: '/company-admin'`, `matchPrefix: '/company-admin'`.
2. Редиректы старых путей (мягкая совместимость):
   - `/settings/admin` → `/company-admin`
   - `/settings/admin/memory-access` → `/company-admin/memory-access`
   - `/settings/admin/meetings` → `/company-admin/meetings`
   - `/settings/sources` → `/company-admin/sources` (либо оставить и линковать — решить при реализации; рекомендация: редирект ради единообразия)
   - `/settings/admin/usage` → `/company-admin` (страница удалена)
3. Удалить осиротевшие роуты: `settings/admin/page.tsx`, `settings/admin/members/`, `settings/admin/sources/` (deprecated-заглушка), пустую `settings/admin/usage/`.

### Фаза 6 — Ядро знаний: удалить из клиента `[x]`
1. Frontend: удалить `settings/admin/knowledge-core/` (page + `KnowledgeCoreClient.tsx`), `frontend/src/api/org-admin-knowledge.api.ts`, домен `frontend/src/domain/org-admin-knowledge.ts` — если у них не осталось других потребителей (проверить grep'ом).
2. Backend: если `OrgAdminKnowledgeController`/`OrgAdminKnowledgeService` стали orphan (нет других импортов) — удалить контроллер + сервис + разрегистрировать в `admin.module.ts`. Если сервис используется ещё где-то — оставить, но вырезать `llm.costUsd` из ответа (defense-in-depth).

### Фаза 7 — Верификация и документация `[ ]`
1. `frontend`: `bun run typecheck` · `bun run lint` · `bun run build`.
2. `backend`: `bun run typecheck` · `bun run build`.
3. Ручная проверка: «Настройки» и «Админка компании» открывают РАЗНЫЕ сайдбары; нет двойного меню; нигде у owner/admin не видно $/провайдеров/себестоимости.
4. Обновить second-brain:
   - `01_projects/frontend-pages.md` — новые `/company-admin/*`, удалённая «Экономика».
   - `01_projects/api-layer.md` — удалён раздел `/api/v1/org-admin/usage/*`.
   - `01_projects/admin.md` — состав «Админки компании».
   - `02_architecture/module-map.md` — если менялись контроллеры admin-модуля.
5. Рефлексия в `second-brain/05_история/`.

---

## 6. Влияние на прод

- **Нет** изменений схемы БД, ENV, очередей, миграций/seed.
- Только код (frontend + удаление одного backend-контроллера).
- Prod-инструкция: достаточно `docker compose up -d --build backend` (+ пересборка frontend). Отдельных шагов из `prod-deploy-log.md` не добавляется. Свериться с реестром при пуше.
- Swagger smoke (Шаг 12): раздел `/api/v1/org-admin/usage/*` исчезнет — это ожидаемо (контроллер был `@ApiExcludeController`, так что на публичный Swagger не влияет).

---

## 7. Риски и заметки

- `org-admin-usage.api.ts` имеет единственного потребителя (OrgUsageClient) — удаление безопасно (проверено grep'ом).
- `AdminUsageService` НЕ удалять — это общий сервис супер-админки.
- `formatUsd` остаётся в домене для супер-админки; чистим только импорты в удаляемых/правимых org-файлах.
- Смена URL `/settings/admin/*` → `/company-admin/*` требует редиректов, иначе закладки/прямые ссылки сломаются.
- «Организация» (участники) остаётся единственной точкой управления людьми — в «Админку» её не дублируем.

---

## 8. Итог

Реализовано: **нет** (черновик ТЗ). К коду переходить по явному «начинаем реализацию / делаем Фазу 1».
Что закрывает: (1) развод «Настройки»/«Админка компании» на 2 поверхности, (2) баг двойного сайдбара, (3) полное удаление расходов/себестоимости из глаз владельца Org, (4) чистку лишних вкладок админки.
