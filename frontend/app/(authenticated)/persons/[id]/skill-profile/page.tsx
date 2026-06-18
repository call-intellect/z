import { redirect } from "next/navigation";

export default async function PersonSkillProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/persons/${id}`);
}
