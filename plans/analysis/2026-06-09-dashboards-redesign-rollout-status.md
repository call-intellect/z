# Статус раскатки редизайна дашбордов — перепроверка по коду (2026-06-09)

**Контекст.** Владелец заметил: главный дашборд `/dashboard` «появился с новым дизайном», но при заходе внутрь часть дашбордов осталась на старом языке. Ниже — поэкранная перепроверка по реальному коду фронта (не по ТЗ).

**ТЗ:** [plans/tz/2026-06-08-dashboards-redesign-modern-visual-language.md](../tz/2026-06-08-dashboards-redesign-modern-visual-language.md)
**Эталон языка:** `frontend/app/(design-preview)/redesign/page.tsx` (URL `/redesign`).

## Маркеры «нового языка» (по которым классифицировал)

1. **Фон страницы** — `MODERN_PAGE_BG` из `@/ui/components/dashboard/modern` (глубокий индиго-градиент). Самый заметный глазами признак.
2. **Стеклянные карточки** — `GlassCard / StatCard / GaugeCard / AreaTrend / DonutCard / RadarCard / BarTrend / Heatmap / ModernTable / AiCard / CardTitle` из той же папки + дата-виз `recharts`.
3. **Старый язык** — плоские карточки `Card/CardHeader/CardContent` из `@/ui/shadcn/card`, `KpiHero`.

## Корень проблемы (одной фразой)

**Фон (`MODERN_PAGE_BG`) накатили почти везде, а содержимое (карточки) мигрировали выборочно.** Поэтому страницы «выглядят новыми» по фону, но половина дашбордов — это старые плоские карточки на новом градиентном фоне. Хуже всего там, где glass-компоненты **импортированы, но не отрисованы** (Операционная сводка).

## Поэкранная таблица

| Маршрут | Экран | Новый фон | Карточки | Вердикт |
|---|---|:---:|---|---|
| `/dashboard` | Главная (директор) — `DirectorDashboardClient` | ✅ | KPI-строка `KpiHero` (стар.) + виджеты в табах `Card` (стар.); но 5 виджетов первого экрана новые (Польза/Чат/Вектор/Идеи/Что узнали) | ⚠️ **ЧАСТИЧНЫЙ** |
| `/dashboard/operations` | Операционная сводка — `OperationsDashboardClient` | ✅ | 7× `KpiHero` + ~10 старых `Card`; glass импортирован, но **не отрисован** | 🔴 **ТОЛЬКО фон** (худший случай) |
| `/dashboard/operations/daily` | Сводка за день — `DailyDigestClient` | ✅ | 1 секция `GlassCard` (блокеры), остальное ~8 старых секций | ⚠️ **ЧАСТИЧНЫЙ** |
| `/dashboard/operations/weekly` | Сводка за неделю — `WeeklyDigestClient` | ✅ | 1 секция `GlassCard` (идеи), остальное ~8 старых секций | ⚠️ **ЧАСТИЧНЫЙ** |
| `/dashboard/portfolio` | Портфель целей — `PortfolioDashboardClient` | ✅ | GaugeCard, DonutCard (recharts), GlassCard, ModernTable; старых `Card` — 0 | ✅ **ПОЛНЫЙ новый** |
| `/dashboard/value-recap` | Что сделала Кора — `ValueRecapDashboardClient` | ✅ | GlassCard, AiCard, CardTitle; старых `Card` — 0 | ✅ **ПОЛНЫЙ новый** |
| `/goals` | Цели — `GoalsClient` | ✅ | Всё в GlassCard; старых `Card` — 0 | ✅ **ПОЛНЫЙ новый** |
| `/maturity` | Зрелость — `MaturityClient` | ✅ | 3× GlassCard; старых `Card` — 0 | ✅ **ПОЛНЫЙ новый** |
| `/actions` | Действия — `ActionsClient` | ✅ | 2× GlassCard; старых `Card` — 0 | ✅ **ПОЛНЫЙ новый** |
| `/me` | Кабинет «Я» (сюда редиректятся manager/member) — `MeClient` | ❌ **нет фона** | Верх (профиль/документы/встречи) — старые `Card`; низ — 4 новых glass-виджета | ⚠️ **ЧАСТИЧНЫЙ + нет фона** |

### Вне периметра / мёртвое

| Объект | Статус |
|---|---|
| `frontend/app/(authenticated)/dashboard/DashboardClient.tsx` | 🪦 **мёртвый код** — не импортируется ни одним `page.tsx` (роутинг идёт через `DashboardRouter` → `DirectorDashboardClient` либо редирект на `/me`). Удалить/заархивировать. |
| Админка (super-admin): `/admin`, `/admin/analytics/*`, billing/health/media | ❌ **СТАРЫЙ** — это Фаза 4 ТЗ, не начата |
| `/sprints/[id]` (`SprintDashboardClient`) | ❌ старый, вне периметра редизайн-ТЗ (Ф2/Ф3 его не упоминают) |

## Маппинг на фазы ТЗ

| Фаза | Объём | Факт |
|---|---|---|
| **Ф1 — Фундамент** | токены + компоненты `dashboard/modern/` | ✅ **ГОТОВО** — папка `modern/` укомплектована (15 файлов), `MODERN_PAGE_BG` живёт |
| **Ф2 — Флагман + худшее** | `/dashboard` (+табы), `/dashboard/operations`, daily, weekly | ⚠️ **ЧАСТИЧНО** — фон есть везде, контент мигрирован выборочно; `operations` практически не тронут |
| **Ф3 — Кабинет** | `/goals`, `/me`, `/actions`, `/maturity` | ⚠️ **ЧАСТИЧНО** — goals/actions/maturity ✅ готовы; **`/me` не доделан** (нет фона, верх старый) |
| **Ф4 — Админка** | `/admin/*` | ❌ **НЕ начата** |
| **Ф5 — Доводка** | светлая тема, a11y-контраст, perf blur, QA | ❌ **НЕ начата** |

## Что доделать (приоритет — по заметности владельцу)

1. **`/dashboard/operations` — Операционная сводка.** Самый громкий разрыв: висит первой pill-ссылкой в шапке главной, фон новый, а внутри 7 старых KPI + 10 плоских карточек. Перевести `KpiHero → StatCard`, секции → `GlassCard`. Glass уже импортирован — осталось применить.
2. **`/me` — Кабинет «Я».** Нет нового фона вообще (низ страницы — новые glass-виджеты на сером фоне = визуальный диссонанс). Добавить обёртку `MODERN_PAGE_BG` + перевести верхние блоки (профиль/документы/встречи) на `GlassCard`. Это экран, который видят все рядовые.
3. **`/dashboard` — таб-контент главной.** KPI-строка (`KpiHero`) и виджеты табов (Сигналы/Темы/Сущности/Вопросы) — старые `Card`. Перевести на `StatCard`/`GlassCard`.
4. **`/dashboard/operations/daily` и `/weekly`.** Перевести оставшиеся ~8 секций каждого на `GlassCard` (сейчас по 1 секции).
5. **Уборка:** удалить мёртвый `DashboardClient.tsx`.
6. Ф4 (админка) и Ф5 (светлая тема, a11y, perf) — отдельными волнами.

## Итог

- **Полностью новые (5):** `/dashboard/portfolio`, `/dashboard/value-recap`, `/goals`, `/maturity`, `/actions`.
- **Частичные — новый фон + старые карточки (4):** `/dashboard` (главная), `/dashboard/operations` (хуже всех), `/dashboard/operations/daily`, `/dashboard/operations/weekly`.
- **Частичный + без нового фона (1):** `/me`.
- **Старое/мёртвое:** `DashboardClient.tsx` (удалить), админка (Ф4), `/sprints`.
</content>
</invoke>
