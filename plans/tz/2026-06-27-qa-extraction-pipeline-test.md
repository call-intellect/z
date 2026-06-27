# QA-задание: полный тест пайплайна извлечения сущностей (крупный объём + жизненный цикл карточки)

**Дата:** 2026-06-27
**Исполнитель:** агент-тестировщик
**Приоритет:** P0 — ручная приёмка до выката
**Кабинет:** прод korateam.ru, тестовый аккаунт. Данные грузим и **оставляем** (без чистки). Прод почти пуст (~4 юзера), синтетика не мешает.
**Фикстуры (тексты):** `plans/analysis/qa-extraction-test/fixtures.md` — три крупных текста + размеченные ожидания.

> Этот файл переписан после изучения кода 2026-06-27. Исправлены: путь загрузки (только ассистент), реальные эндпоинты (часть прежних — выдуманы), тайминг (поллинг), добавлен жизненный цикл карточки. Журнал расхождений — в конце.

---

## 0. Доступ к кабинету и API

### Вход
Используй скилл **`qa-tester`** — он знает вход в korateam.ru через тестовый аккаунт (`~/.qa-cabinet.local.json`, креды не спрашивать). После входа — залогиненная Playwright-сессия.

### Чтение API из браузера
Все запросы — из браузера через `browser_evaluate` (cookie-сессия + `X-Org-Id`). Глобальный префикс `/api/v1`. `orgId` достать после входа:
```javascript
// orgId обычно в URL /org/<id>/... либо в localStorage; вытащить надёжно:
const orgId = location.pathname.match(/\/org\/([0-9a-f-]+)/i)?.[1]
  || localStorage.getItem('currentOrgId')
  || (await (await fetch('/api/v1/me')).json())?.currentOrgId;
console.log('orgId=', orgId);
```
Хелпер для всех чтений:
```javascript
async function api(path) {
  const r = await fetch(path, { headers: { 'X-Org-Id': orgId } });
  if (!r.ok) return { __error: r.status, __path: path };
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Org-Id': orgId },
    body: JSON.stringify(body),
  });
  if (!r.ok) return { __error: r.status, __path: path };
  return r.json();
}
```

### Реальные эндпоинты (проверены по контроллерам)

| Что | Запрос |
|---|---|
| Идеи | `GET /api/v1/ideas?limit=100` → `{items,total}` |
| Идея по id | `GET /api/v1/ideas/:id` |
| Решения | `GET /api/v1/decisions?limit=100` → `{items,...}` |
| Решение по id | `GET /api/v1/decisions/:id` |
| Задачи (org-wide) | `GET /api/v1/issues?limit=200` → `{items,total}` |
| Задача по id | `GET /api/v1/issues/:id` |
| Входящие (IntakeIssue) | `GET /api/v1/intake?limit=100` → `{items,...}` |
| Сущности графа | `GET /api/v1/knowledge/entities?limit=200` → `{items,total}` |
| **Блокеры/риски/обязательства** | `POST /api/v1/knowledge/search` body `{ "query":"...", "signalTypes":["blocker"], "limit":50 }` → `{results,tookMs}` |
| Provenance | `GET /api/v1/provenance/:entityType/:entityId` |
| Прогресс задачи | `GET /api/v1/issues/:id/progress-updates` |
| Комментарии задачи | `GET /api/v1/issues/:id/comments` |
| Переход статуса | `POST /api/v1/issues/:id/transitions` body `{stateId, reason?}` |
| Переход по категории | `POST /api/v1/issues/:id/transition-to-category` |
| Pending-actions (закрытия) | `GET /api/v1/pending-actions` ; `POST /api/v1/pending-actions/confirm` |

> ⚠️ Выдумано в старой версии (НЕ существует): `GET /knowledge/blocks?signalType=...`, префикс `/tracker/...`, поле ответа `.ideas`. Не использовать.

---

## 1. Как загружать тексты — ТОЛЬКО через ассистента

`POST /api/v1/ingest` из браузера **не работает** (нужен Bearer-ingest-токен и другая схема тела). Единственный путь из кабинета — чат-ассистент, он внутри сам зовёт ingest.

1. Перейди на `/chat` (пункт «Спросить»).
2. Отправь сообщение по шаблону (текст брать из `fixtures.md`):
   > «Кора, у нас была встреча команды. Вот транскрипт — проанализируй и сохрани задачи, решения, идеи, блокеры, риски и важные факты: \n\n[ТЕКСТ 1]»
3. Дождись ответа ассистента (он подтвердит приём).
4. **НЕ грузи следующий текст сразу** — дай пайплайну обработать (см. тайминг).

### Тайминг (важно — пайплайн асинхронный)
Цепочка: ingest → `block-ingest` (IdeaBlock `draft`) → `block-distill` (`draft→canonical`, debounce ~30с) → специалисты Слоя 3 (задачи/идеи/решения работают **только по canonical**) → IntakeIssue → авто-триаж → Issue.

Поэтому **не фиксированные 90с, а поллинг**: после загрузки текста опрашивай счётчики каждые 30с, считай готовым когда дельта перестала расти 2 опроса подряд, максимум ждать ~4 минуты на текст.
```javascript
async function poll(label, fn, maxMs=240000, stepMs=30000) {
  let prev=-1, stable=0, t=0;
  while (t < maxMs) {
    const v = await fn();
    console.log(`${label} t=${t/1000}s → ${v}`);
    if (v===prev) { if (++stable>=2) break; } else { stable=0; prev=v; }
    await new Promise(r=>setTimeout(r, stepMs)); t+=stepMs;
  }
  return prev;
}
```

---

## 2. ШАГ 0 — baseline до загрузки

```javascript
const baseline = {
  ideas:    (await api('/api/v1/ideas?limit=1')).total,
  decisions:(await api('/api/v1/decisions?limit=1')).total,
  issues:   (await api('/api/v1/issues?limit=1')).total,
  intake:   (await api('/api/v1/intake?limit=1')).total,
  entities: (await api('/api/v1/knowledge/entities?limit=1')).total,
};
console.log('BASELINE', baseline);
```
Записать. Все дальнейшие проверки — на **дельту**, а не на абсолют (в кабинете уже могут быть данные).

---

## 3. ШАГ 1 — Текст 1 (планёрка) + проверки

Загрузи Текст 1 через ассистента. Поллинг до стабилизации `issues+intake`. Затем:

### 3.1 Идеи — качество
```javascript
const ideas = (await api('/api/v1/ideas?limit=100')).items || [];
ideas.forEach(i => console.log(`[${i.status}] ${i.statement||i.title} :: rationale=${(i.rationale||'').slice(0,80)}`));
```
- [ ] Идея «Моя история / вовлечённость» есть, **rationale не пустой** (про retention).
- [ ] (опц.) Идея «понедельничный дайджест» есть.
- [ ] В идеях **нет** поручений («подготовить презентацию», «написать в поддержку», «актуализировать базу»). *Красный флаг → idea-extract пропускает задачи.*

### 3.2 Решения — чистота
```javascript
const dec = (await api('/api/v1/decisions?limit=100')).items || [];
dec.forEach(d => console.log(`[${d.status}] ${d.title||d.statement}`));
```
- [ ] Решение «retention — основная метрика квартала» есть.
- [ ] В решениях **нет** задач-поручений. *Красный флаг → task-decision-disambiguation не применился.*

### 3.3 Задачи — создание + интра-дедуп
```javascript
const issues = (await api('/api/v1/issues?limit=200')).items || [];
const intake = (await api('/api/v1/intake?limit=100')).items || [];
console.log('ISSUES', issues.length, 'INTAKE', intake.length);
[...issues, ...intake].forEach(i => console.log(`${i.title} | ${i.state?.category||i.status} | ${i.assignee?.name||i.suggestedAssigneeName||'—'}`));
```
- [ ] Появились 3 задачи: Анна→презентация, Михаил→запрос в Битрикс, Дарья→база (искать в `/issues` **и** `/intake` — на ранней стадии задача может быть ещё во входящих до авто-триажа).
- [ ] **Интра-дедуп:** «презентация онбординга» — **одна** карточка (в тексте дважды). *Красный флаг → дедуп ломается на перефразировке.*
- [ ] У каждой задачи есть исполнитель или она в intake с suggested-исполнителем.

### 3.4 Блокеры / Риски / Обязательства — через search
```javascript
for (const st of ['blocker','risk','commitment']) {
  const r = await apiPost('/api/v1/knowledge/search', { query: st==='blocker'?'Битрикс лимит':'риск база Zoom', signalTypes:[st], limit:20 });
  console.log(st.toUpperCase(), (r.results||[]).map(x=>x.snippet||x.content||x.title));
}
```
- [ ] Блокер «Битрикс API 429 / rate limit» найден.
- [ ] Риск «устаревшая база email-кампании» найден.
- [ ] Обязательства (Михаил→Битрикс, Дарья→база) найдены.

### 3.5 Сущности — гигиена
```javascript
const ent = (await api('/api/v1/knowledge/entities?limit=200')).items || [];
ent.forEach(e => console.log(`[${e.type}] ${e.canonicalName} (${e.mentionsCount})`));
```
- [ ] «Битрикс» есть.
- [ ] **Нет** сущностей: `429`, `ID-2024`, телефон `+7 916…`, любые `MTG-N`-подобные ID. *Красный флаг → гейт имён не работает.*

---

## 4. ШАГ 2 — Текст 2 (клиент) + проверки

Загрузи Текст 2. Поллинг. Затем:

### 4.1 Решение-ловушка
- [ ] Решение «пилот 3 мес / -30% потерянных задач → годовой контракт» есть.
- [ ] **Ловушка:** «если покажет 30%…» НЕ стало задачей «сделать 30%».

### 4.2 Задачи клиентской встречи
- [ ] A4 Александр→договор сегодня; A5 Дарья→техописание до четверга; A6 Александр→проверить Zoom Q3.
- [ ] **Факты не стали задачами:** «настроить Telegram» (уже есть), «хранить на росс. серверах».

### 4.3 Блокер + обязательство (search)
- [ ] Блокер «нет интеграции с Zoom».
- [ ] Обязательство «Александр проверит Zoom в roadmap».

### 4.4 Сущности
- [ ] «Логистик Плюс» (желательно `type=customer`), «Zoom», «Telegram» есть.
- [ ] **Нет** сущностей: ИНН-число, проценты `30`, телефон.

---

## 5. ШАГ 3 — Текст 3 (чат-день) + КРОСС-КАНАЛЬНЫЙ ДЕДУП

Загрузи Текст 3. Поллинг. Это ключевой шаг.

### 5.1 Дубли должны склеиться
```javascript
const all = [...(await api('/api/v1/issues?limit=200')).items, ...(await api('/api/v1/intake?limit=100')).items];
const base = all.filter(i => /баз|контакт/i.test(i.title||''));
const pres = all.filter(i => /презент|онбординг/i.test(i.title||''));
console.log('БАЗА:', base.length, base.map(i=>i.title));
console.log('ПРЕЗЕНТАЦИЯ:', pres.length, pres.map(i=>i.title));
```
- [ ] «база контактов» — **одна** карточка (Т1+Т3).
- [ ] «презентация онбординга» — **одна** карточка (Т1+Т3).
- [ ] Появились 2 новые: «exponential backoff Битрикс», «мониторинг ошибок Битрикс API».

> Примечание: порог дедупа задач 0.88 (cosine) строгий — если дубль всё же раздвоился, зафиксировать как наблюдение (перефразировка не склеилась), это известный риск (открытый пробел «двунаправленный дедуп»).

### 5.2 Идея vs задача из одного контекста
- [ ] «exponential backoff» как **предложение Анны** → идея (с rationale).
- [ ] «Михаил беру реализацию backoff» → отдельная **задача** A7. Идея и задача — разные записи.

### 5.3 Риск
- [ ] Риск «Битрикс не поднимет лимит → webhook-модель, 2 недели».

---

## 6. ШАГ 4 — ЖИЗНЕННЫЙ ЦИКЛ КАРТОЧКИ (главный сценарий)

Авто-закрытие запрещено (инвариант R13): из текста система создаёт только `TaskClosureCandidate(pending)`, закрывает человек.

### 6.1 Кандидаты на закрытие появились
В Тексте 3 были сигналы исполнения: «база готова/выполнена» (A3), «backoff реализован/закрыта» (A7). После поллинга:
```javascript
const pending = await api('/api/v1/pending-actions?limit=50');
console.log(JSON.stringify(pending, null, 2));
const closures = (pending.items||[]).filter(p => /closure|закры/i.test(p.source||p.type||''));
console.log('CLOSURE CANDIDATES:', closures.length);
```
- [ ] Есть кандидат(ы) на закрытие — минимум на задачу «база контактов» (A3).
- [ ] (опц.) Кандидат на «backoff» (A7). *Если ни одного — детект исполнения не работает, зафиксировать FAIL с JSON.*

### 6.2 Прогресс-апдейты (исполнения)
```javascript
const a3 = all.find(i => /баз|контакт/i.test(i.title||'')); // взять id карточки базы
const prog = await api(`/api/v1/issues/${a3.id}/progress-updates`);
console.log('PROGRESS A3:', JSON.stringify(prog, null, 2));
```
- [ ] На карточке «база» есть прогресс-апдейт/черновик из сигнала исполнения (авто-draft).

### 6.3 Подтверждаем закрытие
```javascript
const cand = closures[0];
const res = await apiPost('/api/v1/pending-actions/confirm', { id: cand.id, resolution: 'approve' });
console.log('CONFIRM:', JSON.stringify(res, null, 2));
```
> Точное тело confirm уточнить по ответу `GET /pending-actions` (поля `id`/`resolution`/`issueId`). Если поле иное — подстроить.

### 6.4 Карточка закрылась + решение в карточке
```javascript
const a3after = await api(`/api/v1/issues/${a3.id}`);
console.log('A3 state:', a3after.state?.category, 'completedAt:', a3after.completedAt);
const comments = await api(`/api/v1/issues/${a3.id}/comments`);
console.log('COMMENTS:', (comments.items||[]).map(c=>c.body?.slice(0,80)));
```
- [ ] Карточка «база» в `state.category='completed'`, `completedAt` заполнен.
- [ ] В комментариях карточки — запись-решение (`✅ Решение (из разговора): …`).

### 6.5 Каскад решения (best-effort)
```javascript
const decFinal = (await api('/api/v1/decisions?limit=100')).items || [];
decFinal.filter(d => d.status==='implemented').forEach(d => console.log('IMPLEMENTED:', d.title||d.statement));
```
- [ ] Если у закрытой задачи было связанное решение по общим блокам (`DecisionTaskLink`) и все его задачи закрыты → решение перешло в `implemented`.
- [ ] (best-effort) Проверить `GET /api/v1/issues/:id` карточки — есть ли `decisionLinks`. Линк формируется по пересечению `sourceBlockIds` — если не сформировался, зафиксировать как наблюдение, не FAIL.

---

## 7. ШАГ 5 — финальные скриншоты

Скриншот каждого раздела после полной загрузки (сохранять в `plans/analysis/qa-extraction-test/`):
1. `/ideas`  2. `/decisions`  3. `/issues` (или трекер)  4. `/intake` (входящие)  5. `/knowledge/entities` (или `/memory`).
К каждому — что видно, что корректно, что вызывает вопросы.

---

## 8. Сводная таблица проверок

| # | Что | Ожидание | Результат |
|---|---|---|---|
| T1-1 | Идея «Моя история» + rationale | ✅ | |
| T1-2 | Задачи НЕ в идеях | ✅ | |
| T1-3 | Решение retention | ✅ | |
| T1-4 | Задачи НЕ в решениях | ✅ | |
| T1-5 | 3 задачи созданы (issues/intake) | ✅ | |
| T1-6 | Интра-дедуп «презентация» = 1 | ✅ | |
| T1-7 | Блокер Битрикс (search) | ✅ | |
| T1-8 | Риск email-база (search) | ✅ | |
| T1-9 | Сущность «Битрикс» | ✅ | |
| T1-10 | `429`/`ID-2024`/телефон НЕ сущности | ✅ | |
| T2-1 | Решение «пилот 30%» (не задача) | ✅ | |
| T2-2 | 3 задачи клиент-встречи | ✅ | |
| T2-3 | «Telegram есть» / росс. серверы — не задачи | ✅ | |
| T2-4 | Блокер «нет Zoom» | ✅ | |
| T2-5 | Сущности Логистик Плюс/Zoom/Telegram | ✅ | |
| T3-1 | Кросс-дедуп «база» = 1 | ✅ | |
| T3-2 | Кросс-дедуп «презентация» = 1 | ✅ | |
| T3-3 | Новая задача «backoff» | ✅ | |
| T3-4 | Новая задача «мониторинг» | ✅ | |
| T3-5 | Идея «backoff» (предложение Анны) | ✅ | |
| T3-6 | Риск «webhook-модель» | ✅ | |
| L-1 | Кандидат на закрытие A3 создан | ✅ | |
| L-2 | Прогресс-апдейт на A3 | ✅ | |
| L-3 | Подтверждение закрытия прошло | ✅ | |
| L-4 | Карточка A3 completed + решение-коммент | ✅ | |
| L-5 | Каскад Decision→implemented (best-effort) | ⚪ | |

---

## 9. Как писать отчёт
По каждой строке: `✅ PASS` / `❌ FAIL` (+ JSON ответа, который удивил, + гипотеза со ссылкой на ТЗ) / `⚠️ PARTIAL` / `❓ SKIP`.

## 10. Связанные ТЗ (для диагностики)
| Проблема | ТЗ | Статус |
|---|---|---|
| Задача vs решение | `2026-06-25-task-decision-disambiguation.md` | реализовано |
| Качество идей / rationale | `2026-06-25-idea-quality.md` | реализовано |
| Мусор в сущностях | `2026-06-25-knowledge-graph-hygiene.md` | реализовано |
| Дедуп задач / reconcile | `2026-06-16-task-dedup-and-tracker-reconcile.md` → `tracker/services/task-dedup.service.ts` | реализовано (порог 0.88) |
| Дроп legacy Task | `2026-06-25-drop-legacy-task-model-unify-on-issue.md` | реализовано (PR #61) |
| Кросс-канальный дедуп (двунаправленный) | открытый пробел | частично |

## 11. Журнал расхождений со старой версией ТЗ
- Загрузка: убран выдуманный `POST /api/v1/ingest` из браузера → только ассистент `/chat`.
- Блокеры/риски: `GET /knowledge/blocks?signalType=` не существует → `POST /api/v1/knowledge/search` с `signalTypes[]`.
- Пути трекера: убран префикс `/tracker/` → `/api/v1/issues`, `/api/v1/intake`.
- Тайминг: фикс. 90с → поллинг до стабилизации (distill debounce + специалисты).
- Задачи: учтён двухступенчатый путь IntakeIssue → авто-триаж → Issue (искать в обоих).
- Добавлен ШАГ 4 — полный жизненный цикл карточки с подтверждением закрытия (R13: авто-закрытие запрещено).
- Данные увеличены до крупных (fixtures.md), сквозная нить закрытия карточки.
