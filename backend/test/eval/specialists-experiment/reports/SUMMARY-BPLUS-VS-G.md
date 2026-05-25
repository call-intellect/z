# Сравнение специалистов: Б+ (один вызов на 8 типов) vs Г (8 раздельных с кэшем)

Дата: 2026-05-25T11:00:44.350Z
Модель Б+ / Г: deepseek-v4-pro · Судья: deepseek-v4-pro
Фикстура: Еженедельная планёрка команды разработки (55 блоков)

## Цифровые метрики

| Метрика | Б+ (1 вызов / 8 типов) | Г (8 раздельных / кэш) |
|---|---|---|
| Вызовов | 1 | 8 |
| Время | 164.2 с | 142.5 с |
| Стоимость | $0.0143 | $0.0526 |
| Кэш-хит средн. | — | 21% |
| Сущностей всего | 41 | 42 |

Экономика: Б+ в 3.68× дешевле Г.

### По типам сущностей

| Тип | Б+ | Г |
|---|---|---|
| decisions | 4 | 4 |
| ideas | 6 | 6 |
| insights | 5 | 5 |
| experiments | 4 | 3 |
| regulations | 7 | 7 |
| knowledge_categories | 9 | 8 |
| skill_traits | 2 | 4 |
| helpfulness_traits | 4 | 5 |

## Вердикт судьи (метки X/Y скрыты)

**Победитель: Variant Б+**

> Б+ побеждает по трём критериям из четырёх (accuracy, structure, detail) при равенстве coverage. Ключевые преимущества Б+: (1) безупречная структура — все поля заполнены осмысленно, нет null в rationale/alternatives; (2) глубина — 3 alternatives на решение, 3 lessons на эксперимент, богатые sampleStatements; (3) отсутствие галлюцинаций — Г допустил дублирование блока blk_032 в двух разных traitType. Г имеет небольшое преимущество в skill_traits (4 против 2) и в точности типизации blk_004 (problem vs blocker), но это не компенсирует структурные и детализационные пробелы. Общий счёт: Б+ уверенно впереди.

### По критериям (5 = отлично, 1 = плохо)

| Критерий | Б+ | Г | Объяснение |
|---|---|---|---|
| coverage (полнота) | 4 | 4 | Оба варианта покрывают все 8 типов сущностей в ожидаемых диапазонах. Б+: 4 decisions, 6 ideas, 5 insights, 4 experiments, 7 regulations, 9 knowledge_categories, 2 skill_traits, 4 helpfulness_traits (всего 41). Г: 4 decisions, 6 ideas, 5 insights, 3 experiments, 7 regulations, 8 knowledge_categories, 4 skill_traits, 5 helpfulness_traits (всего 42). Б+ чуть лучше по experiments (4 против 3 — включает дополнительный эксперимент-постмортем из blk_008/009) и knowledge_categories (9 против 8 — разделяет экспертизу Анны на 3 категории вместо 2). Г чуть лучше по skill_traits (4 против 2 — добавляет Ивана и Дмитрия). Но оба в пределах ожидаемых границ, разница непринципиальна. |
| accuracy (точность) | 4 | 3 | Б+: все сущности правильно типизированы относительно source-блоков. Небольшая натяжка: blk_004 (pain) отмечен как kind='blocker', хотя точнее было бы 'problem' (Г здесь точнее — 'problem'). Эксперимент-постмортем на базе blk_008/009 — допустимая, но пограничная интерпретация. Галлюцинаций нет. Г: серьёзная ошибка — blk_032 использован ДВАЖДЫ: как help_provided и как mentoring с одним и тем же evidenceQuote. Блок blk_032 (signalType=help_provided, «Анна предложила парное программирование») — это помощь, а не менторинг. Менторинг — это blk_031 (Иван объясняет cache invalidation). Дублирование одного блока в двух разных traitType — это галлюцинация/ошибка типизации. Также Г излишне консервативен в confidence для knowledge_categories ('low' для подтверждённой экспертизы Ивана и Елены, когда есть прямые цитаты). |
| structure (схема) | 5 | 3 | Б+: образцовая структура. Все решения имеют rationale, alternatives[] (по 3 альтернативы!), decidedBy, status, confidence. Все insights имеют kind, severity (enum: high/medium/critical), causeCategory (enum: tooling/process_gap/priority/resource_constraint), mitigationSuggestion. Все experiments имеют lessons[] с type (what_worked/what_failed/next_time). sourceBlockIds корректны. Regulations — kind и severity заполнены. Г: структурные проблемы: (1) 5 из 7 regulations не имеют поля severity (только blk_010 и blk_035), inconsistency; (2) decision blk_039 — rationale=null и alternatives=[], поля оставлены пустыми; (3) kind в regulations использует 'policy' вместо 'regulation' — отклонение от ожидаемого enum; (4) дубликат blk_032 в helpfulness_traits структурно избыточен. |
| detail (глубина) | 5 | 3 | Б+: выдающаяся глубина. Decisions содержат rationale, интегрирующий данные из нескольких блоков (blk_006 использует rationale из blk_007; blk_026 — из blk_023 и blk_024). Alternatives[] везде по 3 осмысленных варианта с пояснением. Redis-эксперимент содержит 3 урока разных типов (what_worked: GC-паузы, what_failed: скрытый GC-штраф, next_time: 4-шаговая схема миграции). knowledge_categories: sampleStatements детальные (3-4 утверждения на категорию), sourceBlockIds перекрёстные. helpfulness: evidenceQuote — дословные цитаты, topicHint развёрнутый, intensity калиброван (0.7–0.9). Г: бледнее. blk_039 decision — rationale отсутствует, alternatives пуст. Redis-эксперимент — только 1 урок (против 3 у Б+). Decisions: alternatives[] по 1-2 пункта, менее проработанные. helpfulness: topicHint короче, intensity занижена (blk_033: 0.3 против 0.7 у Б+ за идентичное действие — Иван скинул шаблон runbook). knowledge_categories: sampleStatements тоньше, без перекрёстных sourceBlockIds. |

### Сумма баллов
- Variant Б+: 18 / 20
- Variant Г:  13 / 20

## Метаданные

- Маскировка: X = вариант Б+, Y = вариант Г.
- Судья: deepseek-v4-pro, вход=29759 токенов, выход=5174 токенов, стоимость $0.0174, время 107.5 с.
