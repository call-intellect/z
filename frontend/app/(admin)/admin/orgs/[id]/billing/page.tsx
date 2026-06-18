import { redirect } from "next/navigation";

export default async function AdminOrgBillingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/admin/orgs/${encodeURIComponent(id)}?tab=billing`);
}
