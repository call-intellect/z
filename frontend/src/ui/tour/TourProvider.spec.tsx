import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TourProvider, useTourContext } from "./TourProvider";
import { useTour } from "./useTour";

vi.mock("@/api/users/tour-progress.api", () => ({
  tourProgressApi: {
    get: vi.fn(),
    update: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    currentOrgId: "org-test",
    user: null,
    isLoading: false,
  }),
}));

vi.mock("@/api/onboarding.api", () => ({
  onboardingApi: {
    completeSetup: vi.fn(async () => ({ ok: true })),
  },
}));

import { tourProgressApi } from "@/api/users/tour-progress.api";

function WelcomeTrigger() {
  useTour("welcome");
  return <div data-testid="welcome-trigger">trigger</div>;
}

function TestControls() {
  const tour = useTourContext();
  return (
    <div style={{ position: "fixed", top: 0, left: 0, zIndex: 100 }}>
      <button onClick={() => tour.next()}>next</button>
      <button onClick={() => void tour.skip()}>skip</button>
      <button onClick={() => void tour.complete()}>complete</button>
      <button onClick={() => tour.forceStart("welcome")}>force-welcome</button>
      <button onClick={() => void tour.resetAll()}>reset-all</button>
      <div data-testid="active">
        {tour.active
          ? `${tour.active.definition.id}:${tour.active.stepIndex}`
          : "none"}
      </div>
    </div>
  );
}

function renderWithFreshCache(children: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {children}
    </SWRConfig>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TourProvider", () => {
  it("useTour стартует welcome, если progress пустой", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = tourProgressApi.update as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({});
    updateMock.mockResolvedValue({ welcome: {} });

    renderWithFreshCache(
      <TourProvider>
        <WelcomeTrigger />
        <TestControls />
      </TourProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("welcome:0"),
    );
    expect(updateMock).toHaveBeenCalledWith({ tourId: "welcome" });
  });

  it("useTour НЕ стартует, если welcome.completedAt уже задан", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = tourProgressApi.update as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({
      welcome: { completedAt: "2026-05-27T10:00:00Z" },
    });

    renderWithFreshCache(
      <TourProvider>
        <WelcomeTrigger />
        <TestControls />
      </TourProvider>,
    );

    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("useTour НЕ стартует, если welcome.skipped=true", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = tourProgressApi.update as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({ welcome: { skipped: true } });

    renderWithFreshCache(
      <TourProvider>
        <WelcomeTrigger />
        <TestControls />
      </TourProvider>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.getByTestId("active")).toHaveTextContent("none");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("next() двигает шаги; на последнем — PATCH с completedAt и закрытие", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = tourProgressApi.update as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({});
    updateMock.mockImplementation(
      async (body: {
        tourId: string;
        completedAt?: string;
        skipped?: boolean;
      }) => ({
        [body.tourId]: {
          ...(body.completedAt !== undefined
            ? { completedAt: body.completedAt }
            : {}),
          ...(body.skipped !== undefined ? { skipped: body.skipped } : {}),
        },
      }),
    );

    const user = userEvent.setup();
    renderWithFreshCache(
      <TourProvider>
        <WelcomeTrigger />
        <TestControls />
      </TourProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("welcome:0"),
    );

    for (let i = 1; i <= 5; i++) {
      await user.click(screen.getByRole("button", { name: "next" }));
      await waitFor(() =>
        expect(screen.getByTestId("active")).toHaveTextContent(`welcome:${i}`),
      );
    }
    await user.click(screen.getByText("Закончить"));
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("none"),
    );

    const calls = updateMock.mock.calls.map((c) => c[0]);
    const completedCalls = calls.filter(
      (c) => c.tourId === "welcome" && typeof c.completedAt === "string",
    );
    expect(completedCalls.length).toBeGreaterThan(0);
  });

  it("skip() — PATCH с skipped:true и закрытие", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = tourProgressApi.update as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({});
    updateMock.mockImplementation(
      async (body: {
        tourId: string;
        completedAt?: string;
        skipped?: boolean;
      }) => ({
        [body.tourId]: {
          ...(body.completedAt !== undefined
            ? { completedAt: body.completedAt }
            : {}),
          ...(body.skipped !== undefined ? { skipped: body.skipped } : {}),
        },
      }),
    );

    const user = userEvent.setup();
    renderWithFreshCache(
      <TourProvider>
        <WelcomeTrigger />
        <TestControls />
      </TourProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("welcome:0"),
    );

    await user.click(screen.getByRole("button", { name: "skip" }));
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("none"),
    );

    expect(updateMock).toHaveBeenCalledWith({
      tourId: "welcome",
      skipped: true,
    });
  });

  it("forceStart всегда стартует, даже если completedAt уже есть", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const updateMock = tourProgressApi.update as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({
      welcome: { completedAt: "2026-05-27T10:00:00Z" },
    });
    updateMock.mockResolvedValue({});

    const user = userEvent.setup();
    renderWithFreshCache(
      <TourProvider>
        <TestControls />
      </TourProvider>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());

    await user.click(screen.getByText("force-welcome"));
    await waitFor(() =>
      expect(screen.getByTestId("active")).toHaveTextContent("welcome:0"),
    );
  });

  it("resetAll вызывает API reset", async () => {
    const getMock = tourProgressApi.get as unknown as ReturnType<typeof vi.fn>;
    const resetMock = tourProgressApi.reset as unknown as ReturnType<
      typeof vi.fn
    >;
    getMock.mockResolvedValue({});
    resetMock.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    renderWithFreshCache(
      <TourProvider>
        <TestControls />
      </TourProvider>,
    );
    await waitFor(() => expect(getMock).toHaveBeenCalled());

    await user.click(screen.getByText("reset-all"));
    await waitFor(() => expect(resetMock).toHaveBeenCalled());
  });
});
