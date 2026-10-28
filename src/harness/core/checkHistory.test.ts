import { beforeEach, describe, expect, it } from "vitest";

import { formatDuration, lastDuration, recordDuration, repositoryOf, resetCheckHistory, setWorkspaceRepositories, takeProjectTurn, takesTurn } from "./checkHistory";

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

describe("which repository and which commands", () => {
  it("names the repository a path is in: its first folder below the workspace", () => {
    expect(repositoryOf("/ws", "/ws/rusty-core/sdk/typescript")).toBe("rusty-core");
    expect(repositoryOf("/ws/", "rusty-core")).toBe("rusty-core");
    expect(repositoryOf("/ws", "./rusty-ide/src-tauri")).toBe("rusty-ide");
    expect(repositoryOf("/ws", "/ws")).toBe(".");
    expect(repositoryOf("/ws", ".")).toBe(".");
  });

  it("uses the discovered repositories, wherever they are grouped, once discovery ran", () => {
    setWorkspaceRepositories("/ws", ["/ws", "/ws/services/payments/api", "/ws/services/web", "/ws/rusty-core", "/elsewhere/linked"]);
    expect(repositoryOf("/ws", "/ws/services/payments/api/src/main.rs")).toBe("services/payments/api");
    expect(repositoryOf("/ws", "services/web")).toBe("services/web");
    expect(repositoryOf("/ws", "/ws/rusty-core/sdk")).toBe("rusty-core");
    // In the workspace repository itself, not in a folder of its own.
    expect(repositoryOf("/ws", "/ws/services/README.md")).toBe(".");
    expect(repositoryOf("/ws", ".")).toBe(".");
    // Another workspace falls back to the first folder.
    expect(repositoryOf("/other", "/other/a/b")).toBe("a");
    setWorkspaceRepositories("", []);
  });

  it("makes build and test programs take turns, and lets quick ones through", () => {
    for (const program of ["cargo", "npm", "/usr/local/bin/cargo", "pytest", "go", "./gradlew"]) expect(takesTurn(program)).toBe(true);
    for (const program of ["git", "ls", "cat", "rg"]) expect(takesTurn(program)).toBe(false);
  });
});

