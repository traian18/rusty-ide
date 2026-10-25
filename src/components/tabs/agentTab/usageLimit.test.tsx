// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentMessage } from "../../../store/types";
import { CONTINUE_AFTER_RESET_MS, continueDelay, usageLimitReset, useUsageLimitContinue, type UsageLimitContinue } from "./usageLimit";

const FAILURE = "Error: The model provider's usage limit was reached. It accepts requests again in about 4 h 39 min, at 21:59 UTC (resets_at=2026-10-25T21:59:00Z). Continue the run then: finished tasks are kept.";
const message = (content: string, role: AgentMessage["role"] = "assistant"): AgentMessage => ({ id: content.slice(0, 8), role, content, timestamp: "2026-10-25" });

describe("usageLimitReset", () => {
  it("reads when the limit resets from the failure", () => {
    expect(usageLimitReset(FAILURE)?.toISOString()).toBe("2026-10-25T21:59:00.000Z");
    expect(usageLimitReset("Error: RateLimited { retry_after: None }")).toBeUndefined();
    expect(usageLimitReset(undefined)).toBeUndefined();
  });

  it("waits until a minute after the reset, and not at all once it is past", () => {
    const resets = new Date("2026-10-25T21:59:00Z");
    expect(continueDelay(resets, resets.getTime() - 10_000)).toBe(10_000 + CONTINUE_AFTER_RESET_MS);
    expect(continueDelay(resets, resets.getTime() + 5 * 60_000)).toBe(0);
  });
});

describe("useUsageLimitContinue", () => {
  let container: HTMLDivElement;
  let root: Root;
  let seen: UsageLimitContinue | undefined;
  function Probe({ messages, busy, onContinue }: { messages: AgentMessage[]; busy: boolean; onContinue: () => void }) {
    seen = useUsageLimitContinue(messages, busy, onContinue);
    return null;
  }
  const mount = (messages: AgentMessage[], onContinue: () => void, busy = false) => act(async () => root.render(<Probe messages={messages} busy={busy} onContinue={onContinue} />));

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T21:00:00Z"));
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("offers nothing when the last message is not a usage-limit failure", async () => {
    await mount([message(FAILURE), message("next question", "user")], vi.fn());
    expect(seen).toBeUndefined();
  });

  it("continues by itself after the reset once asked to", async () => {
    const onContinue = vi.fn();
    await mount([message(FAILURE)], onContinue);
    expect(seen?.scheduled).toBe(false);
    await act(async () => seen?.schedule());
    expect(seen?.scheduled).toBe(true);
    await act(async () => vi.advanceTimersByTime(59 * 60_000));
    expect(onContinue).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(CONTINUE_AFTER_RESET_MS));
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(seen?.scheduled).toBe(false);
  });

  it("does not continue when cancelled", async () => {
    const onContinue = vi.fn();
    await mount([message(FAILURE)], onContinue);
    await act(async () => seen?.schedule());
    await act(async () => seen?.cancel());
    await act(async () => vi.advanceTimersByTime(2 * 3600_000));
    expect(onContinue).not.toHaveBeenCalled();
  });
});
