---
дата: 2026-05-31
автор: Сергей + Claude (оркестратор Опус 4.7 + 6 sub-агентов)
теги: orchestration, ai-chat-quota, z-admin, route-groups, multi-agent
distilled: false
---

# Волна 1 — параллельная оркестрация двух ТЗ за одну сессию

## Что было поставлено

Два независимых ТЗ от 2026-05-31 параллельно, в одной сессии, оркестратором:

1. **z-admin standalone route group** (`plans/tz/2026-05-31-z-admin-standalone-route-group.md`) —
   frontend-only refactor: перенос `/admin/*` из `(authenticated)/admin/` в собственную
   route-группу `(admin)/admin/*` с новым `AdminAuthGuard` (без AppShell/EntitlementProvider/
   TourProvider/AssistantSidebar). 90 страниц переезжают физически.

2. **ai-chat-quota unified per-user** (`plans/tz/2026-05-31-ai-chat-quota-unified-per-user.md`) —
   backend новый модуль `ai-chat-quota` + интеграция в Concierge и Clones: единая
   per-user-per-day квота (50 для owner/admin/coo, 20 для остальных) с общим Redis-счётчиком,
   UI-эндпоинт `GET /me/ai-chat/quota`.

ТЗ не пересекаются по файлам — идеальные кандидаты на параллельный запуск.

## Как делал

### Архитектура оркестрации (6 под-агентов, 2 commit'а)

| Под-агент | Что | Параллельно с | Результат |
|---|---|---|---|
| **1A** | Создать `(admin)/layout.tsx` + `AdminAuthGuard.tsx` | 2A | ✅ Чисто |
| **2A** | ENV (3 переменные) + `RbacService.getMembershipRole` | 1A | ✅ Чисто, нашёл что Prisma-модель `Membership` (не `OrgMember` как в ТЗ) |
| **1B** | Move 24/43 items через `git mv` | 2B | ⚠️ Уперся в Windows file-lock (next dev держал handle) |
| **2B** | `AiChatQuotaService` + Module + spec (4/4 теста) | 1B | ✅ Чисто |
| **2C** | Concierge integration + 4 замены `assertRateLimit` в Clones + 4 spec'а под новый mock | 1B-cont (после убийства dev) | ✅ Чисто, расширил `ConciergeStreamEvent` полем `scope` |
| **1B-cont** | Доделать 19 move'ов + JSDoc + ремонт 40 импортов `AdminStateViews` на alias `@app/(admin)/admin/...` | 2D | ✅ 209 renames, typecheck зелёный |
| **2D** | Controller `GET /me/ai-chat/quota` + spec (3 теста) + second-brain (4 файла) + prod-deploy-log | 1B-cont | ✅ Развилка: `setGlobalPrefix` в `main.ts` отсутствует — взял проектный стиль `@Controller('api/v1/me/ai-chat')` |
| **1C-docs** | second-brain admin.md/frontend-pages.md/module-map.md + prod-deploy-log z-admin блок | (отдельной фазой) | ✅ Чисто |

Внутри каждого ТЗ фазы шли последовательно (1A → 1B → 1C; 2A → 2B → 2C → 2D), между ТЗ — параллельно где не было общих файлов.

### Один блокер на пути — Windows file lock

Frontend dev-server `next.exe` (PID 14860) держал handle на 19 поддиректориях `(authenticated)/admin/`,
`git mv` падал с Permission denied. Это **типичная Windows-проблема** при массовом move'е в
дереве, которое Next dev-сервер кэширует — на Linux/macOS таких блокировок нет.

Под-агент 1B остановился на 24/43, сэскалировал. Пользователь явно дал разрешение «убей next»;
после `taskkill /F /PID 14860` под-агент 1B-cont добил остаток.

### Найденные расхождения с ТЗ

1. **`frontend/middleware.ts` отсутствует** в проекте. ТЗ предполагал его править (Фаза 4).
   Решено: защита полностью клиентская через `AdminAuthGuard` — middleware был лишь UX-ускоритель.

2. **Prisma-модель называется `Membership`**, не `OrgMember` (это имя NestJS-модуля).
   `AiChatQuotaService.resolveLimit` использует `RbacService.getMembershipRole`, который
   корректно бьёт `prisma.membership.findUnique`.

3. **`@Controller('api/v1/...')` пишется полным путём**, `setGlobalPrefix` в `main.ts` нет.
   Под-агент 2D следует проектному стилю (как `ConciergeController` и `MeCloneAccessController`).

4. **`assertRateLimit` в `ClonesService` вызывался 4 раза**, ТЗ называл 2. Все 4 точки заменены
   на `aiChatQuota.tryConsume`, приватный метод удалён.

5. **`CONCIERGE_DAILY_MESSAGES_LIMIT`** читается через прямой `parseInt(process.env.X, 100)` в
   `typed-config.service.ts:1703` — это обход стандарта Z (никаких `process.env.*` прямо) И баг
   (второй аргумент `parseInt` — это radix, не default). Не наш scope в этой волне — оставлен
   как technical debt.

6. **`CLONE_ASK_PER_USER_PER_DAY`** оставлен как deprecated code-fallback (не удалён в этой волне)
   ради безопасного rollback. Удаление — отдельной микро-задачей после неделю в проде.

### Файлы документации

| Файл | Какие коммиты затронули |
|---|---|
| `docs/operations/prod-deploy-log.md` | Оба ТЗ написали блоки. Закоммичено в commit ТЗ №2 (`26a7ce5`) целиком. Упомянуто в commit-message. |
| `second-brain/02_architecture/module-map.md` | Оба ТЗ. Закоммичено в commit ТЗ №2 целиком. |
| `second-brain/01_projects/admin.md`, `frontend-pages.md` | Только ТЗ №1 → commit `deb8a8c`. |
| `second-brain/01_projects/api-layer.md`, `concierge-agent.md`, `skill-and-clone.md` | Только ТЗ №2 → commit `26a7ce5`. |

Остаточные упоминания старого пути `(authenticated)/admin/` в `module-map.md` (5 мест) и
других second-brain файлах (`admin-workers.md`, `admin-crons.md`, `ai-workspace.md`,
`admin-z-global.md`, `feedback.md`) — **technical debt**, не блокер. Отдельный sweep при
необходимости.

## Что вышло

### Commit'ы

- `26a7ce5` — `feat(ai-chat-quota): единая per-user квота AI-общения Concierge+Clones`
  - 25 files changed, 1068 insertions(+), 73 deletions(-)
  - Backend полностью + ТЗ-файл + docs.
- `deb8a8c` — `refactor(admin): вынести /admin/* в route-группу (admin) со своим AdminAuthGuard`
  - 256 files changed, 434 insertions(+), 82 deletions(-)
  - Frontend полностью + ТЗ-файл + admin.md + frontend-pages.md.

### Верификация (все зелёные перед commit'ом)

| Проверка | Backend | Frontend |
|---|---|---|
| `bun run typecheck` | ✅ Exit 0 | ✅ Exit 0 |
| `bun run lint` | ✅ Exit 0 | ✅ Exit 0 |
| `bun run test:unit` (vitest) | ✅ Exit 0 | ✅ Exit 0 |

Тесты ai-chat-quota: 7/7 зелёных (4 service + 3 controller).

### Push

⚠️ Push НЕ сделан — жду явного «push» от пользователя (правило из CLAUDE.md и memory).

## Чему научился

### 1. Оркестрация под-агентами реально экономит время

7 под-агентов отработали ~30 минут календарного времени (с учётом блокера на 5 минут).
Если бы делал сам в main-loop — оценка ×2-3 минимум. Параллелизм между независимыми ТЗ
дал значительную часть выигрыша.

### 2. Под-агенты могут лгать про `[x]` — fact-check обязателен

Память `feedback_agents_can_lie_about_edits` снова подтвердилась. Я делал `git status` + `Grep`
после каждого под-агента. Один раз помогло: под-агент 1B-cont сообщил про alias `@app/(admin)/admin/...`,
я проверил `frontend/tsconfig.json:30-32` — alias реально объявлен. Не выдумка.

Также проверял ключевые маркеры: `Grep "AiChatQuotaService"` после 2B, `Grep "user_daily"` после 2C,
`Grep "@Controller('api/v1/me/ai-chat')"` после 2D, `Get-ChildItem` старой папки после 1B-cont.

### 3. Развилки решаю сам с обоснованием 1-2 строки, мелкие НЕ пробрасываю

Все 6 принятых сам развилок (отсутствие middleware, имя Prisma-модели, отсутствие setGlobalPrefix,
4 точки assertRateLimit вместо 2, не трогать legacy parseInt-бага, не делать frontend Фазы 6)
зафиксированы в финальном отчёте пользователю и в commit-сообщениях.

**Единственная развилка, которую пробросил пользователю** — taskkill dev-server'а. Это его
процесс на его машине, прямое действие на shared system. Это правильно.

### 4. Под-агенту нужен **самодостаточный** промпт

Каждому под-агенту я давал:
- Контекст «зачем» (1-2 строки).
- Файлы, которые трогать, с конкретными путями.
- Файлы, которые НЕ трогать (особенно важно — чтобы не задели чужие фазы).
- Стандарты Z в свёрнутом виде (Bun, TypedConfigService, никаких `process.env`).
- Точные действия (1-2-3-...).
- Команды fact-check, которые **сам под-агент** должен прогнать перед отчётом.

Размер промпта на под-агента — ~120-180 строк. Это много, но окупается: ни один под-агент
не вернулся с вопросом «а что делать с X».

### 5. Windows file-lock на массовом move'е — записать на будущее

`git mv` на ~90 директорий с активным `next dev` — гарантированно блокировка. На будущее
правило: **перед массовым move'ом frontend-кода — сначала остановить dev-server**.

### 6. Расщепление commit'ов через `git reset HEAD -- <pathspec>` работает чисто

Когда два ТЗ задели общие файлы (`prod-deploy-log.md`, `module-map.md`), я разнёс их так:
- `git add` всё на ТЗ №2.
- `git reset HEAD -- "frontend/" "second-brain/01_projects/admin.md" "frontend-pages.md"`
  чтобы вернуть frontend-часть к unstaged.
- Commit ТЗ №2.
- `git add` оставшееся (frontend + admin.md + frontend-pages.md + плановый файл).
- Commit ТЗ №1.

Renames сохранились (git auto-detect по содержимому после повторного `git add`). Общие файлы
(`prod-deploy-log.md`, `module-map.md`) ушли целиком в первый commit — это компромисс,
зафиксированный в commit-message и здесь в рефлексии.

## Что осталось

1. **Push** — жду явного подтверждения пользователя.
2. **Зачистка остаточных упоминаний `(authenticated)/admin/`** в second-brain заметках
   (`module-map.md` строки 265/1166/1167/1659/1913, плюс `admin-workers.md`, `admin-crons.md`,
   `ai-workspace.md`, `admin-z-global.md`, `feedback.md`) — отдельный sweep, technical debt.
3. **Frontend Фаза 6 ai-chat-quota** — виджет «осталось N сообщений сегодня» в AssistantSidebar
   и Clones UI. Намеренно отложено — отдельной волной после согласования backend-контракта.
4. **`CLONE_ASK_PER_USER_PER_DAY` deprecation** — удалить ENV и getter `cfg.skill.cloneAskPerUserPerDay`
   после недели в проде без проблем.
5. **`CONCIERGE_DAILY_MESSAGES_LIMIT` legacy fix** — перевести с прямого `process.env.parseInt(x, 100)`
   на normal env.schema + TypedConfigService. Не блокер.
6. **Hard refresh у текущих супер-админов** — сообщить в release notes (старый `/admin` под
   AppShell, новый без).
