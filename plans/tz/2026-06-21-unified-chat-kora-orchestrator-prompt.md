# Orchestrator-prompt: Единый чат Коры (единое ядро)

Запуск скилла `tz-orchestrator` для реализации ТЗ [`plans/tz/2026-06-21-unified-chat-kora-tz.md`](2026-06-21-unified-chat-kora-tz.md). Тело контракта НЕ дублируется — всё в ТЗ.

## Что это
Единое ядро сообщений Коры: ОДИН склад `Conversation/Message` на всё — внутренний чат сотрудников (личка/группы/каналы) И обращения клиентов поддержки. Тикет = `Conversation(kind='ticket')` + обёртка `SupportTicket`; логика поддержки (контур/клон/critic/куратор/SLA/CSAT) **пересаживается** с `Issue/IssueComment` на ядро. Вся переписка кормит граф знаний. Мобильность — сквозное требование.

**Контекст смены архитектуры:** изначально планировался B+ (два склада + переходник), но поддержка ещё НЕ запущена (нет живых данных) → владелец выбрал **вариант A (единое ядро)**, что устраняет 4 из 7 инвариантов-костылей и обязательный «перенос потом».

## Порядок чтения перед стартом
1. `CLAUDE.md` + `.claude/CLAUDE.md` (инварианты, vexp-правило, Ship-On, миграции ФАЙЛОВЫЕ).
2. ТЗ целиком: [`2026-06-21-unified-chat-kora-tz.md`](2026-06-21-unified-chat-kora-tz.md) — «Принятые решения Р1–Р8», «Контракт-first» (модели), граф фаз.
3. Анализ: [`99-synthesis.md`](../analysis/2026-06-21-unified-chat-kora/99-synthesis.md) (§5-6 матрица + §6 пометка о смене на A) + [`04-code-convergence`](../analysis/2026-06-21-unified-chat-kora/04-code-convergence-raw.md) (сведение, file:line) + [`05-redteam`](../analysis/2026-06-21-unified-chat-kora/05-redteam-raw.md) (почему единое ядро сильнее) + [`06-mobile-ux`](../analysis/2026-06-21-unified-chat-kora/06-mobile-ux.md).
4. База native-чата: [`2026-06-03-internal-messenger-anti-ban-research.md`](../analysis/2026-06-03-internal-messenger-anti-ban-research.md).
5. Прототип UI: [`2026-06-21-support-desk-messenger-prototype.html`](../analysis/2026-06-21-support-desk-messenger-prototype.html).
6. second-brain: `index.md`, `01_projects/support-desk.md` (что пересаживается), `conversational-channels.md`, `chat-v2.md`, `02_architecture/module-map.md`+`data-model.md`.

## Инструменты
- Картография — `run_pipeline` (если vexp жив; иначе Grep/Read). `get_skeleton` вместо Read для осмотра.
- Внешние либы (`@socket.io/redis-adapter`, socket.io, Prisma, RuStore/APNs SDK) — Context7 перед использованием.
- **Якоря file:line в ТЗ дрейфуют — перед каждой правкой перечитывать по уникальному символу.**

## Граф фаз (строгий порядок)
`Ф0 ∥ Ф1` (независимы) → `Ф2 ∥ Ф3` (оба поверх ядра Ф1) → `Ф4` (нужны Ф2+Ф3) → `Ф5` → `Ф6` → `Ф7`.
- **Ф0** мост-загрузки (Bitrix/Telegram→граф). Перед стартом снять факт по существующему Bitrix-ingest (`run_pipeline`/Grep): по `second-brain/04_не-сделано` чаты Bitrix уже втекают в `RawEvent` — возможно «достроить привязку», не строить с нуля.
- **Ф1** единое ядро `Conversation/ConversationMember/Message/MessageOutbox` + слой корректности + WS + presence-Redis + `@socket.io/redis-adapter` (его НЕТ) + RBAC + AES-256-GCM + ФЗ-41 gate.
- **Ф2** внутренний чат (личка/группы/каналы + обязательный канал).
- **Ф3** поддержка на ядре — **пересадка, не переписывание с нуля**: тикет=`Conversation(kind='ticket')`+`SupportTicket`; переписка→`Message`; контур/клон/critic/куратор/SLA/CSAT перепривязать с `Issue/IssueComment` на ядро; старый Issue-based support-путь удалить/депрекейтнуть.
- **Ф4** единый экран «Сообщения» (один запрос по `Conversation`, без фасада-провайдеров — один склад).
- **Ф5** AI-крючки (чат→граф один источник `Message`, «что пропустил», «что решили», сообщение→задача, расшифровка, авто-сообщение встречи).
- **Ф6** мобильное приложение (пуш APNs/RuStore).
- **Ф7** доводка (huddles/поиск/опросы/автоудаление/HR-подписки).

## Факт-чек суб-агентов (НЕ верь отчёту [x])
После каждого агента до коммита:
- Грепни маркеры в реальных файлах (`feedback_agents_can_lie_about_edits`).
- **3 инварианта (INV-A1/A2/A3)** — grep-предикаты: INV-A3 (фронт «Сообщения» зовёт только `/message-threads`), INV-A2 (один `<MessageBubble>`), INV-A1 (`InboxItem` ticket несёт status/sla, прочие null).
- **Ф3 критично:** грепнуть, что старый Issue-based support-путь МЁРТВ (нет двойной записи в Issue и Conversation); CI-негатив-тест изоляции контура переписан на `Message`.
- Свой `bun run typecheck && lint && build` (front+back) + `bunx vitest run` по новым/переписанным spec.
- `git status` целиком перед коммитом.

## Определение «фаза закрыта»
Все Acceptance-предикаты зелёные машинно + строка `Закрывает: Rn` трассирована + DoD-чек. Коммит по фазе; push — по явному подтверждению владельца.

## Failure-modes (специфика)
- **Слой корректности нельзя срезать** (Ф1): seq/outbox/lastReadSeq/докачка/presence-в-Redis — load-bearing.
- **`seq` только атомарный per-conversation, НЕ timestamp.**
- **Ф3 — самый рискованный кусок:** пересадка контур-изоляции/клон-черновика/гейта промоута на `Message` без потери инвариантов поддержки; CI-тест изоляции контура обязателен на `Message`; убедиться, что данных нет и миграция данных не нужна (поддержка не запущена).
- **ФЗ-41 gate (Ф1):** во внешний канал только сигнал без тела/имён; тест валит сборку при теле; проверить легаси-события.
- **Приватность (Р5):** граф кормится всей перепиской (вкл. dm), но прямое чтение тел чужой переписки запрещено (R18, super_admin тела не читает); AI-чат оперирует извлечённым знанием.
- **Ship-On:** все флаги (`CHAT_ENABLED`/`MESSAGE_BRIDGE_ENABLED`/`SUPPORT_DESK_ENABLED`/`SUPPORT_CURATOR_ENABLED`/`CHAT_PUSH_ENABLED`) — kill-switch ON при выкате; строка в `docs/operations/feature-flags.md`.
- **Миграции ФАЙЛОВЫЕ** (`prisma:migrate -- --name`), `createPrismaClient()` в скриптах, импорты `../src`, скрипты в `apply-prod-deploy.ts STEPS`.
- **Крутилки → AdminSetting** (debounce/пороги/TTL/retention), не ENV и не магические константы.

## После каждого push
Триггер завершения CLAUDE.md: second-brain (новый `01_projects/unified-chat.md` + обновить `support-desk.md` про переезд на ядро + производные), `prod-deploy-log.md` (Шаги 1/4/5/7/8/12), реестр флагов, рефлексия в `05_история/`, блок «📋 Prod-инструкция» в чат.
