import { redirect } from "next/navigation";

export default function AdminLlmModelsRedirect() {
  redirect("/admin/ai/catalog?tab=models");
}
