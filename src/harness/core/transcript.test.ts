import { describe, expect, it } from "vitest";
import { createTranscript } from "./transcript";

describe("createTranscript", () => {
  it("accumulates deltas for one message id in arrival order", () => {
    const transcript = createTranscript();
    transcript.push("m1", "Hel");
    transcript.push("m1", "lo");
    expect(transcript.textFor("m1")).toBe("Hello");
  });

  it("keeps separate message ids independent", () => {
    const transcript = createTranscript();
    transcript.push("m1", "first");
    transcript.push("m2", "second");
    expect(transcript.textFor("m1")).toBe("first");
    expect(transcript.textFor("m2")).toBe("second");
  });

  it("textFor returns an empty string for a message id that never arrived", () => {
    const transcript = createTranscript();
    expect(transcript.textFor("never")).toBe("");
  });

  it("messageIds reports first-appearance order, not push order", () => {
    const transcript = createTranscript();
    transcript.push("m1", "a");
    transcript.push("m2", "b");
    transcript.push("m1", "c");
    expect(transcript.messageIds()).toEqual(["m1", "m2"]);
  });

  it("lastMessageText returns the accumulated text of the most recently started message", () => {
    const transcript = createTranscript();
    transcript.push("m1", "first message");
    transcript.push("m2", "sec");
    transcript.push("m2", "ond message");
    expect(transcript.lastMessageText()).toBe("second message");
  });

  it("lastMessageText is empty when no delta ever arrived", () => {
    const transcript = createTranscript();
    expect(transcript.lastMessageText()).toBe("");
  });
});
