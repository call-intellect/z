---
type: tz
status: draft
feature: chatbox-group-graph-attribution
date: 2026-06-24
owner: Tozix
relates_to:
  - plans/tz/2026-06-24-chatbox-group-chats.md
---

# vNext-заглушка: пофименная атрибуция сообщений группового чата в knowledge-граф/задачи

> **Статус:** отложено владельцем (решение В2 в [chatbox-group-chats.md](2026-06-24-chatbox-group-chats.md) — «фазами»). Реализовывать ТОЛЬКО по явному «реализуй».

## Проблема
`chatbox-ingest.service.ingestSession` сейчас приписывает всю чат-сессию **одному** клиенту (`chat.customerExternalId`) и **одному** ответственному менеджеру (`chat.responsibleExternalId`). Для группового чата (несколько клиентов/менеджеров — поддержка идентификации/UI/контактов уже сделана в основном ТЗ) это неверно для **графа знаний и задач**: реплики разных участников атрибутируются одному лицу.

## Что нужно (контур, не контракт)
- В `ingestSession` для `ChatboxChat.isGroup=true`: атрибутировать каждое сообщение/реплику своему отправителю — `senderExternalId` → контакт `Entity{type=person}` (для CLIENT, через `ChatboxChannelClient.linkedContactEntityId`) / `Person` (для USER-менеджера). `transcriptTurns[].authorPersonId`/`speakerParticipantId` — по отправителю, не один на всю сессию.
- Извлечение задач (`chatbox-analyze.worker` / task-extraction): assignee/автор по реплике-источнику, а не один responsible на чат.
- Возможно — отдельные IdeaBlock-атрибуции по участникам.

## Почему отложено
Риск и объём: переписывает критичный ingest-путь; основная ценность (видеть группу, участников, имена, завести контакты/менеджеров) уже доставлена основным ТЗ. Граф и так впитывает переписку (single-attribution) — не теряется, лишь огрублена атрибуция в группах.

## Когда брать
По запросу владельца. Предусловие — основной ТЗ групп выкачен и подтверждён на проде.
