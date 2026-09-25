// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitBranchManager } from "./GitBranchManager";
import { UnmergedBranchError } from "./gitErrors";

let root: Root;
let container: HTMLDivElement;
const onClose = vi.fn();
const onDeleteBranch = vi.fn();

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  onDeleteBranch.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderManager() {
  await act(async () =>
    root.render(
      <GitBranchManager
        currentBranch="main"
        localBranches={["main", "feature"]}
        remoteBranches={[]}
        onCheckout={vi.fn()}
        onCreateBranch={vi.fn()}
        onDeleteBranch={onDeleteBranch}
        onMergeBranch={vi.fn()}
        onRebaseBranch={vi.fn()}
        onClose={onClose}
      />
    )
  );
}

function buttonByText(text: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
  if (!match) throw new Error(`no button containing "${text}"`);
  return match as HTMLButtonElement;
}

/** A real click: the native mousedown the popover's outside-click listener sees, then the click. */
async function realClick(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    element.click();
  });
}

async function openActionsFor(branch: string) {
  const row = [...container.querySelectorAll(".relative")].find((el) => el.textContent?.trim() === branch)!;
  await act(async () => {
    row.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

describe("GitBranchManager delete", () => {
  it("deletes the branch when the confirm dialog is accepted, without the popover closing first", async () => {
    await renderManager();
    await openActionsFor("feature");
    await realClick(buttonByText("Delete Branch"));

    await realClick(document.querySelector("#confirm-modal-confirm") as HTMLButtonElement);

    expect(onClose).not.toHaveBeenCalled();
    expect(onDeleteBranch).toHaveBeenCalledWith("feature", false);
  });

  it("offers a forced delete when the branch isn't fully merged", async () => {
    onDeleteBranch.mockRejectedValueOnce(new UnmergedBranchError("not fully merged"));
    await renderManager();
    await openActionsFor("feature");
    await realClick(buttonByText("Delete Branch"));
    await realClick(document.querySelector("#confirm-modal-confirm") as HTMLButtonElement);

    expect(document.body.textContent).toContain("Branch Not Fully Merged");
    await realClick(buttonByText("Force Delete"));

    expect(onDeleteBranch).toHaveBeenNthCalledWith(2, "feature", true);
  });

  it("keeps the branch when the forced delete is declined", async () => {
    onDeleteBranch.mockRejectedValueOnce(new UnmergedBranchError("not fully merged"));
    await renderManager();
    await openActionsFor("feature");
    await realClick(buttonByText("Delete Branch"));
    await realClick(document.querySelector("#confirm-modal-confirm") as HTMLButtonElement);

    await realClick(buttonByText("Keep Branch"));

    expect(onDeleteBranch).toHaveBeenCalledTimes(1);
  });

  it("still closes on a genuine outside click when no dialog is open", async () => {
    await renderManager();

    await realClick(document.body);

    expect(onClose).toHaveBeenCalled();
  });
});
