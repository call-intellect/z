---
type: analysis
status: completed
feature: Settings Templates Page
date: 2026-05-28
---

# Анализ: Страница `/settings/templates`

## Проблема

Маршрут `/settings/templates` возвращает 404. Ссылка на него есть в главном сайдбаре (`Sidebar.tsx:352`), но страница не существует.

## Что планировалось (из документации)

### `docs/user-guide/09-admin-and-economics.md` (строки 245-256)

«**Шаблоны отчётов встреч**»:
- 9 типов встреч имеют каждый свой шаблон AI-отчёта
- Можно: открыть шаблон (например, Discovery), поменять какие блоки должны быть в отчёте, сохранить, отменить
- Можно создать **свой новый тип** встречи под специфику компании (например, «Совет директоров» или «Performance Review»)
- Доступ: owner/admin

### `docs/user-guide/06-roles-and-cabinet.md` (строка 143)

«**Шаблоны** (`/settings/templates`) -- шаблоны встреч и отчётов.»

### Планы и second-brain

- `plans/archive/2026-05-21-phase-0c-onboarding-wizard-frontend.md` (строка 181)
- `plans/analysis/2026-05-21-user-cabinet-design.md` (строки 67, 139, 310)
- `plans/analysis/2026-05-22-ui-design-deep-audit.md` (строка 242)
- `second-brain/01_projects/frontend-pages.md` (строка 22)

Во всех документах страница помечена как **«работает»** / **«существующий»**, хотя фактически её нет.

## Что уже есть на бэкенде

### Слой A: Пользовательские шаблоны (`UserTemplate`)

**API:** `GET/POST/PATCH/DELETE /api/v1/templates`

**Модель БД** (`schema.prisma:1727`):
```prisma
model UserTemplate {
  id             String       @id @default(cuid())
  userId         String
  name           String
  basedOnType    MeetingType?     // базовый тип встречи (nullable)
  prompt         String?          // кастомный промпт (nullable)
  sectionsConfig String[]         // массив строк-ключей секций отчёта
  createdAt      DateTime
  updatedAt      DateTime
}
```

**Backend** (`backend/src/modules/templates/`):
- `GET /api/v1/templates` — список шаблонов текущего пользователя
- `POST /api/v1/templates` — создать (лимит `maxUserTemplatesPerUser`, по умолчанию 20)
- `PATCH /api/v1/templates/:id` — обновить
- `DELETE /api/v1/templates/:id` — удалить (только свои)

**DTO** (`backend/src/modules/templates/dto/template.dto.ts`):
- `name` (string, 1-120)
- `basedOnType` (enum MeetingType, optional)
- `prompt` (string, max 10000)
- `sectionsConfig` (string[], max 50 элементов)

**Использование в UI:**
- `CreateMeetingFormV2.tsx` (строки 89-114) — загрузка пользовательских шаблонов при создании встречи
- `MeetingResultPageReal.tsx` (строка 52) — загрузка списка шаблонов на странице результата встречи

### Слой B: Admin Prompt Templates (`PromptTemplate`)

**API:** `/api/v1/admin/prompt-templates`

**Модели БД:**

1. **`PromptTemplate`** (`schema.prisma:5293`) — шаблон: scope (system/org), key, name, description, meetingType, taskType (summary/tasks/chapters/follow-up/card-rollup), status (draft/active/archived), activeVersionId, editedByAdmin

2. **`PromptTemplateVersion`** (`schema.prisma:5337`) — версия: systemPrompt, outputSchema (JSON), toolName, notes. Каждый save создаёт новую версию

3. **`PromptTemplateSection`** (`schema.prisma:5373`) — секция отчёта: order, key, title, instruction, outputType (text/bullet_list/table/json_object), required, maxTokens. До 30 секций на версию

**Backend** (`backend/src/modules/admin/prompt-templates/`):
- `GET /api/v1/admin/prompt-templates` — список (фильтры: scope, status, meetingType, taskType, search)
- `GET /api/v1/admin/prompt-templates/:id` — карточка с версиями
- `POST /api/v1/admin/prompt-templates` — создать
- `PATCH /api/v1/admin/prompt-templates/:id` — обновить метаданные
- `DELETE /api/v1/admin/prompt-templates/:id` — soft-delete
- `POST /api/v1/admin/prompt-templates/:id/versions` — создать версию
- `GET /api/v1/admin/prompt-templates/:id/versions/:versionId` — получить версию
- `POST /api/v1/admin/prompt-templates/:id/activate-version/:versionId` — активировать версию
- `POST /api/v1/admin/prompt-templates/:id/copy-to-org` — скопировать в Org
- `POST /api/v1/admin/prompt-templates/:id/preview` — превью на демо-встрече

**RBAC:** super_admin — полный доступ; owner/admin Org — чтение system + CRUD над своими org-шаблонами; entitlement-гейт `feature.custom_prompt_templates`.

**Frontend:**
- API клиент: `frontend/src/api/admin-prompt-templates.api.ts`
- Domain модель: `frontend/src/domain/admin-prompt-template.ts`
- Существующие страницы: `frontend/app/(authenticated)/admin/prompts/` (список, создание, редактирование, версии, превью, эксперименты)

### Enum `MeetingType` (`schema.prisma:43`)

13 значений: `team`, `standup`, `plan_fact`, `project`, `sales`, `custdev`, `partner`, `interview`, `customer_success`, `review`, `retrospective`, `task_discussion`, `sprint_review`.

## Проблема фронтенда

### Устаревший API клиент

**Файл:** `frontend/src/api/templates.api.ts`

Содержит поля `isSystem`, `customPrompt`, `description`, которых нет в актуальном backend-ответе.

Реальный backend возвращает: `{ id, name, basedOnType, prompt, sectionsConfig, createdAt, updatedAt }`

### Устаревшая domain модель

**Файл:** `frontend/src/domain/template.ts`

Использует `isSystem`, `customPrompt` вместо `basedOnType`, `prompt`, `sectionsConfig`.

### Навигация

- **Главный сайдбар** (`Sidebar.tsx:352`): пункт `Шаблоны` с `href: '/settings/templates'` **есть**
- **Внутренний сайдбар настроек** (`SettingsSidebar.tsx`): пункта `Шаблоны` **нет**

## Переиспользуемые компоненты

| Компонент / файл | Путь | Что даёт |
|---|---|---|
| Admin Prompts List | `admin/prompts/PromptsListClient.tsx` | Фильтры по scope/status/taskType/meetingType + поиск |
| Prompt Editor | `admin/prompts/[id]/PromptEditor.tsx` | Редактирование systemPrompt + sections |
| Prompt Versions Tab | `admin/prompts/[id]/PromptVersionsTab.tsx` | UI версионирования |
| Prompt Preview Modal | `admin/prompts/[id]/PromptPreviewModal.tsx` | Превью шаблона на демо-встрече |
| API client (admin) | `api/admin-prompt-templates.api.ts` | Полный CRUD + версии + превью |
| Domain mapper | `domain/admin-prompt-template.ts` | Русские label'ы для всех enum'ов |
| API client (user) | `api/templates.api.ts` | CRUD пользовательских шаблонов (требует обновления DTO) |
| Domain mapper (user) | `domain/template.ts` | Базовая domain-модель (требует обновления) |
| Hook | `hooks/use-meeting-reports.ts` | Загрузка доступных шаблонов для встречи |
| Meeting Types Domain | `domain/admin-meeting-type.ts` | Список MeetingTypeId + label'ы |

## Выводы

1. **Детальной UX-спецификации нет** — только продуктовое описание в user guide
2. **Два слоя API** — пользовательские шаблоны (`UserTemplate`) и админские (`PromptTemplate`)
3. **Фронтенд устарел** — API клиент и domain модель не совпадают с реальным бэкендом
4. **Страница не создана** — отсутствует `frontend/app/(authenticated)/settings/templates/page.tsx`
5. **Навигация неполная** — нет пункта в `SettingsSidebar.tsx`

## Рекомендации

1. Обновить API клиент `templates.api.ts` и domain модель `template.ts`
2. Создать страницу `/settings/templates` с:
   - Списком системных шаблонов (9 типов встреч)
   - Списком пользовательских шаблонов
   - Редактированием секций отчёта
   - Созданием кастомных шаблонов
3. Добавить пункт в `SettingsSidebar.tsx`
4. Использовать существующие компоненты из `/admin/prompts` как основу
