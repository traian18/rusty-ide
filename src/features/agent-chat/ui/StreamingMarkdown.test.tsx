// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StreamingMarkdown } from "./StreamingMarkdown";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("positions the cursor at the end of nested Markdown text", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const rect = vi.fn(function (this: Range) {
    expect(this.startContainer.textContent).toBe("text");
    expect(this.startOffset).toBe(4);
    return { left: 120, top: 30, height: 18 } as DOMRect;
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", { configurable: true, value: rect });
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<StreamingMarkdown content="- **nested text**" />));
  const cursor = container.querySelector<HTMLElement>('[aria-hidden="true"]');
  expect(rect).toHaveBeenCalled();
  expect(cursor?.style.left).toBe("120px");
  expect(cursor?.style.top).toBe("30px");
  await act(async () => root.unmount());
  delete (Range.prototype as Partial<Range>).getBoundingClientRect;
});
