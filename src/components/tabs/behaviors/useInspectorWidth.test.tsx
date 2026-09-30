// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { INSPECTOR_WIDTH_KEY, useInspectorWidth } from "./useInspectorWidth";

it("resizes by keyboard and pointer, clamps bounds, and persists the width", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.removeItem(INSPECTOR_WIDTH_KEY);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  function Editor() { const { bodyRef, handle } = useInspectorWidth(); return <div ref={bodyRef}>{handle}</div>; }
  try {
    act(() => root.render(<Editor />));
    const handle = host.querySelector<HTMLElement>('[role="separator"]')!;
    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(handle.getAttribute("aria-valuenow")).toBe("408");
    handle.setPointerCapture = vi.fn(); handle.hasPointerCapture = () => true; handle.releasePointerCapture = vi.fn();
    const pointer = (type: string, x: number) => handle.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { clientX: x, pointerId: 1, button: 0 }));
    act(() => { pointer("pointerdown", 600); pointer("pointermove", 500); pointer("pointerup", 500); });
    expect(handle.getAttribute("aria-valuenow")).toBe("508");
    expect(localStorage.getItem(INSPECTOR_WIDTH_KEY)).toBe("508");
    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
    act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(handle.getAttribute("aria-valuenow")).toBe("280");
  } finally { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); localStorage.removeItem(INSPECTOR_WIDTH_KEY); }
});
