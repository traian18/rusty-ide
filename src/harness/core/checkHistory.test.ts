import { beforeEach, describe, expect, it } from "vitest";

import { formatDuration, lastDuration, recordDuration, resetCheckHistory, takeProjectTurn } from "./checkHistory";

const key = { workspaceRoot: "/ws", project: "rusty-core", check: "test" };

describe("check durations", () => {
  beforeEach(() => resetCheckHistory());

  it("remembers how long a check took, per project, check and narrowing", () => {
    expect(lastDuration(key)).toBeUndefined();
    recordDuration(key, 631_000);
    expect(lastDuration(key)).toBe(631_000);
    expect(lastDuration({ ...key, project: "rusty-ide" })).toBeUndefined();
    expect(lastDuration({ ...key, only: 'test_name "replay"' })).toBeUndefined();
    recordDuration(key, 600_000);
    expect(lastDuration(key)).toBe(600_000);
  });

  it("writes durations the way a person reads them", () => {
    expect(formatDuration(631_000)).toBe("10m31s");
    expect(formatDuration(42_400)).toBe("42s");
    expect(formatDuration(60_000)).toBe("1m00s");
  });
});

describe("one check at a time per project", () => {
  beforeEach(() => resetCheckHistory());

  it("lets a check start at once when its project is free, and says nothing about waiting", async () => {
    let waited = false;
    const turn = await takeProjectTurn("/ws", "rusty-core", new AbortController().signal, () => { waited = true; });
    expect(waited).toBe(false);
    turn.release();
  });

  it("makes a second check of the same project wait for the first, in the open, but not one of another project", async () => {
    const first = await takeProjectTurn("/ws", "rusty-core", new AbortController().signal);
    const order: string[] = [];
    let told = false;
    const second = takeProjectTurn("/ws", "rusty-core", new AbortController().signal, () => { told = true; }).then((turn) => {
      order.push("second");
      return turn;
    });
    const other = await takeProjectTurn("/ws", "rusty-ide", new AbortController().signal);
    order.push("other");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(order).toEqual(["other"]);
    expect(told).toBe(true);
    first.release();
    const turn = await second;
    expect(order).toEqual(["other", "second"]);
    expect(turn.waitedMs).toBeGreaterThanOrEqual(15);
    turn.release();
    other.release();
  });

  it("gives up a wait that is cancelled without holding up the check behind it", async () => {
    const first = await takeProjectTurn("/ws", "rusty-core", new AbortController().signal);
    const controller = new AbortController();
    const cancelled = takeProjectTurn("/ws", "rusty-core", controller.signal);
    const third = takeProjectTurn("/ws", "rusty-core", new AbortController().signal);
    controller.abort();
    await expect(cancelled).rejects.toThrow("cancelled while waiting");
    first.release();
    (await third).release();
  });
});
