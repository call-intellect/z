import { redirect } from "next/navigation";

export default async function AdminAiModelsDetailRedirect({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  redirect(`/admin/ai/routing/${encodeURIComponent(taskType)}`);
}
