# Установка Claude Code инфраструктуры на новый проект

Выжимка того, что подключено в Crossmark: skills, MCP-серверы, хуки, permissions. Пройди по разделам по порядку — получишь идентичный сетап.

## 1. Структура

В Claude Code три уровня конфигурации:
- **User-global:** `~/.claude/` (на Windows — `C:\Users\<user>\.claude\`) — общие для всех проектов.
- **Project-local:** `<repo>/.claude/` — коммитятся в репозиторий, шерятся с командой.
- **MCP:** `<repo>/.mcp.json` — серверы протокола MCP.

В Crossmark всё лежит в **project-local** (кроме `model: opus` в user `settings.json`).

```
<repo>/
├── .claude/
│   ├── settings.json        # hooks + permissions
│   └── skills/              # 12 скиллов
│       ├── bulletproof/
│       ├── core-engineering-standards/
│       └── ...
├── .mcp.json                # playwright
└── CLAUDE.md                # инструкции проекта (главный файл)
```

## 2. Skills

Skill = папка с `SKILL.md` (frontmatter `name` + `description` обязательны). Чтобы установить — просто положи папку в `<repo>/.claude/skills/`.

### 2.1. Внешние скиллы (ссылка / лицензионный копипаст)

| Скилл | Источник | Действие |
|---|---|---|
| `bulletproof` | Автор Artemiy Miller (`@artemiimillier`), MIT, v5.0 (March 2026). Контакты в [bulletproof/SKILL.md](.claude/skills/bulletproof/SKILL.md) (Telegram, GitHub, email). Полный комплект: `SKILL.md` + `agents/` + `examples/` + `templates/` + `CHANGELOG.md` + `LICENSE` | Копируй папку целиком из текущего проекта (MIT разрешает) или возьми свежую версию у автора |
| `frontend-design` | Anthropic skills: https://github.com/anthropics/skills | Скачай из репо Anthropic (там же лицензия) |
| `skill-creator` | Anthropic skills: https://github.com/anthropics/skills | Скачай из репо Anthropic. Содержит `agents/`, `assets/`, `eval-viewer/`, `references/`, `scripts/` |

### 2.2. Crossmark-specific (копировать целиком, адаптировать под новый проект)

Все эти скиллы — одиночные `SKILL.md` без вложений. Полный текст каждого — в **Приложении A** ниже (раздел 10). Чтобы установить — создай папку `<repo>/.claude/skills/<имя>/SKILL.md` и положи туда соответствующий текст из приложения.

| Скилл | О чём | Что адаптировать на новом проекте |
|---|---|---|
| `core-engineering-standards` | Execution plan до кода, фазовая работа, минимальные изменения, команды сборки | Замени `bun` на твой пакет-менеджер, поправь команды сборки |
| `domain-business-context` | Бизнес-контекст продукта (proposals/offers, терминология) | Перепиши целиком под свой домен |
| `project-architecture-router` | Чтение second-brain, оценка impact изменений, навигация по модулям | Переименуй `second-brain/` если у тебя другая база знаний; перечисли свои домены |
| `nestjs-rules` | DTO-цепочки, FiltersDto, Swagger, транзакции через Prisma | Бери если стек NestJS+Prisma; иначе пропусти или замени на свой backend-stack |
| `frontend-rules` | Слои ApiDto→DomainModel→UiModel, единый apiClient, авторизация | Переписать под твой фронтенд (Next.js / Remix / др.) |
| `prisma-db-push-rules` | Только `db push`, никаких `migrate`, обновление кода после изменения моделей | Нужен только если используешь Prisma и стратегию db push |
| `safe-seed-rules` | Защита admin-edited данных, idempotent patches вместо mass sync | Адаптировать пути к seeds/scripts |
| `crossmark-ai-agent-rules` | Prompt registry, admin-editable prompts, BullMQ AI-jobs | Брать только если у тебя prompt registry с админкой; иначе не нужен |
| `strict-production-review-gate` | Production-oriented code review (auth, billing, idempotency, observability) | Можно брать почти как есть — правила универсальные |

**Универсальные (бери почти без правок):** `core-engineering-standards`, `strict-production-review-gate`.
**Под стек:** `nestjs-rules`, `frontend-rules`, `prisma-db-push-rules`, `safe-seed-rules`, `crossmark-ai-agent-rules`.
**Под домен/проект:** `domain-business-context`, `project-architecture-router`.

### 2.3. Built-in (поставляются с Claude Code, не надо ставить)

Эти всегда доступны как `/<name>`, отдельно ставить не нужно:
`update-config`, `keybindings-help`, `simplify`, `fewer-permission-prompts`, `loop`, `schedule`, `claude-api`, `init`, `review`, `security-review`.

## 3. MCP-серверы

Файл `<repo>/.mcp.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "@playwright/mcp@latest",
        "--browser", "chromium",
        "--headless",
        "--isolated"
      ]
    }
  }
}
```

- **playwright** — браузер для UI-тестов: https://github.com/microsoft/playwright-mcp
  Требует `npx` (Node.js). На Windows — установи Node 18+.

В Crossmark на скриншотах системы видно ещё подключённые `Gmail`, `Google Calendar`, `Google Drive` через `mcp__claude_ai_*` — это user-level MCP, ставятся через панель Claude Code (`/mcp`), не через `.mcp.json`. Если они нужны — подключай вручную в новом проекте через тот же интерфейс.

## 4. Hooks (`.claude/settings.json`)

Два хука: `PreToolUse` (блок опасных Bash-команд) и `Stop` (LLM-судья качества + ворнинг про забытый second-brain).

Полный файл — копируй из [.claude/settings.json](.claude/settings.json). Что в нём:

- **PreToolUse / Bash блок:** блокирует `git push` в `main|master`, `rm -rf /`, `DROP TABLE`. Bash-скрипт через `jq`. Требует `bash` + `jq` в `PATH` (Git Bash на Windows подходит).
- **Stop / prompt:** LLM-судья смотрит финальный ответ и решает — вернуть агента дорабатывать или принять. Содержит логику авто-аппрува для информационных запросов и для случаев, когда агент задал вопрос юзеру.
- **Stop / command:** проверяет, что если за 5 мин был коммит в `backend/src/` или `frontend/src/services/` или `*.prisma`, то соответствующие файлы в `second-brain/` тоже обновлены. Crossmark-specific — выкинуть или переписать под свою базу знаний.

**Что переделать на новом проекте:**
- Stop/command: замени пути `backend/src`, `frontend/src/services`, `second-brain/02_architecture/...` на свои или удали блок целиком.
- Stop/prompt: универсален, можно оставить как есть.
- PreToolUse: универсален.

## 5. Permissions (`.claude/settings.json` → `permissions.deny`)

```
Bash(rm -rf *), Bash(rm -r /*), Bash(find * -delete)
Bash(curl *$* / curl *${* / wget *$* / wget *${*)   # блок инъекций через переменные
Bash(cat *.env / cat .env* / cat */.env* / cat */credentials* / cat */secrets*)
Read(**/.env, **/.env.*, **/credentials.json, **/credentials.yml, **/secrets.json, **/secrets.yml)
Read(**/*.pem, **/*.key, **/*.secret)
```

Универсально, можно копировать как есть в новый проект — это базовая защита от утечки секретов и случайного удаления.

## 6. CLAUDE.md (главный документ проекта)

Не «инструмент», но без него скиллы не складываются в систему. Crossmark-CLAUDE.md закрывает:
- Карта проекта (где second-brain, где plans).
- Стек.
- Триггеры завершения работы (рефлексия, обновление second-brain).
- Правила git (что коммитить, push с подтверждением).
- Правила миграций (SQL руками на проде, не в репо).
- Большая таблица «изменён файл → команда sync/patch» для прод-деплоя.

На новом проекте сделай такой же `CLAUDE.md` в корне. Сгенерировать болванку — `/init`.

## 7. User-global (опционально)

В `C:\Users\<user>\.claude\settings.json`:
```json
{ "model": "opus" }
```
Дефолтная модель для всех проектов. Не критично — переопределяется через `/model`.

Auto-memory (`~/.claude/projects/<slug>/memory/`) — наполняется автоматически по ходу работы, переносить руками не надо.

## 8. Шпаргалка установки на новый проект

```bash
# 1. В корне нового репо
mkdir -p .claude/skills

# 2. Скопировать project-local конфиг
cp <crossmark>/.claude/settings.json .claude/settings.json
cp <crossmark>/.mcp.json .mcp.json

# 3. Скопировать нужные скиллы (выбери свой набор из таблицы 2.2)
cp -r <crossmark>/.claude/skills/bulletproof .claude/skills/
cp -r <crossmark>/.claude/skills/core-engineering-standards .claude/skills/
cp -r <crossmark>/.claude/skills/strict-production-review-gate .claude/skills/
# ...и т.д. под стек

# 4. Anthropic-скиллы из официального репо
git clone https://github.com/anthropics/skills /tmp/anthropic-skills
cp -r /tmp/anthropic-skills/skill-creator .claude/skills/
cp -r /tmp/anthropic-skills/frontend-design .claude/skills/

# 5. Адаптировать settings.json (Stop/command — пути к second-brain)
# 6. Адаптировать каждый скопированный SKILL.md под новый стек/домен
# 7. /init — создать CLAUDE.md
# 8. Запустить Claude Code в проекте → /mcp проверить playwright
```

## 9. Чек-лист после установки

- [ ] `<repo>/.claude/skills/` — папки на месте, в каждой `SKILL.md` с frontmatter
- [ ] `<repo>/.claude/settings.json` — hooks работают (попробуй `git push origin main` — должно блокироваться)
- [ ] `<repo>/.mcp.json` — `/mcp` показывает `playwright` connected
- [ ] `<repo>/CLAUDE.md` — есть, обновлён под текущий проект
- [ ] Открыл новую сессию Claude Code — в system-reminder видно список доступных скиллов

---

## 10. Приложение A — Crossmark-specific SKILL.md (полный текст)

Каждый блок ниже — содержимое одного `SKILL.md`. Создай файл `<repo>/.claude/skills/<имя>/SKILL.md` и скопируй туда содержимое из соответствующего блока (без обрамляющих ` ``` `).

### A.1. core-engineering-standards/SKILL.md

`````markdown
---
name: core-engineering-standards
description: Инженерные стандарты проекта Crossmark: execution plan перед кодом, минимальные безопасные изменения, фазовая работа, команды сборки через bun. Используй этот скилл при ЛЮБОЙ нетривиальной задаче — до начала реализации, при выборе подхода, при проверке сборки. Обязателен перед рефакторингом, добавлением фич, изменением архитектуры. Не пропускай — даже "маленькие" задачи часто оказываются больше, чем кажутся.
---

# Crossmark: инженерные стандарты

## Перед тем как писать код

### Execution plan для нетривиальных задач

Для любой задачи, которая не решается за один очевидный шаг — сначала план, потом код.

Execution plan — это короткий список шагов (3–7 пунктов) с указанием:
- Что именно меняется (файлы, модули, эндпоинты)
- В каком порядке
- Какие зависимости между шагами

Показывай план пользователю до начала реализации. Это позволяет поймать неверные предположения до того, как они превратятся в код.

### Минимальные безопасные изменения

Предпочитай изменения, которые:
- Меняют только то, что требует задача
- Не трогают рабочую бизнес-логику без явной необходимости
- Не переписывают модуль целиком ради одного исправления

Широкий рефакторинг без задачи — красный флаг. Если видишь что-то "плохое" рядом — зафиксируй в комментарии или second-brain, но не трогай без согласования.

### Явные предположения

Если делаешь предположение о поведении системы, API, бизнес-логике — проговори его явно перед тем, как действовать. Скрытые предположения — главный источник трудноотлавливаемых багов.

### Фазовая работа для medium/large задач

Если задача затрагивает 3+ файла, несколько модулей, или требует изменения схемы БД — разбивай на фазы:

```
Фаза 1: [что делаем] — [почему именно это первым]
Фаза 2: [что делаем] — [зависит от фазы 1]
...
```

Каждая фаза должна оставлять систему в рабочем состоянии.

---

## Проверка сборки

### Package manager

**Всегда `bun`, никогда `npm` или `npx`.**

```bash
# Правильно
bun install
bun run build
bunx tsc --noEmit
bunx prisma db push

# Неправильно — НЕ использовать
npm install
npx tsc
npx prisma
```

### Команды проверки

| Что проверяем | Команда |
|---------------|---------|
| Backend typecheck | `cd backend && bunx tsc --noEmit` |
| Backend build (prod-like) | `cd backend && bun run build` |
| Frontend typecheck | `cd frontend && bun run typecheck` |
| Frontend build (prod-like) | `cd frontend && bun run build` |

### Когда запускать

- Изменения только в backend → проверяй backend
- Изменения только в frontend → проверяй frontend
- Изменения затрагивают оба → проверяй оба

Не сообщай о завершении задачи, если сборка не прошла.

---

## Работа с second-brain и plans

- Любая новая фича → план в `plans/` до начала работы
- Изменение бизнес-логики → обновление `second-brain/`
- Новый модуль/эндпоинт → заметка в `second-brain/01_projects/`
- Изменение схемы Prisma → обновление `second-brain/02_architecture/data-model.md`

Typo, стили, рефакторинг без изменения логики — в second-brain не фиксируются.

---

## Чеклист перед завершением задачи

- [ ] Execution plan был согласован (для нетривиальных задач)
- [ ] Изменения минимальны и не задевают лишнее
- [ ] Все предположения проговорены
- [ ] Сборка прошла без ошибок
- [ ] second-brain обновлён (если изменилась логика)
- [ ] Plan обновлён (фазы отмечены)
`````

### A.2. domain-business-context/SKILL.md

`````markdown
---
name: domain-business-context
description: Бизнес-контекст платформы Crossmark: правила разделения outbound proposals и inbound offers, продуктовые приоритеты, терминология. Используй этот скилл ВСЕГДА, когда задача касается proposals, offers, партнёрств, кросс-маркетинга, inbox-воркфлоу, статусов сделок, аналитики по предложениям, или когда нужно уточнить бизнес-смысл любой фичи в Crossmark. Не пропускай, даже если задача кажется чисто технической — бизнес-контекст влияет на naming, API-контракты и логику UI.
---

# Crossmark: бизнес-контекст

## Что такое Crossmark

Crossmark — AI-powered платформа для partnership и cross-marketing. Компании находят друг друга, договариваются о совместных активностях (коллаборациях, совместных рекламных кампаниях, обменах аудиторией) и отслеживают результаты.

## Ключевое разделение: Outbound vs Inbound

Это самое важное концептуальное разделение в продукте. Смешивать их — критическая ошибка.

### Outbound proposals
- **Кто создаёт:** компания A
- **Кому отправляется:** компании B (и другим)
- **Кто отслеживает:** компания A — как инициатор
- **Статусы:** с позиции отправителя (sent, viewed, accepted, rejected, withdrawn)
- **Workflow:** создание → отправка → ожидание ответа → переговоры → закрытие
- **В UI:** раздел "Мои предложения", "Исходящие", таблицы с фильтрами по статусу отправленного

### Inbound offers
- **Откуда приходит:** от других компаний (компания B отправила компании A)
- **Кто обрабатывает:** компания A — как получатель
- **Кто отслеживает:** компания A — с позиции получателя
- **Статусы:** с позиции получателя (new, reviewing, accepted, declined, expired)
- **Workflow:** inbox → просмотр → решение → ответ
- **В UI:** раздел "Входящие предложения", inbox-интерфейс с нотификациями

### Где сохранять разделение

| Слой | Правило |
|------|---------|
| Entities / DB | Отдельные таблицы или чёткий `direction` enum |
| API | Разные эндпоинты: `/proposals` (outbound) vs `/offers` (inbound) |
| Screens | Разные страницы, разные компоненты |
| Filters | Фильтры по статусам не пересекаются |
| Analytics | Метрики считаются раздельно |
| UI wording | "Отправить предложение" vs "Ответить на предложение" |

## Продуктовые приоритеты

При принятии любого решения — дизайнерского, технического, UX — проверяй по этому порядку:

1. **Скорость активации** — пользователь должен получить первую ценность как можно быстрее. Убирай лишние шаги.
2. **Понятная ценность** — пользователь должен в любой момент понимать, что он получает от платформы.
3. **Измеримый результат** — каждая фича должна давать что-то, что можно посчитать (партнёрства, охват, конверсия).
4. **Меньше ручной работы менеджеров** — AI должен автоматизировать рутину: матчинг, черновики писем, напоминания.

## Терминология (не менять без причины)

| Термин | Смысл |
|--------|-------|
| Proposal | Исходящее предложение партнёрства |
| Offer | Входящее предложение от другой компании |
| Match | AI-рекомендация потенциального партнёра |
| Brief | Описание компании/кампании для матчинга |
| Campaign | Совместная маркетинговая активность |
| Cabinet | Личный кабинет пользователя |

## Как применять

- Перед добавлением нового поля или эндпоинта — проверь, к чему он относится: outbound или inbound?
- Если термин в коде не совпадает с терминологией выше — это tech debt, фиксировать в second-brain.
- При проектировании нового экрана — сначала определи, это outbound-воркфлоу или inbound-воркфлоу.
`````

### A.3. project-architecture-router/SKILL.md

`````markdown
---
name: project-architecture-router
description: Навигация по архитектуре Crossmark и оценка impact изменений: чтение second-brain, формирование impact list, определение затронутых слоёв. Используй этот скилл ПЕРЕД любым изменением, затрагивающим архитектуру, API-контракты, схему БД, очереди, cron-задачи, AI pipelines, или несколько доменов одновременно. Также используй при вопросах "где найти X", "что затронет изменение Y", "как устроен модуль Z".
---

# Crossmark: навигация по архитектуре

## Точки входа в архитектурную документацию

```
second-brain/
├── index.md                    ← общая карта, читай первым
├── 01_projects/                ← заметки по каждому модулю/фиче
│   ├── frontend-pages.md
│   ├── frontend-api-layer.md
│   ├── frontend-contexts-hooks.md
│   └── <module>.md
├── 02_architecture/
│   ├── module-map.md           ← карта всех backend-модулей
│   └── data-model.md           ← схема БД
├── 03_bugs/                    ← разборы сложных багов
└── 05_история/                 ← рефлексия по итогам сессий
```

---

## Протокол перед изменением

Для задач, затрагивающих архитектуру или несколько модулей:

### Шаг 1: Определи bounded context

Прочитай `second-brain/index.md` и найди, к какому домену относится задача:

| Домен | Что включает |
|-------|-------------|
| `matching` | AI-матчинг, ранжирование партнёров, рекомендации |
| `proposals` | Outbound proposals, их lifecycle |
| `offers` | Inbound offers, inbox workflow |
| `campaigns` | Совместные маркетинговые активности |
| `brief` | Брифы компаний для матчинга |
| `blog` | AI-генерация контента |
| `billing` | Тарифы, план-лимиты, платежи |
| `admin` | Управление платформой, модерация |
| `notifications` | Email, in-app уведомления |
| `auth` | Авторизация, роли, сессии |

### Шаг 2: Прочитай domain README

Для найденного домена прочитай соответствующий файл из `second-brain/01_projects/`.

### Шаг 3: Сформируй impact list

Перед началом правок составь список того, что будет затронуто:

```
Impact list для задачи: <название>

Прямые изменения:
- backend/src/proposals/proposals.service.ts
- backend/src/proposals/dto/create-proposal.dto.ts

Косвенные зависимости:
- frontend/src/pages/ProposalsPage — использует ProposalResponseDto
- notifications — слушает proposal.created event
- analytics — считает метрики по proposals

Затронутые слои:
[x] backend API
[x] frontend UI
[ ] DB schema
[ ] BullMQ queue
[ ] cron
[ ] AI pipeline
[ ] analytics
```

---

## Карта слоёв и их зависимости

```
HTTP Request
    ↓
Controller (роутинг, validation)
    ↓
Service (бизнес-логика)
    ↓
Prisma (DB) + EventEmitter (события)
    ↓
BullMQ Jobs (AI, email, webhooks)
    ↓
Workers (AI agents, notifiers)
```

Изменение в нижних слоях каскадит вверх. Изменение схемы БД → нужно проверить сервисы, DTO, frontend API layer.

---

## Когда обновлять архитектурную документацию

Обновляй `second-brain/` после изменения:

| Что изменилось | Что обновить |
|----------------|-------------|
| Новый API эндпоинт | `second-brain/01_projects/<module>.md` |
| Новая таблица или поле | `second-brain/02_architecture/data-model.md` |
| Новый модуль | `second-brain/02_architecture/module-map.md` + новый файл в `01_projects/` |
| Новая фоновая задача | `second-brain/01_projects/<module>.md` |
| Изменение бизнес-логики | `second-brain/01_projects/<module>.md` |
| Удаление модуля | Удалить ссылки во всех файлах second-brain |

**Не обновляй second-brain** при: typo, стили, рефакторинг без изменения логики.

---

## Навигация по backend-модулям

Карта всех модулей — в `second-brain/02_architecture/module-map.md`.

Структура каждого модуля:
```
backend/src/<module>/
├── <module>.module.ts
├── <module>.controller.ts
├── <module>.service.ts
├── dto/
│   ├── create-<model>.dto.ts
│   ├── update-<model>.dto.ts
│   └── <model>-response.dto.ts
└── <module>.types.ts
```

---

## Навигация по frontend

| Что ищешь | Где смотреть |
|-----------|-------------|
| Страницы кабинета | `second-brain/01_projects/frontend-pages.md` |
| API-интеграции | `second-brain/01_projects/frontend-api-layer.md` |
| Контексты и хуки | `second-brain/01_projects/frontend-contexts-hooks.md` |
| Точки входа | `frontend/src/main.tsx` (клиент), `frontend/src/entry-server.tsx` (SSR) |

---

## Проверка соседних доменов

После формирования impact list — проверь соседей:

- **proposals** → смотри **offers** (общая концепция), **notifications** (события), **analytics**
- **matching** → смотри **brief** (входные данные), **proposals** (результат матчинга)
- **billing** → смотри **plan-limits** (лимиты), все модули с платными фичами
- **auth** → смотри все модули с guards и role checks
`````

### A.4. nestjs-rules/SKILL.md

`````markdown
---
name: nestjs-rules
description: Стандарты NestJS backend-разработки Crossmark: DTO-цепочки, FiltersDto, контроллеры без бизнес-логики, Swagger, транзакции через Prisma, логирование, события. Используй этот скилл при создании или рефакторинге ЛЮБОГО backend-кода — модулей, сервисов, контроллеров, DTO, guards, фильтров. Обязателен при добавлении нового эндпоинта или изменении существующего API.
---

# Crossmark: стандарты NestJS backend

## DTO-цепочки

Каждый ресурс имеет иерархию DTO. Не создавай монолитные DTO — разделяй по назначению.

```typescript
// Базовый — общие поля
export class BaseProposalDto {
  @IsString()
  title: string;

  @IsString()
  description: string;
}

// Создание
export class CreateProposalDto extends BaseProposalDto {
  @IsUUID()
  targetCompanyId: string;
}

// Обновление (все поля опциональные)
export class UpdateProposalDto extends PartialType(BaseProposalDto) {}

// Ответ (включает служебные поля)
export class ProposalResponseDto extends BaseProposalDto {
  id: string;
  status: ProposalStatus;
  createdAt: Date;
  updatedAt: Date;
}
```

## FiltersDto для пагинации и поиска

```typescript
export class ProposalsFiltersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ProposalStatus)
  status?: ProposalStatus;
}
```

Всегда возвращай метаданные пагинации:

```typescript
interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

---

## Контроллеры — только роутинг

Контроллер не содержит бизнес-логику. Только:
- Декораторы роутинга и Swagger
- Валидация входящих DTO (через `ValidationPipe`)
- Вызов сервиса
- Возврат результата

```typescript
@Controller('proposals')
@UseGuards(JwtAuthGuard)
@ApiTags('proposals')
export class ProposalsController {
  constructor(private readonly proposalsService: ProposalsService) {}

  @Post()
  @ApiOperation({ summary: 'Create proposal' })
  @ApiResponse({ type: ProposalResponseDto })
  create(
    @Body() dto: CreateProposalDto,
    @CurrentUser() user: AuthUser,
  ): Promise<ProposalResponseDto> {
    return this.proposalsService.create(dto, user.companyId);
  }
}
```

---

## Swagger декораторы

Каждый публичный эндпоинт должен иметь:

```typescript
@ApiOperation({ summary: 'Краткое описание' })
@ApiResponse({ status: 200, type: ResponseDto })
@ApiResponse({ status: 400, description: 'Validation error' })
@ApiResponse({ status: 403, description: 'Forbidden' })
```

DTO-классы должны иметь `@ApiProperty()` на каждом поле.

---

## Сервисы — бизнес-логика

Сервис содержит всю бизнес-логику. Правила:

- Один публичный метод = одна операция
- Проверяй ownership перед любой мутацией
- Кидай HTTP-исключения через `HttpException` / `NotFoundException` / `ForbiddenException`
- Не возвращай Prisma-модели напрямую — маппи в ResponseDto

```typescript
async findById(id: string, companyId: string): Promise<ProposalResponseDto> {
  const proposal = await this.prisma.proposal.findUnique({ where: { id } });

  if (!proposal) throw new NotFoundException('Proposal not found');
  if (proposal.companyId !== companyId) throw new ForbiddenException();

  return this.toResponseDto(proposal);
}
```

---

## Транзакции через Prisma

Операции, затрагивающие несколько таблиц — всегда в транзакции:

```typescript
await this.prisma.$transaction(async (tx) => {
  const proposal = await tx.proposal.create({ data: { ... } });
  await tx.notification.create({ data: { proposalId: proposal.id, ... } });
  await tx.activityLog.create({ data: { ... } });
});
```

Не используй несколько последовательных `this.prisma.*` без транзакции там, где нужна атомарность.

---

## Логирование

Через `Logger` из NestJS (или `SystemLoggerService`):

```typescript
private readonly logger = new Logger(ProposalsService.name);

async create(dto: CreateProposalDto): Promise<ProposalResponseDto> {
  this.logger.log(`Creating proposal for company ${dto.targetCompanyId}`);
  try {
    // ...
  } catch (error) {
    this.logger.error('Failed to create proposal', error.stack);
    throw error;
  }
}
```

Логируй: старт критических операций, ошибки с stack trace, бизнес-события.

---

## События через EventEmitter2

Не вызывай side effects напрямую из сервиса. Испускай события:

```typescript
this.eventEmitter.emit('proposal.created', {
  proposalId: proposal.id,
  companyId: proposal.companyId,
});
```

Подписчики (listeners) обрабатывают нотификации, email, аналитику.

---

## AI-задачи — только через BullMQ

Никакого синхронного вызова AI из HTTP-хендлера. Только очередь:

```typescript
// Правильно — добавить в очередь
await this.aiQueue.add('generate-brief', { companyId }, { attempts: 3 });

// Неправильно — прямой вызов из сервиса
const result = await this.anthropic.messages.create({ ... }); // ← ЗАПРЕЩЕНО
```

---

## Лимиты по тарифам

Всегда через `plan-limits`, никогда хардкодом:

```typescript
// Правильно
const limit = await this.planLimits.get(companyId, 'proposals_per_month');
if (currentCount >= limit) throw new ForbiddenException('Plan limit reached');

// Неправильно
if (currentCount >= 10) throw new ForbiddenException(); // ← ЗАПРЕЩЕНО
```

---

## Чеклист нового модуля

- [ ] DTO-цепочка: Base → Create → Update → Response
- [ ] FiltersDto с пагинацией
- [ ] Контроллер — только роутинг, без логики
- [ ] Swagger-декораторы на всех эндпоинтах
- [ ] Ownership-проверка в сервисе
- [ ] Транзакции там, где нужна атомарность
- [ ] Логирование критических операций
- [ ] События вместо прямых side effects
- [ ] AI через BullMQ, не синхронно
- [ ] Лимиты через plan-limits
`````

### A.5. frontend-rules/SKILL.md

`````markdown
---
name: frontend-rules
description: Стандарты фронтенда Crossmark: слои ApiDto→DomainModel→UiModel, единый apiClient, архитектура компонентов, UX-состояния, авторизация и роли. Используй этот скилл при создании или рефакторинге ЛЮБОГО UI-кода — страниц, компонентов, форм, таблиц, фильтров, API-интеграций, хуков, контекстов. Обязателен перед правкой frontend/, особенно если меняется API-слой, роутинг или логика доступа.
---

# Crossmark: стандарты фронтенда

## Архитектура данных

### Три слоя, строго по порядку

```
API (backend) → ApiDto → DomainModel → UiModel → Компонент
```

| Слой | Что это | Пример |
|------|---------|--------|
| `ApiDto` | Сырые данные от бэкенда (snake_case, числа-строки, nullable) | `{ company_id: "uuid", created_at: "2024-01-01" }` |
| `DomainModel` | Типизированная доменная модель (camelCase, Date, enum) | `{ companyId: string, createdAt: Date }` |
| `UiModel` | Данные, готовые для отображения (строки, флаги, метки) | `{ companyName: string, isNew: boolean, statusLabel: string }` |

Не передавай `ApiDto` напрямую в компонент. Не смешивай слои.

### Единый apiClient

Все HTTP-запросы — только через `apiClient` (axios instance с baseURL, interceptors, auth token). Не создавай отдельные axios instances.

### Единый формат ошибок

```typescript
interface ApiError {
  message: string;
  code?: string;
  statusCode: number;
}
```

Обрабатывай ошибки в interceptor, не в каждом компоненте отдельно.

---

## Архитектура компонентов

### Разделение ответственности

| Тип | Что делает |
|-----|-----------|
| Page-компонент | Роутинг, layout, оркестрация дочерних |
| Container-компонент | Получение данных, state management |
| UI-компонент | Только рендер, получает всё через props |

Бизнес-логика — в хуках, не в компонентах.

### Server state vs UI state

- **Server state** (данные с бэкенда) → через React Query / SWR / кастомные хуки с fetching
- **UI state** (открыт ли модал, текущий шаг формы) → useState / useReducer

Не кладистыйserver state в localStorage или глобальный контекст без необходимости.

---

## UX-состояния (обязательные)

Каждый компонент, работающий с данными, должен обрабатывать все четыре состояния:

```tsx
if (isLoading) return <Skeleton />;
if (error) return <ErrorState message={error.message} onRetry={refetch} />;
if (!data || data.length === 0) return <EmptyState />;
return <DataView data={data} />;
```

Не оставляй пустой экран вместо loading state. Не показывай сырую ошибку пользователю.

---

## Навигация в кабинете

Навигация в кабинете — через query-параметр `?page=<PageId>`, **не через вложенные маршруты**.

```typescript
// Правильно
navigate(`?page=proposals`);
const page = searchParams.get('page');

// Неправильно
navigate('/cabinet/proposals');
```

---

## Авторизация и роли

### Провайдеры (порядок обёртки)
```
AuthProvider → ThemeProvider → NotificationProvider → BrowserRouter
```

### Защита маршрутов

| Компонент | Когда использовать |
|-----------|-------------------|
| `ProtectedRoute` | Любой авторизованный маршрут |
| `AdminRoute` | Только для ролей: `admin`, `marketer`, `partner_manager` |

Не проверяй роль вручную в компоненте — используй guard-компоненты.

### Правила доступа
- Проверяй роль перед рендером action-кнопок
- Скрывай UI-элементы для недоступных операций (не только блокируй)
- При попытке недозволенного действия — объясняй причину, не просто fail

---

## Формы

- Все формы — через React Hook Form + Zod
- Схема валидации — отдельный файл рядом с формой
- Submit — всегда через `handleSubmit`, с обработкой ошибок сервера
- Disabled состояние кнопки submit — пока форма submitting

---

## Стили

- CSS-переменные из `styles/design-tokens.css`
- Не хардкодить цвета, отступы, радиусы — только токены
- Не использовать inline styles для layout (только для динамических значений)

---

## Язык UI

**Весь user-facing текст — на русском.** Это касается label, placeholder, button, toast, breadcrumb, header, ошибки для пользователя, email-шаблонов, текстов внутри карточек/баннеров.

Если технический термин без английского теряет смысл и есть в речи команды (`SLA`, `KB`, `feature flag`, `synthetic`, `production`) — английский можно оставить, но при первом упоминании на странице давать русский эквивалент в скобках:
- `SLA breach (нарушение времени ответа)`
- `Synthetic KB (синтетическая база знаний)`
- `Feature flags (флаги функций)`

**Исключение** (НЕ переводить): технические идентификаторы, которые ровно так лежат в БД/коде/конфиге. Это env-имена (`SUPPORT_AI_ASSISTANT_ENABLED`), slug'и шаблонов (`support_conversation_opened`), JSON-payload поля, SQL-имена, имена prompt-keys (`support_main_agent_system`), agent-types в логах. Переводить их сломает поиск/мэппинг и запутает разработчика.

Не пускай в видимый UI английские пункты сайдбара, заголовки страниц или кнопки без русского эквивалента — даже если их быстро написал «черновиком». Тестировщик и пользователь увидят ровно эту строку.

---

## SSR

SSR работает только для публичных маршрутов (`/`, `/blog`, `/about` и подобных).
Кабинет и admin — **не рендерятся на сервере**.

Не добавляй SSR-зависимые вещи (window, document) без проверки `typeof window !== 'undefined'` или изоляции в client-only компонентах.

---

## Чеклист перед PR

- [ ] Слои данных разделены (ApiDto → DomainModel → UiModel)
- [ ] Все 4 UX-состояния обработаны
- [ ] Роли и доступы проверены
- [ ] Формы через RHF + Zod
- [ ] Стили только через токены
- [ ] Нет прямых вызовов axios вне apiClient
`````

### A.6. prisma-db-push-rules/SKILL.md

`````markdown
---
name: prisma-db-push-rules
description: Правила работы с Prisma и схемой БД в Crossmark: только db push, никаких migrate, обновление кода после изменения моделей. Используй этот скилл при ЛЮБОЙ задаче, где меняются таблицы, модели Prisma, enum, индексы, constraints, связи, или когда нужно применить изменения схемы. Обязателен если задача упоминает schema.prisma, миграции, или изменения структуры данных.
---

# Crossmark: правила Prisma и схемы БД

## Главное правило

**Источник истины — текущая схема БД и актуальный `schema.prisma`.**

Не используем файловые миграции. Применяем изменения напрямую через `db push`.

---

## Что НЕЛЬЗЯ делать

```bash
# ЗАПРЕЩЕНО — не использовать никогда
prisma migrate dev
prisma migrate deploy
prisma migrate reset
prisma migrate diff

# ЗАПРЕЩЕНО — не создавать и не редактировать
backend/prisma/migrations/
```

Если ты видишь папку `migrations/` — не трогай её, это исторический артефакт.

---

## Что НУЖНО делать

```bash
# Применить изменения схемы
cd backend && bunx prisma db push

# Обновить Prisma Client после изменения схемы
cd backend && bunx prisma generate

# Посмотреть текущую схему
cat backend/prisma/schema.prisma

# Открыть Prisma Studio для инспекции данных
cd backend && bunx prisma studio
```

---

## Workflow изменения схемы

### Шаг 1: Редактируй `schema.prisma`

```prisma
// backend/prisma/schema.prisma

model Proposal {
  id          String   @id @default(cuid())
  title       String
  status      ProposalStatus @default(DRAFT)
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([companyId])
  @@index([status])
}

enum ProposalStatus {
  DRAFT
  SENT
  ACCEPTED
  REJECTED
  WITHDRAWN
}
```

### Шаг 2: Примени через db push

```bash
cd backend && bunx prisma db push
```

При деструктивных изменениях (удаление поля, изменение типа) — Prisma предупредит. Подтверждай только если понимаешь последствия.

### Шаг 3: Обнови Prisma Client

```bash
cd backend && bunx prisma generate
```

### Шаг 4: Обнови связанный код

После изменения модели обязательно проверь и обнови:

| Что | Где |
|-----|-----|
| DTO | `backend/src/<module>/dto/` |
| Service (запросы) | `backend/src/<module>/<module>.service.ts` |
| Types | `backend/src/<module>/<module>.types.ts` |
| Frontend API types | `frontend/src/types/<domain>.ts` |
| second-brain | `second-brain/02_architecture/data-model.md` |

### Шаг 5: Проверь typecheck

```bash
cd backend && bunx tsc --noEmit
```

---

## Правила именования

| Сущность | Конвенция | Пример |
|----------|-----------|--------|
| Таблица (model) | PascalCase | `ProposalDraft` |
| Поле | camelCase | `targetCompanyId` |
| Enum | PascalCase | `ProposalStatus` |
| Enum value | SCREAMING_SNAKE | `SENT`, `IN_PROGRESS` |
| Индекс | `@@index([field])` | `@@index([companyId, status])` |
| Unique | `@@unique([...])` | `@@unique([companyId, targetId])` |

---

## Безопасные vs деструктивные изменения

### Безопасные (без потери данных)

- Добавить новое поле с default значением
- Добавить индекс
- Добавить новую модель
- Добавить новое значение в enum (в конец)
- Добавить опциональное поле (`String?`)

### Деструктивные (требуют осторожности)

- Удалить поле
- Переименовать поле (= удалить + создать)
- Изменить тип поля
- Удалить значение из enum
- Сделать поле обязательным (`String` вместо `String?`)

Для деструктивных изменений:
1. Убедись, что нет production-данных, которые сломаются
2. Если есть — сначала мигрируй данные через patch script
3. Потом применяй изменение схемы

---

## Работа с pgvector

Для векторных полей:

```prisma
model CompanyEmbedding {
  id        String  @id @default(cuid())
  companyId String  @unique
  embedding Unsupported("vector(1536)")?
  company   Company @relation(fields: [companyId], references: [id])
}
```

Создание индекса для similarity search — через raw SQL в patch script, не через schema.prisma.

---

## Чеклист после изменения схемы

- [ ] `bunx prisma db push` выполнен без ошибок
- [ ] `bunx prisma generate` выполнен
- [ ] DTO обновлены
- [ ] Сервисы обновлены
- [ ] `bunx tsc --noEmit` прошёл
- [ ] `second-brain/02_architecture/data-model.md` обновлён
`````

### A.7. safe-seed-rules/SKILL.md

`````markdown
---
name: safe-seed-rules
description: Правила безопасной работы с Prisma seeds, sync scripts и DB patch scripts в Crossmark: защита admin-edited данных, bun runtime, one-off patches вместо mass sync. Используй этот скилл при ЛЮБОЙ задаче, где нужно писать или редактировать seed.ts, seed-incremental.ts, seed-*.ts, скрипты в backend/scripts/, или любые DB-writing скрипты. Обязателен если задача касается промптов, email-шаблонов, pipeline plans, settings или других admin-editable конфигов.
---

# Crossmark: правила безопасной работы с seeds и DB scripts

## Главный принцип

**Admin-edited данные защищены от overwrite по умолчанию.**

Если запись в БД могла быть изменена через админку — никогда не перезаписывай её содержимое в скрипте без явной проверки.

---

## Типы скриптов и их назначение

| Скрипт | Назначение | Когда использовать |
|--------|-----------|-------------------|
| `seed.ts` | Bootstrap — первоначальное наполнение пустой БД | Только при первом запуске на новой БД |
| `seed-incremental.ts` | Добавление новых записей без overwrite | Регистрация новых ключей, новых конфигов |
| `seed-*.ts` | Специализированные seed'ы по доменам | Домен-специфичные bootstrap данные |
| `scripts/patches/` | One-off патчи для точечных изменений | Обновление конкретной записи в prod |
| `scripts/sync-*` | Mass sync с явным предупреждением | ТОЛЬКО если overwrite является целью |

---

## Runtime: только bun

```bash
# Правильно — через package.json scripts
cd backend && bun run seed
cd backend && bun run seed:incremental
cd backend && bun run patch:2024-01-15-update-ranker-prompt

# Неправильно — не использовать в prod
npx tsx backend/prisma/seed.ts
node backend/prisma/seed.ts
ts-node backend/prisma/seed.ts
```

Все скрипты должны быть прописаны в `backend/package.json`:

```json
{
  "scripts": {
    "seed": "bun prisma/seed.ts",
    "seed:incremental": "bun prisma/seed-incremental.ts",
    "patch:2024-01-15-update-ranker-prompt": "bun scripts/patches/2024-01-15-update-ranker-prompt.ts"
  }
}
```

---

## Защита admin-edited данных

### Паттерн безопасного upsert

```typescript
// Безопасно: регистрируем ключ, не трогаем content если он уже есть
await prisma.promptRegistry.upsert({
  where: { key: 'matching.ranker.score_partners' },
  create: {
    key: 'matching.ranker.score_partners',
    content: DEFAULT_CONTENT,   // только при создании
    isActive: true,
  },
  update: {
    // НЕ перезаписываем content — он мог быть изменён в админке
    // Обновляем только метаданные
    name: 'Partner matching ranker',
    variables: ['company_name', 'goal'],
  },
});
```

### Паттерн "только если не существует"

```typescript
const existing = await prisma.emailTemplate.findUnique({
  where: { key: 'proposal.accepted' }
});

if (!existing) {
  await prisma.emailTemplate.create({
    data: {
      key: 'proposal.accepted',
      subject: DEFAULT_SUBJECT,
      body: DEFAULT_BODY,
    }
  });
  console.log('Created email template: proposal.accepted');
} else {
  console.log('Skipped (already exists): proposal.accepted');
}
```

---

## One-off patch scripts

Для точечного изменения существующей записи — отдельный скрипт с защитами:

```typescript
// backend/scripts/patches/2024-01-15-update-ranker-prompt.ts

const NEW_CONTENT = `...новый текст промпта...`;
const EXPECTED_VERSION = 2;

const patch = async () => {
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.promptRegistry.findUnique({
      where: { key: 'matching.ranker.score_partners' }
    });

    if (!existing) {
      console.error('Record not found, skipping');
      return;
    }

    // Защита от повторного применения
    if (existing.version !== EXPECTED_VERSION) {
      console.log(`Version mismatch: expected ${EXPECTED_VERSION}, got ${existing.version}. Skipping.`);
      return;
    }

    await prisma.promptRegistry.update({
      where: { key: 'matching.ranker.score_partners' },
      data: {
        content: NEW_CONTENT,
        version: EXPECTED_VERSION + 1,
      }
    });

    console.log('Patch applied successfully');
  } finally {
    await prisma.$disconnect();
  }
};

patch().catch(console.error);
```

---

## Именование скриптов

| Тип | Шаблон | Пример |
|-----|--------|--------|
| Patch script | `YYYY-MM-DD-что-делает.ts` | `2024-01-15-update-ranker-prompt.ts` |
| Sync script | `sync-<domain>.ts` | `sync-email-templates.ts` |
| Seed domain | `seed-<domain>.ts` | `seed-plan-limits.ts` |

**Важно:** если скрипт может перезаписать данные — называй его `sync-*`, не `seed-*`. Название сигнализирует об опасности.

---

## seed.ts — только bootstrap

`backend/prisma/seed.ts` считается bootstrap-only:
- Запускается только на пустой БД
- Не должен содержать mass sync логику
- Не должен вызываться в production для обновления данных

Если нужно добавить новые записи к существующей БД — используй `seed-incremental.ts` или patch script.

---

## Чеклист перед написанием DB-writing скрипта

- [ ] Какой тип скрипта нужен? (bootstrap / incremental / one-off patch / sync)
- [ ] Admin-edited поля защищены от overwrite?
- [ ] Скрипт идемпотентен (повторный запуск не сломает данные)?
- [ ] Версионная защита есть (для patch scripts)?
- [ ] Скрипт добавлен в `backend/package.json` scripts?
- [ ] Используется `bun`, не `npx tsx`?
- [ ] Название отражает опасность (sync vs seed)?
`````

### A.8. crossmark-ai-agent-rules/SKILL.md

`````markdown
---
name: crossmark-ai-agent-rules
description: Правила AI-агентов и prompt infrastructure в Crossmark: prompt registry, admin-editable prompts, code fallback, patch scripts для безопасной доставки. Используй этот скилл при создании нового AI-агента, добавлении prompt key, изменении существующего промпта, настройке prompt registry, написании seed/patch для промптов. Обязателен если задача касается Anthropic Claude SDK, BullMQ AI-jobs, workers, или prompt management.
---

# Crossmark: правила AI-агентов и prompt infrastructure

## Главное правило

Если промпт не является одноразовым локальным экспериментом — он должен:
1. Быть доступен из БД (через prompt registry)
2. Редактироваться через админку без деплоя
3. Иметь кодовый fallback (на случай, если запись в БД отсутствует)
4. Иметь безопасный путь доставки в production без массового overwrite

---

## Prompt Registry

### Структура записи

```typescript
interface PromptRegistryEntry {
  key: string;           // уникальный ключ, snake_case
  name: string;          // человекочитаемое название
  description: string;   // для чего используется
  content: string;       // текст промпта (admin-editable)
  variables: string[];   // переменные подстановки: ['company_name', 'goal']
  version: number;       // инкрементируется при изменении
  isActive: boolean;
}
```

### Naming convention для ключей

```
<домен>.<агент>.<цель>

Примеры:
matching.ranker.score_partners
brief.generator.create_brief
proposal.drafter.email_subject
blog.writer.article_outline
```

### Code fallback

Каждый агент должен иметь fallback прямо в коде:

```typescript
async getPrompt(key: string): Promise<string> {
  const dbPrompt = await this.promptRegistry.findByKey(key);
  if (dbPrompt?.isActive) return dbPrompt.content;

  // Fallback — промпт из кода
  return PROMPT_FALLBACKS[key] ?? throwMissingPromptError(key);
}

const PROMPT_FALLBACKS: Record<string, string> = {
  'matching.ranker.score_partners': `
    You are a partnership matching expert...
    Company: {{company_name}}
    Goal: {{goal}}
  `,
};
```

---

## Создание нового AI-агента

### Шаги

1. **Создай worker** в `backend/src/workers/<domain>/<agent>.worker.ts`
2. **Зарегистрируй job** в `backend/src/ai-jobs/`
3. **Добавь prompt key** в prompt registry (через patch script)
4. **Напиши fallback** в коде агента
5. **Зарегистрируй в baseline seed** (только если это core-агент)
6. **Добавь трейсинг** через `AiTraceService`

### Структура worker

```typescript
@Processor('ai-jobs')
export class MatchingRankerWorker extends WorkerHost {
  constructor(
    private readonly promptRegistry: PromptRegistryService,
    private readonly anthropic: AnthropicService,
    private readonly aiTrace: AiTraceService,
  ) { super(); }

  @Process('rank-partners')
  async process(job: Job<RankPartnersJobData>): Promise<void> {
    const prompt = await this.promptRegistry.get('matching.ranker.score_partners');
    const rendered = this.renderPrompt(prompt, job.data);

    const traceId = await this.aiTrace.start('rank-partners', job.data);
    try {
      const result = await this.anthropic.complete(rendered);
      await this.aiTrace.complete(traceId, result);
    } catch (error) {
      await this.aiTrace.fail(traceId, error);
      throw error;
    }
  }
}
```

---

## Доставка промптов в production

### Baseline (bootstrap) регистрация

Используй `backend/prisma/seed-incremental.ts` для регистрации новых ключей.

Правила:
- Проверяй существование перед вставкой (`upsert` с `skipDuplicates`)
- Не перезаписывай `content` если запись уже существует (она могла быть отредактирована в админке)

```typescript
await prisma.promptRegistry.upsert({
  where: { key: 'matching.ranker.score_partners' },
  create: {
    key: 'matching.ranker.score_partners',
    name: 'Partner matching ranker',
    content: DEFAULT_CONTENT,
    variables: ['company_name', 'goal'],
    isActive: true,
  },
  update: {
    // НЕ обновляем content — он мог быть изменён в админке
    name: 'Partner matching ranker',
    variables: ['company_name', 'goal'],
  },
});
```

### One-off patch script

Для точечных изменений существующих промптов — отдельный patch script в `backend/scripts/`:

```typescript
// backend/scripts/patches/2024-01-15-update-ranker-prompt.ts
const patch = async () => {
  const existing = await prisma.promptRegistry.findUnique({
    where: { key: 'matching.ranker.score_partners' }
  });

  // Только если версия соответствует ожидаемой
  if (existing?.version !== 2) {
    console.log('Skipping: unexpected version');
    return;
  }

  await prisma.promptRegistry.update({
    where: { key: 'matching.ranker.score_partners' },
    data: { content: NEW_CONTENT, version: 3 },
  });
};
```

Запускать через `backend/package.json` script, не через `npx tsx`.

---

## Трейсинг AI

Каждый AI-вызов должен трейситься через `AiTraceService`:

```typescript
const traceId = await this.aiTrace.start(jobName, inputData);
try {
  const result = await this.anthropic.complete(prompt);
  await this.aiTrace.complete(traceId, { tokens: result.usage, output: result.content });
} catch (error) {
  await this.aiTrace.fail(traceId, error);
  throw error;
}
```

Это нужно для: отладки качества промптов, мониторинга стоимости, анализа ошибок.

---

## Асинхронность — обязательно

Никакого синхронного вызова AI из HTTP-эндпоинта:

```typescript
// Правильно — через очередь
await this.bullQueue.add('generate-brief', { companyId }, {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
});

// Неправильно
const result = await this.anthropic.messages.create({ ... }); // ← из контроллера/сервиса
```

HTTP-хендлер возвращает `202 Accepted` + `jobId`. Клиент поллит статус или получает нотификацию.

---

## Чеклист нового AI-агента

- [ ] Worker в правильной директории
- [ ] Prompt key зарегистрирован (patch script или seed-incremental)
- [ ] Code fallback написан
- [ ] Upsert не перезаписывает admin-edited content
- [ ] AiTraceService подключён
- [ ] Job добавлен через BullMQ, не синхронный вызов
- [ ] Retry/backoff настроен
- [ ] Идемпотентность проверена (повторный запуск не создаёт дубли)
`````

### A.9. strict-production-review-gate/SKILL.md

`````markdown
---
name: strict-production-review-gate
description: Production-oriented code review для Crossmark: поиск критических багов, auth-дыр, рисков потери данных, некорректных переходов состояний, billing-проблем, идемпотентности, missing validation, observability gaps. Используй этот скилл при ЛЮБОМ code review, перед мержем любой фичи, при проверке PR, при аудите модуля. Запускай также самостоятельно перед отправкой изменений — не жди, пока попросят.
---

# Crossmark: production review gate

## Порядок проверки (строго сверху вниз)

Проверки идут от критического к минорному. Не переходи к следующему пункту, пока не завершил предыдущий.

### 1. Production-breaking logic bugs
- Логика, которая приведёт к неверному поведению в production прямо сейчас
- Race conditions, неверные условия, инвертированная логика
- Ошибки в цепочках статусов (например, proposal можно withdraw после того, как он already accepted)

### 2. Auth и access control
- Отсутствие проверки роли/ownership перед мутацией данных
- Эндпоинты без guard'ов
- Возможность одной компании видеть данные другой
- Отсутствие проверки `companyId` в запросах

### 3. Data corruption / data loss risks
- Операции без транзакций, где нужна атомарность
- Cascading deletes без явного намерения
- Overwrite данных без проверки существующего значения
- Отсутствие soft delete там, где нужен аудит

### 4. Incorrect state transitions
- Переходы состояний (proposal statuses, campaign stages) не через явный state machine
- Возможность перейти в недопустимое состояние напрямую через API
- Отсутствие валидации current state перед transition

### 5. Payment, referral, billing risks
- Двойное списание / двойное начисление
- Отсутствие idempotency key при платёжных операциях
- Referral/bonus начисляется без проверки условий

### 6. Integration retry и idempotency
- Внешние вызовы (email, webhook, AI) без retry-логики
- Операции, которые при повторном вызове создадут дублирование
- BullMQ jobs без проверки "уже выполнено"

### 7. Missing validation
- Отсутствие валидации на уровне DTO (class-validator)
- Поля, которые могут прийти undefined/null и сломать логику
- Отсутствие проверки business rules (например, нельзя отправить proposal самому себе)

### 8. Observability и logging gaps
- Критические операции без логирования через `SystemLoggerService`
- AI-вызовы без трейсинга через `AiTraceService`
- Ошибки, которые будут проглочены без trace

### 9. UX states, которые trap users
- Пользователь попадает в состояние, из которого нет выхода
- Отсутствие empty state, error state, loading state
- Action button, который ничего не делает при определённых условиях без объяснения

### 10. Style и cleanup
- Только после всего выше
- Неиспользуемые imports, console.log, закомментированный код
- Нарушения code style

---

## Формат вывода

### Структура ответа

```
## Critical issues
- [CRITICAL] <описание> — <file:line>
  Fix: <что именно исправить>

## Medium risks
- [MEDIUM] <описание> — <file:line>
  Fix: <что именно исправить>

## Minor issues
- [MINOR] <описание>

## Edge cases to verify
- <сценарий, который стоит проверить вручную>

## Merge verdict
BLOCK / APPROVE WITH FIXES / APPROVE
Reason: <одна строка>

## Residual risks (если APPROVE)
- <что осталось непроверенным или требует мониторинга после мержа>
```

### Если findings нет

Явно написать: "No critical findings." — и перечислить, что было проверено, и указать residual risks / testing gaps.

---

## Специфика Crossmark

При review в Crossmark дополнительно проверять:

- **Outbound/Inbound разделение:** proposals и offers не смешаны в одном запросе/экране?
- **Plan limits:** лимиты по тарифам идут через `plan-limits`, не хардкодятся?
- **AI jobs:** AI-вызовы асинхронные (через BullMQ), не синхронные из HTTP-хендлера?
- **Prisma:** изменения схемы через `db push`, не через migrate?
- **Seed safety:** seed-скрипты не перезапишут admin-edited данные?
`````
