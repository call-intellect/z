import { redirect } from 'next/navigation';

/**
 * Фаза 3 редизайна — детальный URL `/admin/ai-models/[taskType]` мигрирован
 * под `/admin/ai/routing/[taskType]`. Сохраняем redirect, чтобы старые
 * Link'и (например, в `AiModelsClient`) не приводили к 404.
 */
export default async function AdminAiModelsDetailRedirect({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  redirect(`/admin/ai/routing/${encodeURIComponent(taskType)}`);
}
