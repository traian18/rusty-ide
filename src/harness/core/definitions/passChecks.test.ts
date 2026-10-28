import { describe, expect, it, vi } from "vitest";

import { countingEdits, PassCheckLog, recordingChecks } from "./passChecks";

const signal = {} as never;

describe("pass checks", () => {
  it("keeps each whole check's last outcome and whether an edit came after it", async () => {
    const log = new PassCheckLog();
    const check = recordingChecks(vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "2 failed" })
      .mockResolvedValueOnce({ ok: true, output: "passed" })
      .mockResolvedValueOnce({ ok: true, output: "typecheck ok" })
      .mockResolvedValueOnce({ ok: false, error: "narrowed" })
      .mockResolvedValueOnce({ ok: true, output: "passed again" }), log);
    const edit = countingEdits(vi.fn().mockResolvedValue({ ok: true, output: "edited" }), log);
    const failedEdit = countingEdits(vi.fn().mockResolvedValue({ ok: false, error: "no match" }), log);

    await check({ check: "test" }, signal);
    await edit({}, signal);
    await check({ check: "test" }, signal);
    await check({ check: "typecheck" }, signal);
    await edit({}, signal);
    await failedEdit({}, signal);
    await check({ check: "test", test_name: "one" }, signal);

    expect(log.results()).toEqual([
      { name: "test", passed: true, ran: false, summary: "passed" },
      { name: "typecheck", passed: true, ran: false, summary: "typecheck ok" },
    ]);
    await check({ check: "Test" }, signal);
    expect(log.results()[0]).toMatchObject({ name: "test", ran: true });
  });
});
