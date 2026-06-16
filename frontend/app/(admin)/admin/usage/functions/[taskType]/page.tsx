import { redirect } from "next/navigation";

export default async function Page({
  params,
}: {
  params: Promise<{ taskType: string }>;
}) {
  const { taskType } = await params;
  redirect(`/admin/analytics/functions/${encodeURIComponent(taskType)}`);
}
