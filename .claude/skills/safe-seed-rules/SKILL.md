---
name: safe-seed-rules
description: Правила безопасной работы с Prisma seeds, sync scripts и DB patch scripts в Z: защита admin-edited данных, bun runtime, one-off patches вместо mass sync. Используй этот скилл при ЛЮБОЙ задаче, где нужно писать или редактировать seed.ts, seed-incremental.ts, seed-*.ts, скрипты в backend/scripts/, или любые DB-writing скрипты. Обязателен если задача касается промптов AI-отчётов, шаблонов встреч, конфигов или других admin-editable данных.
---

# Z: правила безопасной работы с seeds и DB scripts

## Главный принцип

**Admin-edited данные защищены от overwrite по умолчанию.**

Если запись в БД могла быть изменена через админку — никогда не перезаписывай её содержимое в скрипте без явной проверки.

В Z это критично для:
- промптов AI-отчётов по типу встречи (admin-editable)
- шаблонов 9 типов встреч
- email-уведомлений
- конфигов retention/тарифов

---

## Типы скриптов и их назначение

| Скрипт | Назначение | Когда использовать |
|--------|-----------|-------------------|
| `seed.ts` | Bootstrap — первоначальное наполнение пустой БД | Только при первом запуске на новой БД |
| `seed-incremental.ts` | Добавление новых записей без overwrite | Регистрация новых ключей, новых конфигов |
| `seed-*.ts` | Специализированные seed'ы по доменам | Домен-специфичные bootstrap данные |
| `scripts/patches/` | One-off патчи для точечных изменений | Обновление конкретной записи в prod |
| `scripts/sync-*` | Mass sync с явным предупреждением | ТОЛЬКО если overwrite является целью |

---

## Runtime: только bun

```bash
# Правильно — через package.json scripts
cd backend && bun run seed
cd backend && bun run seed:incremental
cd backend && bun run patch:2026-05-06-update-meeting-prompt

# Неправильно — не использовать в prod
npx tsx backend/prisma/seed.ts
node backend/prisma/seed.ts
ts-node backend/prisma/seed.ts
```

Все скрипты должны быть прописаны в `backend/package.json`:

```json
{
  "scripts": {
    "seed": "bun prisma/seed.ts",
    "seed:incremental": "bun prisma/seed-incremental.ts",
    "patch:2026-05-06-update-meeting-prompt": "bun scripts/patches/2026-05-06-update-meeting-prompt.ts"
  }
}
```

---

## Защита admin-edited данных

### Паттерн безопасного upsert

```typescript
// Безопасно: регистрируем ключ, не трогаем content если он уже есть
await prisma.promptRegistry.upsert({
  where: { key: 'meeting.report.standup' },
  create: {
    key: 'meeting.report.standup',
    content: DEFAULT_CONTENT,   // только при создании
    isActive: true,
  },
  update: {
    // НЕ перезаписываем content — он мог быть изменён в админке
    // Обновляем только метаданные
    name: 'Standup meeting report',
    variables: ['transcript', 'participants'],
  },
});
```

### Паттерн "только если не существует"

```typescript
const existing = await prisma.meetingTypeTemplate.findUnique({
  where: { key: 'standup' }
});

if (!existing) {
  await prisma.meetingTypeTemplate.create({
    data: {
      key: 'standup',
      titleRu: 'Стендап',
      defaultDurationMin: 15,
    }
  });
  console.log('Created meeting type: standup');
} else {
  console.log('Skipped (already exists): standup');
}
```

---

## One-off patch scripts

Для точечного изменения существующей записи — отдельный скрипт с защитами:

```typescript
// backend/scripts/patches/2026-05-06-update-standup-prompt.ts

const NEW_CONTENT = `...новый текст промпта...`;
const EXPECTED_VERSION = 2;

const patch = async () => {
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.promptRegistry.findUnique({
      where: { key: 'meeting.report.standup' }
    });

    if (!existing) {
      console.error('Record not found, skipping');
      return;
    }

    // Защита от повторного применения
    if (existing.version !== EXPECTED_VERSION) {
      console.log(`Version mismatch: expected ${EXPECTED_VERSION}, got ${existing.version}. Skipping.`);
      return;
    }

    await prisma.promptRegistry.update({
      where: { key: 'meeting.report.standup' },
      data: {
        content: NEW_CONTENT,
        version: EXPECTED_VERSION + 1,
      }
    });

    console.log('Patch applied successfully');
  } finally {
    await prisma.$disconnect();
  }
};

patch().catch(console.error);
```

---

## Именование скриптов

| Тип | Шаблон | Пример |
|-----|--------|--------|
| Patch script | `YYYY-MM-DD-что-делает.ts` | `2026-05-06-update-standup-prompt.ts` |
| Sync script | `sync-<domain>.ts` | `sync-meeting-types.ts` |
| Seed domain | `seed-<domain>.ts` | `seed-meeting-types.ts` |

**Важно:** если скрипт может перезаписать данные — называй его `sync-*`, не `seed-*`. Название сигнализирует об опасности.

---

## seed.ts — только bootstrap

`backend/prisma/seed.ts` считается bootstrap-only:
- Запускается только на пустой БД
- Не должен содержать mass sync логику
- Не должен вызываться в production для обновления данных

Если нужно добавить новые записи к существующей БД — используй `seed-incremental.ts` или patch script.

---

## Чеклист перед написанием DB-writing скрипта

- [ ] Какой тип скрипта нужен? (bootstrap / incremental / one-off patch / sync)
- [ ] Admin-edited поля защищены от overwrite?
- [ ] Скрипт идемпотентен (повторный запуск не сломает данные)?
- [ ] Версионная защита есть (для patch scripts)?
- [ ] Скрипт добавлен в `backend/package.json` scripts?
- [ ] Используется `bun`, не `npx tsx`?
- [ ] Название отражает опасность (sync vs seed)?
