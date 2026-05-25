---
type: project
status: in_progress
phase: 5
---

# Контент продукта (`/admin/content/*`)

> Типы встреч, email-шаблоны, system-messages, global-channels, UI-строки — всё, что раньше жило в коде и редактировалось через PR, теперь редактируется через UI. Часть редизайна админки (Фаза 5). См. [admin-z-global.md](admin-z-global.md).

## 1. Типы встреч (`/admin/content/meeting-types`)

Раньше — enum `MeetingType` хардкод в коде. Теперь — БД-таблица `MeetingType` с FK на `PromptTemplate` (через `reportPromptKey`).

```prisma
model MeetingType {
  id              String   @id        // "interview", "discovery", "1to1", ...
  displayName     String
  description     String?
  icon            String?
  reportPromptKey String?             // FK на PromptTemplate (источник промпта AI-отчёта)
  isActive        Boolean  @default(true)
  sortOrder       Int      @default(0)
  updatedBy       String?
  updatedAt       DateTime @updatedAt
}
```

UI:
- Список 9 типов MVP с сортировкой (`sortOrder`).
- Карточка типа — `AdminTabs`:
  - **Основное** — name / description / icon / sortOrder / isActive.
  - **AI-отчёт** — выбор `PromptTemplate.key` (FK).
  - **Использование** — сколько встреч этого типа за неделю/месяц (read-only).

⚠ **Миграция существующих Meeting-сущностей с enum → MeetingType.id** — отдельным ТЗ. В Фазе 5 UI показывает оба источника (legacy enum + новые типы), миграция FK ещё не сделана.

## 2. Email-шаблоны (`/admin/content/emails`)

Раньше — [backend/src/modules/mail/mail.templates.ts](backend/src/modules/mail/mail.templates.ts), правка через PR. Теперь — БД-таблица + bootstrap-sync.

```prisma
model EmailTemplate {
  key         String   @id           // "invite_github_style"
  subject     String
  body        String   @db.Text      // Handlebars plain text
  htmlBody    String?  @db.Text
  variables   Json                   // { "name": "имя получателя", ... }
  category    String                 // "transactional" | "marketing" | "system"
  updatedBy   String?
  updatedAt   DateTime @updatedAt
}
```

**Bootstrap-sync:** [backend/scripts/seed-email-templates.ts](backend/scripts/seed-email-templates.ts) (safe-seed, skill `safe-seed-rules`) при первом старте копирует все шаблоны из `mail.templates.ts` в БД. После этого `MailService` читает только из БД через `EmailTemplateService`. Если шаблона нет в БД (race / сбой) — fallback на code-template.

**Валидация на save:**
- Handlebars-синтаксис парсится в AST через `handlebars.precompile()` — невалидный шаблон отклоняется.
- Все упомянутые `{{переменные}}` должны быть в декларированном списке `variables`.

**Тестовое отправление:** в UI кнопка «Отправить тестовое письмо на email» → бэк рендерит шаблон с фейковыми переменными → отправляет через SMTP. Только после успешной тест-отправки разрешается активация.

API:
```
GET    /api/v1/admin/content/email-templates
POST   /api/v1/admin/content/email-templates
POST   /api/v1/admin/content/email-templates/:key/test-send  { to }
```

## 3. System-messages (`/admin/content/system-messages`)

Глобальные баннеры / maintenance-уведомления / алерты — то, что показывается всем пользователям продукта.

```prisma
model SystemMessage {
  id          String   @id @default(cuid())
  type        String                 // "banner" | "maintenance" | "alert"
  severity    String                 // "info" | "warning" | "critical"
  body        String   @db.Text
  startsAt    DateTime?
  endsAt      DateTime?
  isActive    Boolean  @default(true)
  targetOrgs  String[]               // empty = все
  createdBy   String
  createdAt   DateTime @default(now())
  @@index([isActive, startsAt])
}
```

Сценарии:
- **maintenance** — баннер «Сегодня в 23:00 техработы 30 минут».
- **banner** — продуктовый анонс («Новый раздел Recognition»).
- **alert critical** — «Платёжный провайдер недоступен — оплата временно невозможна».

UI на стороне frontend: компонент `<GlobalSystemBanner />` в `AppShell` подтягивает активные сообщения по `SWR` 60s, рендерит в порядке severity (critical > warning > info).

## 4. Global-channels (`/admin/content/global-channels`)

Каталог встроенных каналов коммуникации (in_app / email / telegram / max), доступных для подписок в `ChannelService`. До Фазы 5 — приходилось править через seed. Теперь — через UI.

Каждый канал имеет `kind`, `isEnabled`, `dataClass`, `defaultRoutingRules`. Подробнее — [conversational-channels.md](conversational-channels.md).

## 5. Глоссарий и UI-строки (`/admin/content/copy`)

Все локализуемые UI-строки админки и пользовательского интерфейса. Используется ICP-копирайтером Z для правки текстов без редеплоя.

Ключи — иерархические (`auth.login.title`, `dashboard.empty.cta`). UI — таблица с фильтром по разделу, inline-редактирование, history.

Применяется через SWR на стороне фронта (см. `useCopyString(key, fallback)`).

⚠ Memory `feedback_admin_ui_russian_only` + `feedback_marketing_content_russian` — в любом редактируемом UI-тексте не должно быть английских слов (кроме брендов).

## Связанные

- [admin-z-global.md](admin-z-global.md) — каркас.
- [admin-settings.md](admin-settings.md) — динамические настройки (не контент).
- [conversational-channels.md](conversational-channels.md) — каналы коммуникации (продуктовый слой над `global-channels`).
- [mail-templates / mail.templates.ts](backend/src/modules/mail/mail.templates.ts) — fallback для email-шаблонов.
