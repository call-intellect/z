---
date: 2026-06-16
title: ChatBox как источник — мастер, анализ-модель, стеклянный UI, чистка логов
distilled: false
---

# ChatBox-интеграция как источник памяти + анализ-модель

## Что было поставлено
- Локальный запуск всего стека без контейнеров (бэк :3000, фронт :3001) для теста установки ChatBox/Bitrix.
- ChatBox-интеграция должна стать **источником** (как встречи): управление в «Админка компании → Источники».
- Мастер первого подключения по шагам (токен → воркспейс → сотрудники → бэкафилл) с сохранением прогресса.
- Анализ-модель: анализ по умолчанию включён, крон 00:00, ручной синк чатов **только по периоду**, авто-создание Person при синке, дедуп анализа.
- UI на табы (убрать «меню в меню»), стеклянный язык, чистка логов и расхода LLM.

## Как решал (файлы/механизмы)
- **Локальный запуск:** корневой `.env` (единственный — жёсткое требование владельца), `NODE_ENV=development`, `COOKIE_DOMAIN=localhost`, `NEXT_PUBLIC_*`→localhost, `DATABASE_URL`/`REDIS_URL` на хост-порты (55435/56381). msgpackr-extract роняет Bun на arm64 → каталоги `__off`.
- **AGE ag_catalog-трап:** сырой `CREATE TABLE/TYPE` на AGE-базе уходит в `ag_catalog`, бэк падает «public.X does not exist». Лечение: `ALTER TABLE/TYPE ag_catalog."X" SET SCHEMA public` (21 таблица + 9 enum). Уже в memory `project-age-search-path-ddl-trap`.
- **ChatBox-источник:** `ChatboxConnectWizard.tsx` (4 шага, персист прогресса в `sessionStorage` с латч-гейтом в `ChatboxIntegrationClient`), страницы `company-admin/sources/{chatbox,bitrix}`, `ensureChatboxSource` на коннекте.
- **Анализ-модель (бэк):** `chatbox-sync.service.ts` — `autoCreate*Unlinked` (после email/имя-каскада: дедуп по email → `PersonsService.create` → `linkMode=auto`, автор = владелец Org через `membership role=owner`); `enqueuePendingAnalysisIfEnabled` (гейт по `analysisEnabled`, только `pending` + jobId-дедуп) в `syncByScope('chats'|'all')`. Default-on — в мастере.
- **Расписание:** `chatbox-sync.cron` + `chatbox-analyze.cron` → `EVERY_DAY_AT_MIDNIGHT` (раньше analyze крутился каждые 5 мин → непрерывный расход LLM).
- **Стеклянный UI:** ConnectedView переведён на `modern/*` (`GlassCard`, градиентный `CardTitle`, `STATUS_TONE`-пилюля, стат-плитки) — фирменный язык вместо плоского shadcn.
- **hardDelete:** удаление chatbox-источника = полный сброс (сообщения→сессии→чаты→каналы→клиенты→менеджеры→интеграция).

## Что вышло (верификация)
- Мастер: персист прогресса проверен через Playwright (шаг 3 переживает уход со страницы и `data=null` — баг был в моём же stale-guard, который стирал прогресс; guard убран).
- Бэкенд анализ-модели: `tsc --noEmit` = **0 ошибок**, eslint чисто.
- Чистка логов: 89 `*.cron.ts` (119 вызовов) + 61 `*.worker.ts` (112 вызовов) `logger.log`→`debug` (boot-логи «запущен» оставлены), HTTP 404 → debug.
- Коммит `26371e32` (207 файлов), запушен в `bitrix`.

## Чему научился / грабли (много времени)
- **Token-burn firefighting** повторялся 4+ раза: analyze-крон каждые 5 мин + отсутствие глобального kill-switch → сотни LLM-задач. Урок: гейт по `analysisEnabled` + дедуп `pending`+jobId — обязательны, и держать «дренаж очередей + analysisEnabled=false» под рукой.
- **«В работе N»** в UI = pending-сессии в БД, НЕ длина очереди. Чистить очередь redis бесполезно — нужно сносить/переводить сессии.
- **BullMQ 5.x**: `:` в custom jobId разрешён ТОЛЬКО при ровно 3 частях (легаси repeatable). 4-частный `chatbox:tenant:scope:backfill` падал. → разделитель `-`.
- **Turbopack dev** лениво компилит роуты; после массовых перемещений файлов карта роутов устаревает → 404 на существующих страницах. Лечение: `touch` роутов или рестарт dev.
- **Stale running-backend**: владелец не перезапускал бэк → «удалил источник, интеграция не сбросилась» (старый hardDelete в процессе). Урок: при «фикс не сработал» первым делом проверять, перезапущен ли процесс.
- **Verify-before-claim**: несколько раз чинил «вслепую» и ошибался; Playwright-проверка персиста визарда (Тест A/B) сразу показала истинную причину.

## Prod
Только код: миграций/seed/ENV/новых очередей нет. Выкат = `docker compose up -d --build backend` + рестарт воркера. Внимание: анализ теперь **default-on** у новых интеграций — свежий коннект расходует LLM.
