import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — детальный URL `/admin/ai-models/[taskType]` мигрирован
 * под `/admin/ai/routing/[taskType]`. Сохраняем redirect, чтобы старые
 * Link'и (например, в `AiModelsClient`) не приводили к 404.
 */
export default function AdminAiModelsDetailRedirect({
  params,
}: {
  params: { taskType: string };
}) {
  redirect(`/admin/ai/routing/${encodeURIComponent(params.taskType)}`);
}
