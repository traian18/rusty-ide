import { describe, expect, it } from "vitest";
import { AGENT_CAPABILITIES } from "../../../shared/agent-protocol/capabilities";
import { CAPABILITY_NAMES } from "./capabilities";

// Deliberately its own file, not inside layering.test.ts: this is the one
// place the contract is allowed to know shared/agent-protocol exists at
// all, and only inside a test (layering.test.ts's "keeps the sidecar's
// wire protocol out of the contract" check globs *.ts, not *.test.ts).
describe("CapabilityMap / AGENT_CAPABILITIES parity", () => {
  it("names exactly the sidecar's nine capabilities today", () => {
    expect([...CAPABILITY_NAMES].sort()).toEqual([...AGENT_CAPABILITIES].sort());
  });
});
