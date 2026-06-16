import { redirect } from "next/navigation";

export default function AdminLlmPricesRedirect() {
  redirect("/admin/ai/catalog?tab=prices");
}
