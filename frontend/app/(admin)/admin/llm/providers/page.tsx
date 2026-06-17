import { redirect } from "next/navigation";

export default function AdminLlmProvidersRedirect() {
  redirect("/admin/ai/catalog?tab=providers");
}
