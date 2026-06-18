import type { Metadata } from "next";
import { Suspense } from "react";

import { SignupForm } from "./SignupForm";

export const metadata: Metadata = {
  title: "Регистрация",
  description:
    "Создайте аккаунт Кора, чтобы получать AI-отчёты по своим встречам.",
};

export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
