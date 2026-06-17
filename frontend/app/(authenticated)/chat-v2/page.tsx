import { redirect } from "next/navigation";

export default async function ChatV2Redirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  const cid = sp?.conversationId;
  if (typeof cid === "string" && cid) qs.set("conversationId", cid);
  const q = qs.toString();
  redirect(q ? `/chat?${q}` : "/chat");
}
