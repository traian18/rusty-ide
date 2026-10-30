// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { ToolSelector } from "./ToolSelector";

it("selects known tools and preserves saved custom patterns while filtering", () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  let selected: string[] = [];
  function Editor() {
    const [value, setValue] = useState(["mcp.github.*"]);
    selected = value;
    return <ToolSelector value={value} onChange={setValue} />;
  }
  try {
    act(() => root.render(<Editor />));
    const read = [...host.querySelectorAll("label")].find((label) => label.textContent?.includes("read_file"))!;
    act(() => read.querySelector<HTMLInputElement>("input")!.click());
    expect(selected).toEqual(["mcp.github.*", "read_file"]);
    const search = host.querySelector<HTMLInputElement>('[aria-label="Search tools"]')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "run command");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    act(() => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    expect(selected).toEqual(["mcp.github.*", "read_file", "run_command"]);
  } finally { act(() => root.unmount()); host.remove(); }
});
