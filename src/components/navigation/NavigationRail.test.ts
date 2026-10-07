import { describe, expect, it } from "vitest";
import { getVisibleTopIcons } from "./NavigationRail";
import { NAVIGATION_RAIL_ICONS } from "./NavigationRailPresenter";

describe("NavigationRail", () => {
  it("does not expose Rusty Canvas in the visible top icons", () => {
    const visibleIds = getVisibleTopIcons(NAVIGATION_RAIL_ICONS).map((item) => item.id);

    expect(visibleIds).not.toContain("rusty");
    expect(visibleIds).toEqual(expect.arrayContaining(["workspace", "explorer", "git", "agent"]));
  });
});
