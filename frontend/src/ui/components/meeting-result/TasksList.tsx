import type { AiTask } from '@/domain/ai-result';
import { t } from '@/lib/i18n';

type Props = { tasks: AiTask[] };

export function TasksList({ tasks }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-semibold text-slate-900">
        {t('result.tasks')} · {tasks.length}
      </h2>
      <ul className="flex flex-col gap-3">
        {tasks.map((task, i) => (
          <li
            key={i}
            className="rounded border border-slate-100 bg-slate-50 p-3"
          >
            <p className="text-sm font-medium text-slate-900">{task.title}</p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
              {task.assignee ? (
                <span>
                  {t('result.task_assignee')}: <strong>{task.assignee}</strong>
                </span>
              ) : null}
              {task.due ? (
                <span>
                  {t('result.task_due')}: <strong>{task.due}</strong>
                </span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
