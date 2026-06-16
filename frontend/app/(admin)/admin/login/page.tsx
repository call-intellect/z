import { redirect } from "next/navigation";

export default function AdminLoginPage() {
  redirect("/login?next=%2Fadmin");
}
