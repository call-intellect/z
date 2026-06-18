import { describe, expect, it } from "vitest";

import { referralBannerCopy, type RewardProgressDomain } from "./referral";

function progress(
  over: Partial<RewardProgressDomain> = {},
): RewardProgressDomain {
  return {
    hasProfile: true,
    activePaying: 0,
    targetClients: 3,
    monthlyEarnedKopecks: 0,
    ...over,
  };
}

describe("referralBannerCopy — морфинг баннера", () => {
  it("руководитель без профиля → «приведи N компании», со шкалой", () => {
    const copy = referralBannerCopy(
      true,
      progress({ hasProfile: false, targetClients: 3 }),
    );
    expect(copy.variant).toBe("leaderNoProfile");
    expect(copy.title).toContain("приведи 3");
    expect(copy.showProgress).toBe(true);
  });

  it("руководитель, клиентов меньше цели → in-progress со шкалой и остатком", () => {
    const copy = referralBannerCopy(
      true,
      progress({ hasProfile: true, activePaying: 1, targetClients: 3 }),
    );
    expect(copy.variant).toBe("leaderInProgress");
    expect(copy.showProgress).toBe(true);
    expect(copy.subtitle).toContain("ещё 2");
  });

  it("руководитель, цель достигнута → «подписка окуплена», без шкалы", () => {
    const copy = referralBannerCopy(
      true,
      progress({ hasProfile: true, activePaying: 3, targetClients: 3 }),
    );
    expect(copy.variant).toBe("leaderReached");
    expect(copy.title).toContain("окуплена");
    expect(copy.showProgress).toBe(false);
  });

  it("руководитель, клиентов больше цели → тоже «окуплена»", () => {
    const copy = referralBannerCopy(
      true,
      progress({ hasProfile: true, activePaying: 5, targetClients: 3 }),
    );
    expect(copy.variant).toBe("leaderReached");
  });

  it("рядовой → «дополнительный заработок», без шкалы", () => {
    const copy = referralBannerCopy(false, progress({ hasProfile: false }));
    expect(copy.variant).toBe("member");
    expect(copy.title).toContain("Дополнительный заработок");
    expect(copy.showProgress).toBe(false);
  });

  it("рядовой не зависит от наличия профиля и прогресса", () => {
    const a = referralBannerCopy(false, progress({ hasProfile: false }));
    const b = referralBannerCopy(
      false,
      progress({ hasProfile: true, activePaying: 10 }),
    );
    expect(a.variant).toBe("member");
    expect(b.variant).toBe("member");
  });
});
