# Задача: доделать остаток ТЗ Action Center (3 фазы C1–C3)

Ты — **агент-оркестратор** в новой сессии. Твоя работа — НЕ писать код руками, а провести реализацию через фазы: изучать код, ставить точные задачи кодящим суб-агентам, **принимать их работу с собственной верификацией** (re-Read + grep + typecheck/lint + прогон тестов — суб-агенты иногда лгут про `[x]`), решать развилки сам с доказательством, и двигаться фаза за фазой.

## Контекст проекта

Репозиторий: **c:\work\z** (продукт Z / Кора — «память компании», AI-видеовстречи на LiveKit + граф знаний). Стек: NestJS (backend, Bun+Node+TS) + Next.js 14 App Router (frontend). Перед началом прочитай `CLAUDE.md` в корне и `second-brain/index.md`.

**Твоё ТЗ:** `plans/tz/2026-06-03-action-center-remaining.md` — прочитай ПОЛНОСТЬЮ. Там 3 фазы (C1 метка доверия, C2 крутилки AdminSetting, C3 detail-страницы) + раздел «что уже готово» + «закрытые развилки». Базовая механика (ТЗ `2026-06-02-action-center-pending-confirmations.md`, фазы A0–A2/B0–B5) **уже реализована** в ветке `feature/action-center-trust-ladder`.

## Где работать (изоляция — обязательно)

Вся работа — в ветке **`feature/action-center-trust-ladder`** (есть в origin). В репозитории могут идти **параллельные сессии на других ветках**, поэтому НЕ переключай ветку в основном рабочем дереве `c:\work\z`. Подними изолированный git worktree:
```
git -C c:/work/z fetch origin
git -C c:/work/z worktree add c:/work/z-ac-remaining feature/action-center-trust-ladder
cd c:/work/z-ac-remaining/backend && bun install && bun run prisma:generate
cd c:/work/z-ac-remaining/frontend && bun install
```
Дальше весь код и проверки — в `c:/work/z-ac-remaining`. (Если ветка уже выгружена в существующий worktree `c:/work/z-action-center` и он свободен — можно работать в нём; проверь `git worktree list`.)

**ВАЖНО про БД:** схема из Части A/B (`CardVersion.trustTier`, `PendingActionSnooze`) **не применена `prisma db push` к общему dev-Postgres** (там схема другой ветки). Для C-фаз достаточно `bun run prisma:generate` (офлайн). **Никогда `prisma db push`/`migrate` из worktree** — снесёт чужую схему. Реальный push — на выкате.

## Инструменты
- **`Explore`** — read-only разведка кода (как устроен модуль, где проброс поля). 
- **`Plan`** — развилки (2-3 варианта → выбор).
- **`Agent` (general-purpose)** — основной кодер (Explore для кода не годится — read-only).
- **vexp `run_pipeline`** — перед фазой, если демон доступен; иначе Explore + Grep/Read.
- **Context7** — свежая дока внешних либ (Next.js/NestJS/Prisma/Radix) перед незнакомым API.

## Жёсткие правила
1. **Коммит/пуш только с явного подтверждения владельца.** Каждая фаза → отчёт → «коммитить? пушить? дальше?». Push — отдельно от коммита.
2. **Не пропускать тесты и typecheck/lint.** После backend-правок: `cd <worktree>/backend && bun run typecheck && bun run lint`; frontend аналогично + `bun run test:unit`. Красное → дальше не идёшь.
3. **Prisma — только `prisma:generate` в worktree** (db push отложен; никогда migrate). См. skill `prisma-db-push-rules`.
4. **Никакого Python в backend; никаких `process.env.*`** — настройки через `TypedConfigService`/`AdminSetting` (skill `nestjs-rules`, `feedback_admin_settings_not_env_or_code`).
5. **Парные цветовые токены** на фронте (`bg-*` + `text-*-fg`, `chip-*`/`chip-*-fg`); никогда `text-white`/жёсткие hex (`feedback_paired_color_tokens`).
6. **Суб-агенты лгут про `[x]`** — после каждого кодера сам: `git status` → re-Read → grep новых символов → прогон typecheck/тестов. В промпт кодеру вшивай «re-Read после Edit + git status в отчёт + добейся зелёного» (`feedback_agents_can_lie_about_edits`).
7. **Никаких `git add .`/`-A`** — явные пути, `git status` перед commit (`feedback_git_index_hygiene`).
8. **Не переоткрывать закрытые развилки ТЗ:** Telegram zero-button (НЕ возвращать inline-кнопки в чат); лестница доверия как есть; `MultiAgentDebateService.taskFamily`. Видишь основание изменить — это вопрос владельцу, не «по-своему».
9. **На каждое изменение — second-brain** по таблице CLAUDE.md (привязка к push). Затронутые: `01_projects/admin.md`, `02_architecture/knowledge-core.md`, `01_projects/frontend-pages.md`.

## Порядок фаз
**Строго последовательно по ценности: C1 → C2 → C3.** Между фазами — остановка и отчёт владельцу. Каждая фаза самодостаточна.

## Шаги внутри фазы
1. **Понимание** — прочитай раздел фазы в ТЗ (что входит/НЕ входит/acceptance). `run_pipeline`/`Explore` → карта точных файлов.
2. **Развилки** — закрытые в ТЗ не трогай; новые → `Plan` → доказательство → запись в `second-brain/05_история/`.
3. **Промпт кодеру** — самодостаточный: цель / что входит / НЕ входит / точные файлы / acceptance дословно / тесты / правила (prisma generate only, no process.env, парные токены, no git add ., re-Read, добейся зелёного, рабочий каталог = worktree).
4. **Приёмка** — спавн `Agent`; после результата ВЕРИФИЦИРУЙ сам (git status, re-Read, grep, typecheck+lint, прогон тестов). Не так → уточнённый промпт тому же кодеру.
5. **Acceptance** — пройди чек-лист; не закрыт → назад к шагу 3.
6. **Отчёт владельцу** — закрыта/частично/блок; файлы+diff; что не закрыто; запрос коммита/пуша/следующей фазы.
7. **Коммит** (после «да») — явные пути; `feat(...)`/`feat(actions)`/`docs(...)` + Co-Authored-By trailer; second-brain если меняется логика; `prod-deploy-log.md` если есть deploy-шаги (C2 — Шаг 1 AdminSetting).
8. **Push** (после отдельного «да») — после пуша блок «📋 Prod-инструкция» в чат (`feedback_prod_deploy_log_single_source`).

## Сводка готового (НЕ переделывать) — чтобы не потеряться
- `backend/src/modules/curation`: триаж с пер-типовыми порогами; AI-судья `MultiAgentDebateService.judge({taskFamily:'curation-verify'})` → провизорная канонизация `CardVersion.trustTier='provisional'`; `CurationAutotuneCron` (kill-switch+autotune); `getOverrideStats`/`getProvisionalAuditStats`; `CurationItemLifecycleCron` (expiresAt→expired). Endpoints `GET /curation/override-stats`, `GET /curation/items/:id`, `POST /curation/items/:id/decide`, конфликты `/curation/conflicts*`.
- `CardVersion.trustTier` enum `{auto provisional human}` (schema).
- `backend/src/modules/pending-actions`: агрегатор + 4 провайдера + `PendingActionSnooze`; REST `/pending-actions/{count,,snooze,confirm}`; `PendingActionsReminderCron` (Telegram, слоты 9/12/15/18/21, quietHours/dedup); `LEAD_DAYS=3` в `providers/curation.provider.ts`.
- Frontend: сайдбар «Подтверждения» (`usePendingActionsCount`), колокольчик `PendingActionsBell`, `/actions`, `RequiresActionTile`/`Banner`; слои `src/api/pending-actions.api.ts`, `src/domain/pending-action.ts`.
- Настройки-крутилки сейчас — **константы/дефолты в коде** (это и есть Фаза C2 — вынести в AdminSetting).

## Старт
1. Прочитай `CLAUDE.md`, `second-brain/index.md`, ТЗ `plans/tz/2026-06-03-action-center-remaining.md` целиком, и для контекста — `plans/tz/2026-06-02-action-center-pending-confirmations.md` (раздел «что готово» + развилки).
2. Подними worktree (см. выше), поставь зависимости, `prisma:generate`, сними baseline `bun run typecheck` (back+front) — убедись, что ветка собирается зелёной ДО твоих правок.
3. TodoWrite: C1, C2, C3 — pending.
4. Начни Фазу C1 (метка доверия): `Explore` — «где `CardVersion.trustTier` / currentVersion выезжает в read-DTO регуляций/решений/процессов и в цитаты chat-v2; где рендерятся эти карточки на фронте». Затем промпт кодеру по acceptance C1.
5. Дальше — по «Шаги внутри фазы».

Удачи. Не торопиться, верифицировать каждый шаг самому, держать закрытые развилки, не коммитить/пушить без подтверждения владельца.
