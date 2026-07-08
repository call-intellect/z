# Промпт для агента-реализатора: «Новое сообщение» (мессенджер)

Ты — оркестратор-разработчик. Реализуешь готовое ТЗ фаза за фазой, сам принимаешь качество (греп / re-Read / свой typecheck-lint-build-тесты), коммитишь по фазам. Работаешь в **уже существующей ветке `work/2026-07-07`** (в ней лежит коммит `d3c5e600` с ТЗ и архитектурой — ничего пере-создавать не нужно, просто продолжай в ней).

## 0. Что читать (строго в этом порядке)
1. `CLAUDE.md` и `.claude/CLAUDE.md` — инварианты проекта (без комментариев в коде; крутилки в AdminSetting; Prisma-миграции файловые; Ship-On; коммит только своих файлов, push — только с явного слова владельца).
2. **ТЗ (главный контракт):** `plans/tz/2026-07-07-messaging-new-conversation.md` — требования R1–R8, 5 фаз, приёмка, сниппеты, `path:line`.
3. **Архитектура (замысел владельца):** `plans/architecture/2026-07-07-messaging-new-conversation.md` — было→стало, макеты, решения Р1–Р8. Код не должен ей противоречить.
4. `second-brain/index.md` → профильные `01_projects/` по мессенджеру/conversational-channels; `02_architecture/code-pitfalls.md`.
5. Скиллы под задачу: `nestjs-rules` (Ф1–Ф2), `frontend-rules` (Ф3–Ф4), `prisma-db-push-rules` (проверить, что схема НЕ меняется), `safe-seed-rules` (Ф2 backfill), `strict-production-review-gate` (перед коммитом каждой фазы).

## 1. Инструменты
- **Осмотр кода:** сперва `vexp run_pipeline({task})`. **Важно (память проекта):** vexp free-cap ~2000 узлов — backend недокрыт; если по backend пусто/неполно — ищи через `ls`/`find` + `Read` (демон при этом может блокировать Grep/Glob — используй Bash `grep`/`find`, они не блокируются).
- **Внешние либы** (Radix Dialog, SWR, Zod/nestjs-zod, Prisma) — Context7 (`resolve-library-id` → `query-docs`), не по памяти. Стек пинит свежие версии.
- **Не доверяй отчёту суб-агента.** После каждой фазы сам: `grep` маркеров, `Read` изменённых мест, свой `typecheck/lint/build` и `vitest`. «Сделано» засчитывается только по машинной проверке из раздела Acceptance фазы.

## 2. Граф фаз (порядок реализации)
```
Ф1 (backend: дедуп dm) ─┐
                        ├─► Ф3 (FE api/domain) ─► Ф4 (FE модалка) ─► Ф5 (e2e-приёмка)
Ф2 (backend: backfill) ─┘
```
- **Ф1 и Ф2 независимы** — можно параллельно (два суб-агента), обе чисто backend.
- **Ф3** зависит от контракта Ф1 поведенчески (дедуп), но не по коду.
- **Ф4** зависит от Ф3 (нужны api-метод + проп пикера).
- **Ф5** — ручная приёмка после Ф4.
Детальный per-фаза scope / файлы / Acceptance — в ТЗ, не пересказывай, бери оттуда.

## 3. Код-якоря и ловушки (перечитай номера строк перед правкой — могли сдвинуться)
- **Ф1 дедуп dm:** `backend/src/modules/messaging/services/conversation.service.ts` — метод `createConversation` (якорь `Array.from(new Set([args.createdByUserId`). Добавь `findExistingDm` (сниппет в ТЗ), вызывай при `kind==='dm'` и ровно 2 участниках. Тест — `conversation.service.spec.ts`. **Не меняй** DTO/ответ контроллера.
- **Ф2 backfill:** новый `backend/scripts/backfill-company-channel.ts`. Обяз.: `createPrismaClient()` из `./_lib/prisma` (НИКОГДА `new PrismaClient()`), импорты из `../src`, `require.main`-guard (чтобы импорт не запускал прогон). Переиспользуй `ConversationService.ensureCompanyChannel` + `addMember(source:'auto')` (upsert → идемпотентно). Зарегистрируй в `backend/scripts/apply-prod-deploy.ts` массив `STEPS`: `{ phase: 'backfill', script: 'scripts/backfill-company-channel.ts' }`. try/catch на каждую Org — ошибка одной не валит прогон.
- **Ф3 пикер:** `frontend/src/ui/shared/ParticipantPicker.tsx` — добавь опциональный проп `onlyUsers?: boolean` (default НЕ задан → текущее поведение, чтобы не сломать 9 текущих потребителей); при `onlyUsers` фильтруй результаты до `type==='user'`. **Ловушка:** сверь, как соседние методы `frontend/src/api/messaging.api.ts` передают `orgId` в `apiClient` (заголовок vs путь) — новый `startExternal` (`POST /api/v1/external-conversations`, тело `{clientContact:{email?|phone?}, title?, message?}` → `{conversationId, inviteLink}`) делай тем же способом.
- **Ф4 модалка:** `frontend/src/ui/messaging/MessagesClient.tsx` (шапка ~строки 247–255 — рядом с заголовком «Сообщения»). Новый под-компонент `NewConversationDialog.tsx` в `src/ui/messaging/`. `createConversation` уже есть в api (`messaging.api.ts:109`) — подключить, НЕ дублировать. Режимы: «Коллега» (пикер `onlyUsers` → dm при одном / group при нескольких, заголовок группы из имён если пусто) и «Внешний/клиент» (email/телефон + первое сообщение → `startExternal` → показать `inviteLink` + «Скопировать»; обработать `503 EXTERNAL_CHAT_DISABLED` понятным русским текстом). Навигация в открытый тред — существующим `onOpen`/refId. UI — только русский, парные токены `bg-*`/`text-*-fg`.

## 4. Что НЕ трогать (границы)
Гостевую сторону внешнего чата (`/c/<token>`, `ExternalChatClient`), флаг `EXTERNAL_CHAT_ENABLED`, службу поддержки (`SUPPORT_DESK_*`), «компания↔компания». Новый флаг НЕ вводить (Ship-On, Р5). Схему БД НЕ менять (проверь: миграций быть не должно).

## 5. Команды проверки (запускай сам)
- backend: `cd backend && bun run typecheck && bun run lint && bun run build`; тесты — `bunx vitest run src/modules/messaging/services/conversation.service.spec.ts`.
- frontend: `cd frontend && bun run typecheck && bun run lint && bun run build`.
- Ф2 идемпотентность: прогнать скрипт дважды на dev-БД → второй раз `created:0`, дублей членов нет.
- Ф4/Ф5: ручной проход в кабинете (тестовый аккаунт из `.qa-cabinet.local.json`, домен `korateam.ru`, скилл `qa-tester`) или на dev.

## 6. Коммиты и завершение
- Коммить **по фазам**, только свои файлы (перечисляй пути, НИКОГДА `git add .`/`-A`). Conventional Commits, конец сообщения:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Push — только с явного «пуш» от владельца.**
- После реализации: обнови `second-brain/` по таблице производных заметок (мессенджер/conversational-channels — новый вход; `module-map` — новый FE-компонент; `prod-deploy-log.md` **Шаг 8** — строка `bun run scripts/backfill-company-channel.ts`); убери строку из `second-brain/04_не-сделано/README.md` (раздел «Сообщения») в «Закрытые»; запиши рефлексию в `05_история/`.
- Прод-инструкция при выкате: одна операция — прогнать backfill через `docker compose exec backend bun run scripts/apply-prod-deploy.ts --mode update`. Схему/ENV не трогаем.

## 7. Определение «фаза закрыта»
Все Acceptance-предикаты фазы из ТЗ выполнены и проверены ТОБОЙ машинно (грепы найдены, тесты зелёные, typecheck/lint/build зелёные), а не по словам суб-агента. Только тогда коммит фазы и переход к следующей.
