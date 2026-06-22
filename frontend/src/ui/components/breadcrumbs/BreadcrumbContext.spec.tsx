import { describe, expect, it, vi } from "vitest";
import { render, act } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/issues/test-id",
}));

import {
  BreadcrumbProvider,
  useBreadcrumbOverrides,
  useRegisterBreadcrumb,
} from "./BreadcrumbContext";

function Consumer({ onRender }: { onRender: () => void }) {
  useRegisterBreadcrumb({ label: "Задача X", parentHref: "/p/board", parentLabel: "P" });
  const overrides = useBreadcrumbOverrides();
  onRender();
  return <div data-testid="label">{overrides.get("/issues/test-id")?.label ?? "—"}</div>;
}

describe("useRegisterBreadcrumb", () => {
  it("registers a breadcrumb once and settles without a render loop", async () => {
    let renders = 0;

    const { getByTestId } = render(
      <BreadcrumbProvider>
        <Consumer onRender={() => renders++} />
      </BreadcrumbProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(getByTestId("label").textContent).toBe("Задача X");
    expect(renders).toBeLessThan(10);
  });
});
