---
date: 2026-06-24
feature: chatbox-group-chats
branch: feature/chatbox-customer-vs-manager-split
---

# Полная поддержка групповых чатов ChatBox

## Что было поставлено
Владелец: в Telegram/MAX есть групповые чаты (несколько клиентов и/или менеджеров в одной переписке). Нужно корректно определять, что чат групповой, и участников с ролями/именами, привязывать к сущностям Коры. Текущая модель «1 чат = 1 клиент + 1 менеджер» для групп неверна.

Решения владельца (через AskUserQuestion): участники-клиенты → контакты `Entity{type=person}` под аккаунтом-Customer, менеджеры → Person (В1); **фазами** — идентификация/UI/контакты сейчас, пофименная граф-атрибуция — vNext (В2).

## Как решал (ТЗ + 4 фазы, силами суб-агентов)
ТЗ `plans/tz/2026-06-24-chatbox-group-chats.md`. Реализация через tz-orchestrator в текущей ветке (новую не плодил — правило владельца).
- **Ф1** `feat(chatbox): Группы Ф1` — `ChatboxChat.isGroup` + миграция `20260624160000_chatbox_chat_is_group`.
- **Ф2** `Группы Ф2` — детекция isGroup в `syncMessages` (>1 различного CLIENT `senderExternalId`); `ChatboxCustomersService.autoLinkChannelClients` (go-forward: channelClient→`Entity{person}`+`works_at` к аккаунту, `linkedContactEntityId`) из `syncChannelClients`. Закрыло пробел «go-forward контакты при синке» из реестра не-сделанного.
- **Ф3** `Группы Ф3` — `getChat` отдаёт `isGroup`+`participants[]` (groupBy senderExternalId/senderType + резолв имён из зеркал); `listMessages` резолвит `senderName` из зеркал; `listChats` — `isGroup`.
- **Ф4** `Группы Ф4` — FE: бейдж «Группа» (список+шапка), список участников в шапке, имена отправителей в переписке.

## Что вышло (верификация)
- backend typecheck/build = 0; FE build = 0, lint 0 errors.
- Спеки зелёные по фазам (chatbox-customers 27, chatbox-chats 23, chatbox-sync — с тестами isGroup/контакты). Прогонял изолированно (msgpackr-ускоритель .off на arm64).
- Миграция `isGroup` применена на dev (hand-author + psql + migrate resolve — `migrate dev` не реигрывает цепочку на shadow из-за AGE), `migrate status` = up to date.

## Чему научился
- **Ключевая находка фичи:** `message.senderExternalId` == `ChatboxChannelClient.externalId` (CLIENT → имя+customerId) / `ChatboxMember.externalId` (USER → имя). ChatBox НЕ отдаёт `sender.name` в сообщении (NULL) — имена участников берём из зеркал по id. Это снесло предположение «имя только на уровне чата».
- **Признак группы — производный** (нет API-флага): >1 различного CLIENT-отправителя в чате. Храним как `ChatboxChat.isGroup` (дешёвый фильтр), проставляем при синке.
- **Фазовое разбиение спасло объём:** идентификация/UI/контакты (доставлено) отделены от пофименной граф-атрибуции (vNext, переписывает критичный ingest) — по решению владельца.
- dev-БД: `migrate dev` по-прежнему не реигрывается (AGE shadow); миграции авторю вручную + apply + resolve; смёрженные из dev миграции добиваю baseline'ом (`migrate resolve --applied`).

## Не доделано (vNext, см. 04_не-сделано)
Пофименная атрибуция сообщений группы в knowledge-граф/задачи (ingestSession по отправителю) — заглушка `plans/tz/2026-06-24-chatbox-group-graph-attribution.md`, по «реализуй».

## Prod
Аддитивная миграция `isGroup` (авто через `migrate deploy`); прочее — код (sync/read/FE). Обычный `docker compose up -d --build backend frontend`.
