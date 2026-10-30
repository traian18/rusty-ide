// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ChatQueryRail } from "./ChatQueryRail";

describe("ChatQueryRail", () => {
  it("renders ordered, accessible query buttons and reports selections", async () => {
    const mount = document.createElement("div");
    const root = createRoot(mount);
    const onSelect = vi.fn();

    try {
      await act(async () => {
        root.render(
          <ChatQueryRail
            queries={[
              { id: "u1", index: 1, label: "First question" },
              { id: "u2", index: 2, label: "Query 2" },
            ]}
            activeQueryId="u2"
            onSelect={onSelect}
          />,
        );
      });

      const points = [...mount.querySelectorAll<HTMLButtonElement>("[data-testid='chat-query-point']")];
      expect(points).toHaveLength(2);
      expect(points.map((point) => point.id)).toEqual(["chat-query-u1", "chat-query-u2"]);
      expect(points[0].getAttribute("aria-label")).toContain("First question");
      expect(points[0].getAttribute("aria-label")).toContain("query 1");
      expect(points[1].getAttribute("aria-current")).toBe("true");
      expect(points[0].getAttribute("aria-current")).toBeNull();

      await act(async () => points[0].click());
      await act(async () => points[0].click());
      expect(onSelect).toHaveBeenCalledTimes(2);
      expect(onSelect).toHaveBeenNthCalledWith(1, "u1");
      expect(onSelect).toHaveBeenNthCalledWith(2, "u1");
    } finally {
      await act(async () => root.unmount());
      mount.remove();
    }
  });
});
