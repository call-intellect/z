---
date: 2026-05-26
type: рефлексия
session: реализация 4 ТЗ post-LLM-migration (clones access grants + frontend marketplace + checkin tests + rollback script)
distilled: false
tz:
  - plans/tz/2026-05-26-clone-access-grant-admin-api.md
  - plans/tz/2026-05-26-clones-marketplace-frontend.md
  - plans/tz/2026-05-26-checkin-batch-cron-tests.md
  - plans/tz/2026-05-26-llm-migration-smoke-checklist.md
source: plans/analysis/2026-05-26-llm-migration-followup-prompt.md
---

# Рефлексия — реализация 4 ТЗ follow-up после миграции LLM на DeepSeek-V4-Pro

## Что было поставлено

Из копилки follow-up задач после большой сессии миграции LLM на DeepSeek-V4-Pro (см. [[2026-05-26-llm-migration-deepseek-pro-wave]] и `plans/analysis/2026-05-26-llm-migration-followup-prompt.md`) — снять 4 hanging-tasks:

1. **Задача 1.** Закрыть gap Фазы 2 — написать unit-тесты `CheckinSentimentBatchCron` + парсера, плюс расширить `BusinessMetricsService` лейблом `reason` для silent skip невалидных элементов.
2. **Задача 2.** Расширить модель `CloneAccessGrant` полями `revokedAt` / `revokedBy` / `expiresAt`, исправить скрытый баг в `RbacService.canAccess*Clone` (фильтр активности грантов), сделать admin CRUD (5 endpoints) + user endpoint списка диалогов.
3. **Задача 3.** Написать откатный скрипт `patch-rollback-to-deepseek-flash.ts` (идемпотентный, под флаги).
4. **Задача 4 (front).** Frontend: маркетплейс клонов `/clones`, страница карточки клона, чат с боковой панелью диалогов, admin-страница `/admin/clones`, удалить legacy `/me/clone` и `/persons/[id]/skill-profile`.

Пользователь: «делай все по порядку, оркестрируй sub-агентами». Я главный оркестратор.

## Как решал

### Подготовительный этап (до кода)

Перед написанием ТЗ — 6 уточняющих вопросов пользователю про spec'и:
- Что делать парсеру при невалидном элементе (silent skip + reason-label vs throw)?
- Куда положить фикс RBAC `revokedAt`-фильтра (отдельная задача vs в составе Задачи 4)?
- Где живёт endpoint списка диалогов (отдельный модуль vs внутри `clones`)?
- Какой канал для integration-smoke chat-v2 (прямой LlmService vs через router)?
- Manager какого уровня (только same-department vs L+1)?
- Person-клоны в первичной миграции (выдаём всем сотрудникам vs только role)?

Ответы зафиксированы в Commit `85b68ee` (4 ТЗ — 2188 строк). После публикации ТЗ — ещё 6 решений по ходу реализации (например: cursor — UUID а не cuid; CloneConversation как ChatV2Conversation, а не отдельная модель).

### Оркестрационная схема

**3 волны × 7 sub-агентов параллельно.**

**Волна 1 (backend foundation, 3 agents параллельно):**
- A1: Задача 1 — unit-тесты cron + parser + reason-label метрика → коммит `7ede43d`.
- A2: Задача 2 Phase A — Prisma `CloneAccessGrant` поля + RBAC фикс + 14 тестов → коммит `fc3d6fe`.
- A3: Задача 3 — откатный скрипт → коммит `177e465`.

Все три закрывают независимые куски, общего state нет — параллелизм безопасен.

**Волна 2 (backend API + миграция, 3 agents):**
- B1: Задача 2 Phase B — admin CRUD `ClonesAdminService` + 5 controller endpoints + AuditInterceptor → коммит `c96505a` (часть).
- B2: Задача 2 Phase C — user endpoint `/clones/conversations` + `/me/clone-access` → в том же коммите `c96505a`.
- B3: Задача 2 Phase D — patch-script `patch-migrate-clone-access.ts` (заменил пустую заглушку) → коммит `87fef5d`.

B1+B2 пришлось серилизовать в один коммит — они оба меняют `clones.module.ts` + `dto/` + `controllers`. Делал в одном агенте через серийный план.

**Волна 3 (frontend, 2 agents параллельно):**
- C1: Задача 4 user часть — `/clones` marketplace + `/clones/[roleId]` + чат с sidebar + удаление legacy `ClonesListClient.tsx` / `RoleCloneClient.tsx` → коммит `578a777`.
- C2: Задача 4 admin часть — `/admin/clones` + 3 диалога (create / revoke / extend) + admin-clones.api.ts → коммит `eab4d8f`.

Конфликтов между C1 и C2 нет (разные директории), но есть общий `frontend/src/api/clones.api.ts` — C1 его расширил, C2 только read. Серилизовать не пришлось — C1 закончил первым, C2 пересмотрел diff и подхватил расширение.

### Факт-чек после каждого агента

После каждого sub-агента запускал:
1. `git status` — точный список staged / unstaged файлов.
2. `git diff --stat <commit>~1 <commit>` — что реально попало в коммит.
3. `bun run typecheck` — backend и frontend отдельно.
4. Точечный `bunx vitest run <file>` для затронутых тестов.
5. Грепал ключевые маркеры из ТЗ — реально ли агент написал `revokedAt` в `RbacService`, реально ли создал `ClonesAdminService` (см. memory `feedback_agents_can_lie_about_edits.md`).

Один раз поймал — агент B1 на первой попытке отметил `[x]` в ТЗ, но не записал DTO-файл. После факт-чека вернул его на доработку.

## Что вышло

### Коммиты (8 шт.)

```
eab4d8f feat(admin,frontend): /admin/clones — управление доступом к клонам
578a777 feat(clones,frontend): маркетплейс клонов + чат с боковой панелью диалогов
87fef5d feat(scripts): patch-migrate-clone-access — идемпотентная первичная миграция грантов
c96505a feat(clones): admin CRUD CloneAccessGrant + user endpoint списка диалогов
177e465 feat(scripts): откатный скрипт миграции LLM — patch-rollback-to-deepseek-flash
7ede43d test(operations): unit-тесты CheckinSentimentBatchCron + parser + reason-label метрики
fc3d6fe feat(rbac): фильтр активности грантов в canAccess*Clone + поля revokedAt/expiresAt
85b68ee docs(plans): 4 ТЗ по follow-up задачам после миграции LLM на DeepSeek-V4-Pro
```

**Размер:** ~6500+ строк кода + тестов. Из них:
- backend (4 коммита): ~3700 строк (включая 822 строки чистых тестов).
- frontend (2 коммита): ~3933 строки.
- ТЗ (1 коммит): 2188 строк.

### Verification

- `bun run typecheck` — OK backend и frontend на финале.
- `bunx vitest run` — 115+ backend unit-тестов passed по затронутым модулям:
  - 13 `ClonesAdminService` + 9 `clones-conversations.controller` (новые).
  - 25 `rbac-clone-access.spec.ts` (расширены 14 кейсами активности грантов).
  - 86 общие `rbac.service` — без регрессий.
  - 18 `checkin-sentiment-batch.cron` + `checkin-sentiment.prompt` (новые).
  - 7 `analyzer.worker.spec` — без регрессий.
  - 224 `admin.audit.interceptor` — без регрессий (после расширения `classifyAction` 3 ветками).
- `bunx vitest run` — 9 frontend unit-тестов passed: `CloneAvatar.spec.ts` (детерминированность цвета по departmentId, фолбэк инициала, accessibility).
- **2 pre-existing fails** в `frontend/src/ui/components/board/Board.spec.tsx` — НЕ моя регрессия. Проверил через `git stash` всех своих изменений: Board.spec.tsx падает в чистой `dev` (drag-n-drop тест с jsdom). Не блокирует push.

### Push

8 push'ей подряд на `origin/dev`. Между моими сериями коммитов прошли 2 чужих коммита (параллельная сессия — `cccf77c docs(second-brain): рефлексия — Hermes Agent` + `d91b9bd docs(plans): анализ — Hermes Agent`). Проверял через `git log origin/dev --oneline -50` после каждого push — не подхватил чужого. `git status` чистый по моим файлам.

### Прод-инструкция

Уже выдал владельцу в финальном сообщении сессии:

```bash
cd backend

# 1. Применить новые поля CloneAccessGrant (revokedAt/revokedBy/expiresAt + индексы)
bun run prisma:push
bun run prisma:generate

# 2. Первичная миграция грантов (на пустом проде = no-op, 0 записей)
bun run scripts/patch-migrate-clone-access.ts

# 3. Включить v2 пилотно (опц., после владельческого approve):
# .env: CLONE_V2_ENABLED=true
```

Откатный скрипт `patch-rollback-to-deepseek-flash.ts --update-existing` лежит готовый на случай инцидента после миграции LLM Pro (выдан в той же инструкции).

## Чему научился

### Оркестрационные уроки

1. **Серилизовать общий модуль `clones.module.ts` в один агент.** Когда два sub-агента из одной волны импортируют новые сервисы в один и тот же `XxxModule`, конфликты git merge неизбежны. Лучше один агент пишет последовательно, чем два параллельно потом мержат.
2. **Frontend volna может идти параллельно backend'у только если backend Phase B уже в push**. Пытался запустить C1 до окончания B2 — C1 не знал реального DTO формата `GET /clones/conversations`. Пришлось ждать B2 commit + перезапускать C1 с пересмотренным брифом.
3. **При параллельной сессии в репо — `git fetch` + `git log origin/dev --oneline -10` перед каждой новой волной.** Между моими волнами параллельная сессия пушила `cccf77c` и `d91b9bd` — я их не видел. Спасло то, что они в other-domain (Hermes research, не пересекается с clones / rbac / operations). См. memory `feedback_parallel_sessions_git_check.md`.

### Ловушки (tech-факты для копилки)

4. **Расхождение модели в ТЗ vs реальный код.** ТЗ говорит про `CloneConversation` как отдельную Prisma-модель — в реальности её нет. Использовали `ChatV2Conversation(scope='card')` как dialog-layer. Если бы агенты не сверились с реальной схемой, создали бы вторую несовместимую модель. Правило: **первый шаг агента — `grep "model CloneConversation" backend/prisma/schema.prisma`**, и если пусто — вопрос пользователю / адаптация ТЗ.
5. **Скрытый баг `RbacService.findUnique` без фильтра.** Раньше `findUnique({ where: { tenantId_grantedToUserId_cloneType_cloneRefId } })` принимал revoked / expired гранты как валидные. Это unique-индекс не отсеивает по `revokedAt`. Перевели на `findFirst` + `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`. Сам RBAC-тест без активности гранта раньше всегда возвращал true → 14 новых кейсов покрывают границы.
6. **Business-metrics с label `reason`** — нужно явно пробросить default value в существующих вызовах, чтобы не сломать backward-compat. Сделал `reason='other'` дефолтом. Cardinality: 2 значения × 101 tenant_top = 202 series (безопасно). Если бы взял `tenantId` как label без top-bucket — взорвался бы.
7. **Cursor в `/clones/conversations` — UUID а не cuid.** Из-за того что внутри ChatV2Conversation.id — UUID (а не Prisma cuid). ТЗ написал «cursor: cuid» — пришлось поправить на runtime. Правило: смотреть на тип `@id` модели, не доверять «по умолчанию cuid».

### Архитектурный вывод

8. **Soft-revoke + физическое удаление при re-grant.** Запись с `revokedAt != null` остаётся в БД как audit, но `@@unique([tenantId, grantedToUserId, cloneType, cloneRefId])` запрещает вставку второй записи на ту же пару. Решение: при re-grant внутри транзакции удаляем старую revoked-запись, потом вставляем новую. Audit-trail сохраняется в `AdminAuditLog` (interceptor пишет всю операцию). Это компромисс между «безопасное переоткрытие» и «чистая история таблицы».

9. **`ConversationalService.sendNotification` в try/catch.** Notification-failure НЕ откатывает grant — мы не хотим, чтобы упавший Telegram-бот не давал админу выдать доступ. Только warn-log. Этот паттерн уже использовался в feedback/recognition модулях — закрепил здесь.

## Что НЕ делал / отложил

- **Smoke 28 агентов** (Задача 3 §3 ТЗ smoke-checklist) — не запускал, требует `DEEPSEEK_API_KEY` в окружении + час времени. Скрипты готовы (lazy execution).
- **Integration-smoke chat-v2 через LlmRouter** (Задача 3 §4) — отдельная задача, отложил.
- **Person-клоны в маркетплейсе** — UI грейсфул не показывает их вообще (только role-клоны). Это соответствует memory `project_clones_are_role_based.md`.
- **`useUnseenCloneGrants` hook** — реализован, но реальный indicator в Sidebar не подцеплен (только заглушка). Подцепится в следующем visual-polish раунде.
- **Date-picker в `CreateGrantDialog`** — есть HTML5 `datetime-local`, но без преобразования в TZ Org'а. По умолчанию из UI берёт ISO в UTC. Достаточно для MVP.

## Что обновлено в second-brain

- `02_architecture/data-model.md` — обновлена секция «Clones v2 — CloneAccessGrant»: актуальная схема с полями `revokedAt`/`revokedBy`/`expiresAt`, индексы по активности, фикс RBAC, ссылка на patch-скрипт миграции.
- `02_architecture/module-map.md` — добавлен раздел «Доработки 2026-05-26 — admin CRUD CloneAccessGrant + frontend marketplace» в секции SBA γ-1.
- `01_projects/admin.md` — описание новой страницы `/admin/clones` (Org-Admin).
- `01_projects/api-layer.md` — 5 admin endpoints + 2 user endpoints + строка в «Историю изменений».
- `01_projects/frontend-pages.md` — новая секция «Clones — маркетплейс» с 4 маршрутами, пункт `/admin/clones` в admin-таблице, запись в историю.
- `01_projects/skill-and-clone.md` — большая секция «Доработки 2026-05-26 — CloneAccessGrant admin CRUD + frontend marketplace»: правила B, patch-скрипт, in-app уведомления, user API.
- `01_projects/workers-queues.md` — заметка про unit-тесты `CheckinSentimentBatchCron` и про откатный скрипт `patch-rollback-to-deepseek-flash.ts`.
- `01_projects/ai-jobs.md` — секции «Откатный скрипт миграции LLM (2026-05-26)» и «Расширение метрики reason-label (2026-05-26)».

## Команды для прода (консолидированно)

```bash
cd backend

# 1. Применить новые поля CloneAccessGrant (revokedAt/revokedBy/expiresAt + 2 индекса)
bun run prisma:push
bun run prisma:generate

# 2. Первичная миграция грантов (на пустом проде = no-op, 0 записей)
bun run scripts/patch-migrate-clone-access.ts
# опц. для одного тенанта:
# bun run scripts/patch-migrate-clone-access.ts --tenant <orgId>

# 3. Включить v2 пилотно (после владельческого approve выдачи грантов через /admin/clones):
# .env: CLONE_V2_ENABLED=true

# === Откат миграции LLM на DeepSeek-Pro (при инциденте) ===
# Безопасно посмотреть план:
bun run scripts/patch-rollback-to-deepseek-flash.ts --dry-run
# Применить:
bun run scripts/patch-rollback-to-deepseek-flash.ts --update-existing
```

Все скрипты идемпотентны + уважают `editedByAdmin=true`.
