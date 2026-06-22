# A/B block-ingest — захват «выполнения» (OLD prompt vs NEW prompt Ф2a)

Модель: deepseek-chat. temperature=0. Корпус: 12 реплик.

| id | gold | заметка | OLD→done? | NEW→done? | OLD signals | NEW signals |
|----|------|---------|-----------|-----------|-------------|-------------|
| c1 | completion | прошедшее, результат | — | ✅ | fact | task_completed |
| c2 | completion | закрытие задачи | — | ✅ | fact | task_completed |
| c3 | completion | сделал + выложил | — | ✅ | fact | task_completed |
| c4 | completion | подписали | — | — | fact | fact |
| c5 | completion | готово/выкатили | — | ✅ | fact | task_completed |
| c6 | completion | написал и отправил | — | ✅ | commitment | task_completed |
| o1 | other | commitment (будущее) | — | — | commitment | commitment |
| o2 | other | commitment (обязуюсь) | — | — | commitment | commitment |
| o3 | other | commitment (займусь) | — | — | commitment | commitment |
| o4 | other | decision (план) | — | — | decision | decision |
| o5 | other | need/idea | — | — | idea | idea |
| o6 | other | fact/metric | — | — | fact | metric |

## Итог
- Recall «выполнения» (gold=completion → распознано как done): OLD 0/6 · NEW 5/6
- Точность по «не-выполнению» (gold=other → НЕ помечено done): OLD 6/6 · NEW 6/6
