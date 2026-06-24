---
type: tz
status: ready-to-implement
feature: chatbox-group-chats
date: 2026-06-24
owner: Tozix
relates_to:
  - plans/tz/2026-06-23-chatbox-customer-vs-manager-split.md
  - plans/tz/2026-06-24-chatbox-dialogs-viewer.md
  - plans/tz/2026-06-24-chatbox-auto-link-on-sync.md
  - backend/src/modules/chatbox/chatbox-chats.service.ts
  - backend/scripts/backfill-chatbox-customers-from-person.ts
---

# Полная поддержка групповых чатов ChatBox (Telegram/MAX группы)

## Принцип
Чат ChatBox может быть **групповым** (несколько клиентов и/или менеджеров в одной переписке Telegram/MAX). Текущая модель «1 чат = 1 клиент + 1 ответственный» для групп неверна. Нужно: определить, что чат групповой; идентифицировать каждого участника (роль + **имя** из зеркал, т.к. ChatBox не отдаёт имя в сообщении); показать это в UI; авто-создать клиентов-участников как контакты под аккаунтом и менеджеров как Person. Пофименная атрибуция каждого сообщения в knowledge-граф/задачи — **vNext** (решение владельца «фазами»).

## Цель и зачем
**Болезненное состояние:** групповой чат отображается как обычный «1 клиент» (имя одного из участников в шапке), остальные участники не видны и не заводятся; в переписке у сообщений только «Клиент»/«Менеджер» без имён → непонятно, кто пишет.
**Лучше:** чат помечен «Группа», в шапке — список участников с именами и ролями, в переписке у каждого сообщения — имя отправителя; клиенты-участники заведены контактами под аккаунтом, менеджеры — сотрудниками.

## REALITY-CHECK (факты по коду и данным dev-БД на 2026-06-24)
| Что | Статус | Вывод |
|---|---|---|
| Флаг группы в ChatBox API | ❌ нет (`chat` без isGroup/chatType/kind; доку читали) | Признак выводим: distinct CLIENT `senderExternalId` > 1 |
| `ChatboxMessage.senderExternalId` | ✅ есть (`m.sender?.id`), `senderName` синкается NULL (ChatBox не отдаёт per-message имя) | Имя резолвим из зеркал по `senderExternalId` |
| `senderExternalId(CLIENT)` == `ChatboxChannelClient.externalId` | ✅ проверено на данных (даёт `name`+`customerId`) | Имя клиента-участника + его аккаунт |
| `senderExternalId(USER)` == `ChatboxMember.externalId` | ✅ (даёт `name` менеджера) | Имя менеджера-участника |
| `ChatboxChannelClient` (externalId,name,customerId,**linkedContactEntityId**) | ✅ модель есть; колонка `linkedContactEntityId` добавлена в split-ТЗ | Контакт-сущность вешаем сюда |
| Авто-линк при синке (ChatboxCustomer→Customer, ChatboxMember→Person, linkMode='auto') | ✅ реализован (`autoLinkUnlinked` в customers/members service, вызовы из syncCustomers/syncMembers) | Расширяем: channelClient→контакт |
| Контакт `Entity{person}` + `EntityLink(works_at)` к аккаунту | ✅ есть в backfill ([backfill-chatbox-customers-from-person.ts](backend/scripts/backfill-chatbox-customers-from-person.ts) `resolvePersonEntityId`/`linkContactToAccount`) — но только для МИГРАЦИИ, go-forward в синке НЕ делается (пробел в `04_не-сделано`) | Переносим логику в синк (go-forward) |
| Просмотр диалогов (`/chats/integrations/chatbox/chats` + детальная), `chatbox-chats.service` (listChats/getChat/listMessages), DTO `ChatListItemDto/ChatDetailDto/ChatMessageDto` | ✅ есть | Расширяем DTO: isGroup, participants[], resolved senderName |

**Вывод:** ~50% задела готово (модели, зеркала, авто-линк, контакт+works_at в backfill, UI диалогов). Остаток — флаг isGroup, детекция при синке, go-forward контакты, участники+имена в read/UI. Эта фича попутно закрывает пробел «go-forward авто-создание контактов при sync» из `04_не-сделано`.

## Принятые решения владельца (2026-06-24, не пересматривать)
| # | Решение | Обоснование |
|---|---|---|
| В1 | Клиент-участник → контакт `Entity{type=person}` под аккаунтом-`Customer` (через `ChatboxChannelClient.customerId` → ChatboxCustomer.linkedCustomerId → Customer.entityId, связь `EntityLink works_at`); менеджер → `Person` | Переиспользует модель account+контакты и имена из зеркал |
| В2 | **Фазами**: сейчас — детекция группы + участники с именами/ролями (UI) + авто-создание контактов/менеджеров; пофименная атрибуция сообщений в граф/задачи — **vNext** | Снизить риск; ingest и так впитывает переписку |

### Проектные решения автора (закрытые развилки)
| # | Решение | Почему |
|---|---|---|
| Б1 | `ChatboxChat.isGroup Boolean @default(false)` — **хранимая колонка**, выставляется при синке (в `syncMessages` после upsert сообщений: `distinct senderExternalId WHERE senderType='CLIENT' > 1`) | Хранимый флаг → дешёвый фильтр/бейдж в списке без подсчёта на каждый запрос; миграция аддитивная |
| Б2 | Участники чата — **вычисляются при чтении** (`getChat`): `groupBy senderExternalId,senderType` по ChatboxMessage + резолв имён из ChatboxChannelClient/ChatboxMember | Не дублируем данные; участники = производное от сообщений |
| Б3 | Per-message `senderName` — **резолвится при чтении** (`listMessages`) из зеркал по `senderExternalId` (CLIENT→channelClient.name, USER→member.name, ASSISTANT→'Ассистент'), не из `ChatboxMessage.senderName` (он NULL) | Имена есть только в зеркалах; работает и для 1:1, и для групп; заменяет chat-level fallback из split-ветки |
| Б4 | Go-forward контакты — новый метод `ChatboxCustomersService.autoLinkChannelClients(tenantId)` (зеркало backfill Stage B), вызов из `syncChannelClients` | Та же логика, что в backfill, но при синке; закрывает пробел go-forward |

## Доказательство выбора (сжатая матрица)
| Критерий | A: контакты под аккаунтом (выбран, В1) | B: группа=1 Customer | C: только UI |
|---|---|---|---|
| Пофимённый клиент в графе/CRM | ✓ | ✗ | ✗ |
| Переиспользует account+контакты+зеркала | ✓ | ~ | ✗ |
| Имена участников в UI | ✓ | ✓ | ✓ |
| Объём/риск | средний | низкий | низкий |
| Закрывает go-forward-контакты пробел | ✓ | ✗ | ✗ |
Challenge-loop: (1) корень — да, лечим класс «групповой чат не разложен на участников», а не один кейс; (2) эффективно — переиспущаем backfill-логику и зеркала, не плодим; (3) без кода ради кода — пофимённая граф-атрибуция отложена в vNext (В2), не тащим преждевременно.

## Scope
**Входит:** `isGroup` (колонка+миграция+детекция при синке); go-forward авто-контакты (channelClient→Entity{person}+works_at); read — `getChat` отдаёт `isGroup`+`participants[]`, `listMessages` отдаёт резолв-`senderName`; FE — бейдж «Группа», список участников в шапке, имя отправителя в переписке.
**Не входит (vNext, заглушки в relates_to):**
- **Пофименная атрибуция сообщений в knowledge-граф/задачи** (ingestSession по каждому отправителю вместо одного customer/responsible) → новый ТЗ `plans/tz/2026-06-24-chatbox-group-graph-attribution.md` (создать заглушкой при выкате). Сейчас ingest остаётся как есть (single-attribution).
- Server-side флаг группы из ChatBox (если появится в API) — пока производный признак.

## Граничные контракты
- `chatbox-ingest.service.ingestSession` — **не трогаем** в этой фиче (single customer/responsible остаётся; пофимённая атрибуция — vNext).
- Авто-линк customers/members (`autoLinkUnlinked`) — **не трогаем**, добавляем рядом `autoLinkChannelClients`.

## Контракты

### Prisma — `ChatboxChat.isGroup` (миграция `chatbox_chat_is_group`)
```prisma
// в model ChatboxChat (backend/prisma/schema.prisma):
isGroup Boolean @default(false)
```
Команда: `bun run prisma:migrate -- --name chatbox_chat_is_group` + `bun run prisma:generate`. Аддитивная (ADD COLUMN с дефолтом), без потери данных, backfill не нужен (детекция проставит при следующем синке; для существующих — опц. одноразовый backfill, см. Ф2 «Что НЕ входит»).

### DTO (backend/src/modules/chatbox/dto/chatbox-chats.dto.ts)
```ts
export interface ChatboxParticipantDto {
  externalId: string;
  role: 'client' | 'manager' | 'assistant' | 'quality_control';
  name: string | null;
  messageCount: number;
}
// + в ChatListItemDto и ChatDetailDto:
isGroup: boolean;
// + в ChatDetailDto:
participants: ChatboxParticipantDto[];
// ChatMessageDto.senderName — теперь резолвится из зеркал (контракт прежний, значение непустое где есть зеркало)
```

### Резолв имени по senderExternalId (общий хелпер в chatbox-chats.service)
- CLIENT: `ChatboxChannelClient.findMany({where:{tenantId, externalId:{in:[...]}}, select:{externalId,name}})` → Map.
- USER: `ChatboxMember.findMany({where:{tenantId, externalId:{in:[...]}}, select:{externalId,name}})` → Map.
- ASSISTANT → 'Ассистент'; QUALITY_CONTROL → 'Контроль качества'; нет в зеркале → null.

### Go-forward контакт (ChatboxCustomersService.autoLinkChannelClients, зеркало backfill Stage B)
Для каждого `ChatboxChannelClient where { tenantId, linkedContactEntityId: null }`: имя=`name||externalId`; `findOrCreate Entity{type:'person'}` (дедуп email→canonicalName, как `resolvePersonEntityId` в backfill); `update linkedContactEntityId`; если `customerId` → его ChatboxCustomer.linkedCustomerId → Customer.entityId → `EntityLink(works_at)` контакт→аккаунт (как `linkContactToAccount`). Идемпотентно (фильтр NULL).

## Фазы (dependency-ordered: Ф1 → Ф2 → Ф3 → Ф4)

### Фаза 1 — schema `isGroup` + миграция `[x]`
**Файлы:** backend/prisma/schema.prisma (model ChatboxChat, якорь `model ChatboxChat`).
**Входит:** поле `isGroup Boolean @default(false)`; `prisma:migrate --name chatbox_chat_is_group`; `prisma:generate`.
**Не входит:** детекция (Ф2), read/FE.
**Acceptance:** `grep "isGroup" backend/prisma/schema.prisma`→1; файл миграции с `ADD COLUMN "isGroup"`; `bun run typecheck`=0 (`prisma.chatboxChat.isGroup` доступно).
**Закрывает:** R1.

### Фаза 2 — детекция группы при синке + go-forward контакты `[x]`
**Файлы:** chatbox-sync.service.ts (`syncMessages`, `syncChannelClients`), chatbox-customers.service.ts (новый `autoLinkChannelClients`), их `.spec.ts`.
**Входит:**
- В `syncMessages` (после upsert сообщений + `rebuildSessions`, рядом с `chatboxChat.update({messageCount,lastMessageAt})`): посчитать distinct CLIENT-отправителей чата (`chatboxMessage.findMany({where:{tenantId,chatId,senderType:'CLIENT'}, select:{senderExternalId:true}, distinct:['senderExternalId']})` → length>1) и записать `isGroup`.
- `ChatboxCustomersService.autoLinkChannelClients(tenantId)` (контракт выше) + вызов в конце `syncChannelClients` (как `customers.autoLinkUnlinked` в syncCustomers).
**Не входит:** одноразовый backfill `isGroup` для исторических чатов (детекция проставит при следующем синке; если нужно сейчас — отдельный `backfill-chatbox-is-group.ts`, vNext); read/FE.
**Acceptance:** `bun run typecheck`+`build`=0; unit: чат с >1 CLIENT-отправителем → `isGroup=true`, с одним → false; `autoLinkChannelClients` для unlinked channelClient создаёт Entity{person}+works_at и ставит linkedContactEntityId, повтор=no-op; `grep "autoLinkChannelClients" chatbox-sync.service.ts`→1.
**Закрывает:** R2, R3.

### Фаза 3 — read: участники + isGroup + резолв имён `[x]`
**Файлы:** chatbox-chats.service.ts (listChats/getChat/listMessages), dto/chatbox-chats.dto.ts, chatbox-chats.service.spec.ts.
**Входит:** DTO (выше); `listChats`/`getChat` отдают `isGroup`; `getChat` — `participants[]` (groupBy senderExternalId+senderType по ChatboxMessage, резолв имён из зеркал, messageCount); `listMessages` — `senderName` резолвится из зеркал по senderExternalId (batch).
**Не входит:** FE; ingest.
**Acceptance:** `bun run typecheck`+`build`=0; unit: getChat возвращает isGroup + participants с именами/ролями/счётчиками; listMessages резолвит senderName из channelClient/member (не из ChatboxMessage.senderName); Swagger чатов содержит поля. 
**Закрывает:** R4, R5.

### Фаза 4 — FE: бейдж «Группа» + участники + имена `[x]`
**Файлы:** frontend/src/api/chatbox.api.ts (типы isGroup/participants/senderName), frontend/src/domain/chatbox.ts (лейблы ролей участников), ChatboxChatsListClient.tsx (бейдж «Группа» в строке), ChatboxChatViewClient.tsx (шапка: список участников с именами+ролями; переписка: имя отправителя из `m.senderName` резолва).
**Входит:** в списке у групповых чатов — бейдж «Группа»; в шапке детальной — блок «Участники: имя (роль), …»; в пузырях — имя из резолв-`senderName` (fallback роль).
**Не входит:** новые страницы; редактирование.
**Acceptance:** `cd frontend && bun run lint`+`bun run build`=0; групповой чат показывает бейдж «Группа» и список участников; в переписке у сообщений видны имена; UI только русский; токены bg-*/text-*-fg.
**Закрывает:** R6.

## Требования
- **R1** Когда применяется миграция, `ChatboxChat` имеет `isGroup` (default false).
- **R2** Когда синкаются сообщения чата, система shall выставить `isGroup=true`, если различных CLIENT-отправителей >1, иначе false.
- **R3** Когда синкаются channel-clients, система shall авто-создать для непривязанных контакт `Entity{type=person}` + `EntityLink(works_at)` к аккаунту и проставить `linkedContactEntityId` (идемпотентно).
- **R4** Когда запрашивается `getChat`, система shall вернуть `isGroup` и `participants[]` (роль+имя+messageCount), имена резолвятся из зеркал.
- **R5** Когда запрашивается `listMessages`, система shall вернуть `senderName`, резолвленное из зеркал по `senderExternalId`.
- **R6** Когда открыт групповой чат в UI, система shall показать бейдж «Группа», список участников с именами/ролями и имя отправителя у каждого сообщения.

## Pre-mortem / ревью-аспекты
- **Детекция ложно-групповых** (бот-лента с 1 CLIENT — не группа; норм. порог >1). Ревью: порог и что bot-sender считается CLIENT.
- **Производительность getChat participants** — groupBy по сообщениям одного чата дёшево; для очень больших чатов — ок (один чат). Не преждевременно оптимизировать.
- **Дедуп контактов** — `findOrCreate Entity{person}` по имени может слить тёзок; митигировать email если есть, иначе name (как backfill). Ревью kNN/name.
- **tenant-scope** — все выборки по tenantId; участники/контакты в рамках Org.
- **Идемпотентность** autoLinkChannelClients — фильтр linkedContactEntityId NULL.

## DoD
typecheck/lint/build зелёные; spec'и зелёные; second-brain `02_architecture/data-model.md` (ChatboxChat.isGroup), `01_projects/<chatbox>.md` (группы/участники), `04_не-сделано/README.md` — снять строку «go-forward авто-создание контактов при sync» (закрыто Ф2) + добавить «пофименная граф-атрибуция групп» (vNext); `prod-deploy-log.md` Шаг 4 (миграция isGroup); рефлексия. Миграция применяется авто (`migrate deploy`); прочих прод-операций нет.

## Итог
(заполнит tz-orchestrator)
