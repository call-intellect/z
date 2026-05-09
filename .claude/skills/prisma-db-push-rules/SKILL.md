---
name: prisma-db-push-rules
description: Правила работы с Prisma и схемой БД в Z: только db push, никаких migrate, обновление кода после изменения моделей. Используй этот скилл при ЛЮБОЙ задаче, где меняются таблицы, модели Prisma, enum, индексы, constraints, связи, или когда нужно применить изменения схемы. Обязателен если задача упоминает schema.prisma, миграции, или изменения структуры данных.
---

# Z: правила Prisma и схемы БД

## Главное правило

**Источник истины — текущая схема БД и актуальный `schema.prisma`.**

Не используем файловые миграции. Применяем изменения напрямую через `db push`.

---

## Что НЕЛЬЗЯ делать

```bash
# ЗАПРЕЩЕНО — не использовать никогда
prisma migrate dev
prisma migrate deploy
prisma migrate reset
prisma migrate diff

# ЗАПРЕЩЕНО — не создавать и не редактировать
backend/prisma/migrations/
```

Если ты видишь папку `migrations/` — не трогай её, это исторический артефакт.

---

## Что НУЖНО делать

```bash
# Применить изменения схемы
cd backend && bunx prisma db push

# Обновить Prisma Client после изменения схемы
cd backend && bunx prisma generate

# Посмотреть текущую схему
cat backend/prisma/schema.prisma

# Открыть Prisma Studio для инспекции данных
cd backend && bunx prisma studio
```

---

## Workflow изменения схемы

### Шаг 1: Редактируй `schema.prisma`

```prisma
// backend/prisma/schema.prisma

model Meeting {
  id          String   @id @default(cuid())
  title       String
  type        MeetingType
  status      MeetingStatus @default(SCHEDULED)
  hostId      String
  host        User     @relation(fields: [hostId], references: [id])
  scheduledAt DateTime?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([hostId])
  @@index([status])
}

enum MeetingStatus {
  SCHEDULED
  LIVE
  ENDED
  CANCELLED
}
```

### Шаг 2: Примени через db push

```bash
cd backend && bunx prisma db push
```

При деструктивных изменениях (удаление поля, изменение типа) — Prisma предупредит. Подтверждай только если понимаешь последствия.

### Шаг 3: Обнови Prisma Client

```bash
cd backend && bunx prisma generate
```

### Шаг 4: Обнови связанный код

После изменения модели обязательно проверь и обнови:

| Что | Где |
|-----|-----|
| DTO | `backend/src/<module>/dto/` |
| Service (запросы) | `backend/src/<module>/<module>.service.ts` |
| Types | `backend/src/<module>/<module>.types.ts` |
| Frontend API types | `frontend/src/types/<domain>.ts` |
| second-brain | `second-brain/02_architecture/data-model.md` |

### Шаг 5: Проверь typecheck

```bash
cd backend && bunx tsc --noEmit
```

---

## Правила именования

| Сущность | Конвенция | Пример |
|----------|-----------|--------|
| Таблица (model) | PascalCase | `MeetingRecording` |
| Поле | camelCase | `hostId`, `scheduledAt` |
| Enum | PascalCase | `MeetingStatus` |
| Enum value | SCREAMING_SNAKE | `LIVE`, `ENDED` |
| Индекс | `@@index([field])` | `@@index([hostId, status])` |
| Unique | `@@unique([...])` | `@@unique([meetingId, userId])` |

---

## Безопасные vs деструктивные изменения

### Безопасные (без потери данных)

- Добавить новое поле с default значением
- Добавить индекс
- Добавить новую модель
- Добавить новое значение в enum (в конец)
- Добавить опциональное поле (`String?`)

### Деструктивные (требуют осторожности)

- Удалить поле
- Переименовать поле (= удалить + создать)
- Изменить тип поля
- Удалить значение из enum
- Сделать поле обязательным (`String` вместо `String?`)

Для деструктивных изменений:
1. Убедись, что нет production-данных, которые сломаются
2. Если есть — сначала мигрируй данные через patch script
3. Потом применяй изменение схемы

---

## Чеклист после изменения схемы

- [ ] `bunx prisma db push` выполнен без ошибок
- [ ] `bunx prisma generate` выполнен
- [ ] DTO обновлены
- [ ] Сервисы обновлены
- [ ] `bunx tsc --noEmit` прошёл
- [ ] `second-brain/02_architecture/data-model.md` обновлён
