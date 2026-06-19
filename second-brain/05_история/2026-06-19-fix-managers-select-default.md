---
date: 2026-06-19
title: Фикс — пустой select и неверный дефолт в сопоставлении менеджеров ChatBox и Bitrix
tags: [chatbox, bitrix, frontend, bug]
distilled: false
---

# Рефлексия: фикс сопоставления менеджеров

## Что было поставлено

Пользователь сообщил: на страницах сопоставления менеджеров (ChatBox и Bitrix)
select'ы либо пустые, либо не дефолтят на «Создать нового сотрудника» когда совпадений нет.

## Диагностика

**Баг 1 — пустой триггер select:** возникает когда `linkMode === 'auto'` и `linkedPersonId` установлен,
но этот Person не попадает в `personOptions`. ChatBox-страница загружает persons через
`personsDomainApi.list(orgId, { relationship: 'employee' })`. Person, созданный в ходе ChatBox-синка,
может не иметь relationship `employee` → его UUID есть как value, но нет соответствующего `<SelectItem>` →
Radix Select показывает пустой триггер.

**Баг 2 — дефолт NONE вместо CREATE:** `currentValue(member)` возвращал `member.linkedPersonId ?? NONE_VALUE`.
Когда `linkedPersonId === null` (не найдено совпадение, `linkMode === 'none'`), дефолт был «— Не связывать —».
Ожидаемое: когда никогда не связан → дефолт «Создать нового сотрудника».

## Решение

**ChatBox и Bitrix (оба файла одинаково):**

1. `currentValue()`: если `linkedPersonId` null и `linkMode === 'none'` → возвращаем `CREATE_VALUE`.
   `linkMode === 'manual'` с null person = явный выбор «не связывать» → NONE_VALUE сохраняется.

2. `MemberRow`/`UserRow`: вычисляем `allOptions` — если `linkedPersonId` установлен, но отсутствует
   в `personOptions`, добавляем его в начало списка (используем `linkedPersonName` из API).
   Это чинит пустой триггер без изменения списка для остальных.

## Файлы

- [ChatboxManagersClient.tsx](../../frontend/app/(authenticated)/chats/integrations/chatbox/managers/ChatboxManagersClient.tsx)
- [BitrixManagersClient.tsx](../../frontend/app/(authenticated)/company-admin/sources/bitrix/managers/BitrixManagersClient.tsx)

## Чему научился

- Radix Select при `value` не совпадающем ни с одним `SelectItem` молча показывает пустой триггер (placeholder не появляется, просто blank). Инвариант: value всегда должен быть в options.
- `linkMode: 'none'` ≠ «явно не связан». «Явно не связан» = `linkMode: 'manual'` + `linkedPersonId: null`. Важно различать при выборе дефолта.
