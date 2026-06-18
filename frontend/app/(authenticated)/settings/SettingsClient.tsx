"use client";

import { useSearchParams } from "next/navigation";

import { ProfileSection } from "./sections/ProfileSection";
import { SecuritySection } from "./sections/SecuritySection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { OnboardingSection } from "./sections/OnboardingSection";

const TABS = ["profile", "security", "appearance", "tours"] as const;
type SettingsTab = (typeof TABS)[number];

function isSettingsTab(value: string | null): value is SettingsTab {
  return !!value && (TABS as readonly string[]).includes(value);
}

export function SettingsClient() {
  const searchParams = useSearchParams();
  const tabParam = searchParams?.get("tab");
  const activeTab: SettingsTab = isSettingsTab(tabParam) ? tabParam : "profile";

  return (
    <div className="w-full">
      <header className="mb-6 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-fg-primary">
          Настройки
        </h1>
        <p className="text-sm text-fg-secondary">
          Профиль, безопасность и внешний вид кабинета.
        </p>
      </header>

      {activeTab === "profile" && <ProfileSection />}
      {activeTab === "security" && <SecuritySection />}
      {activeTab === "appearance" && <AppearanceSection />}
      {activeTab === "tours" && <OnboardingSection />}
    </div>
  );
}
