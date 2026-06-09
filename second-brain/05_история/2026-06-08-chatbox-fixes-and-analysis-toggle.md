---
title: ChatBox — dev-прогон владельцем, фиксы и доработки (тумблер анализа, Person из менеджера, UX чата)
date: 2026-06-08
branch: chatboxFix
relates_to:
  - 01_projects/chatbox-integration.md
  - plans/tz/2026-06-05-chatbox-integration.md
---

# ChatBox: фиксы и доработки по факту dev-прогона

## Что было поставлено
Владелец впервые гонял ChatBox-интеграцию на локальном dev: регистрация, подключение токена, синк, просмотр чатов, менеджеры. По ходу вскрылись баги и пожелания — чинили и доделывали в реальном времени.

## Как решал (файлы + 3 коммита в `chatboxFix`)

**`1f8770cd` chore(dev): локальный запуск**
- `scripts/dev.ts` — `bun run dev` поднимает back+front разом, root `.env`, без `--watch` (сломан на arm64), без принуд. LiveKit; graceful-shutdown с SIGKILL-добиванием (Ctrl+C оставлял осиротевший бэк с BullMQ-воркерами).
- `docker-compose.yml` — публикация порта postgres на хост (gated `POSTGRES_HOST_PORT`). Локалка: единый прод-compose, postgres-сервис = composite PG16+pgvector+AGE; собрали образ, перешли с `docker-compose.dev.yml`. Бэк на :5000.

**`f7fae7a6` feat(chatbox): тумблер анализа + фиксы**
- **Контракт воркспейсов:** бэк отдавал голый массив, фронт ждал `{workspaces}` → `res.workspaces.length` падал → «Не удалось проверить токен» (токен был валиден!). Плюс реселлерский токен видит 226 чужих воркспейсов (223 USER, 2 OWNER, 1 ADMIN). Фикс: `listWorkspaces`/`upsert` перебирают все страницы + фильтр OWNER/ADMIN; фронт читает голый массив.
- **Тумблер AI-анализа** `ChatboxIntegration.analysisEnabled` (default false, миграция `20260608200000`). Крон analyze метёт только орги с `analysisEnabled=true`. Связка с фиксом jobId (ниже): без гейта починка jobId снова зажгла бы LLM на 133 сессиях.
- **jobId** `chatbox-analyze:${id}` → `-${id}` (BullMQ запрещает `:` → `enqueued=0`).
- **Person из менеджера:** `POST /chatbox/members/:id/create-person` (дедуп по email → связать существующего). Ослабили инвариант «в Person не пишем».
- **Лимит сообщений** 200→500 (чат грузит весь тред разом).
- **UX чата:** скролл-контейнер (не скролл страницы) + автоскролл, пометка отправителя + имя, контраст пузырей, экспорт в `.txt`; фильтр мессенджера в списке — Select.

**`99c4aa38` feat(chatbox): ссылка на профиль менеджера**
- `listMessages` резолвит `senderExternalId` → `ChatboxMember.linkedPersonId` (батч), фронт делает имя менеджера ссылкой на `/persons/[id]`. Клиент — без ссылки (нет страницы `ChatboxCustomer`).

## Что вышло
- Typecheck back+front чистый. Тесты: chatbox integration 11, members 6, chats 11 — зелёные.
- LLM-жор демо-орга остановлен отдельно: снесли reference-демо «ТехноСтрim» (243 блока) + очистили 1479 BullMQ-джобов в Redis (bootstrap-seed создавал лишние демо-данные → каскад LLM на старте).
- Запушено в `chatboxFix`, **не слито** (PR не открывали).

## Чему научился (грабли)
- **`prisma migrate dev` падает на shadow-БД без AGE** (`schema "ag_catalog" does not exist`): shadow-база создаётся без Apache AGE, старая AGE-миграция спотыкается. Обход: писать файл миграции вручную + `migrate deploy` (без shadow). См. [[../02_architecture/code-pitfalls]].
- **`bun run dev` через mv `.next`→`.next.old` заразил сборку:** `.next.old` (в отличие от `.next`) не в `.gitignore` → Tailwind v4 сканит старые чанки → битый класс `w-[var(--radix-…)]` → CSS parse error. Чистить Next-кэш только полным удалением/выносом из дерева проекта, не переименованием внутри.
- **prod-`.env` ≠ dev-`.env`:** root `.env` — прод-конфиг с боевыми LLM-ключами; на dev это реальные деньги. `HTTP_PROXY` из `.env` Bun-fetch НЕ ломает (вопреки гипотезе — вернул 200).
- **Контракт фронт↔бэк (массив vs `{items}`):** «ошибка токена» оказалась рассинхроном формы ответа — диагностировать по факту (curl=200, браузер-ошибка → смотреть как фронт парсит), а не верить тексту ошибки.
