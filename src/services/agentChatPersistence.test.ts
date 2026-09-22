import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentChatSaveQueue, readModifiedFiles } from "./agentChatPersistence";
import type { AgentMessage } from "../store/types";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => invoke.mockReset());
const message: AgentMessage = { id: "1", role: "user", content: "Edit files", timestamp: "2026-09-19" };

describe("conversation persistence", () => {
  it("round-trips changed files, removes duplicates, and accepts older chats", async () => {
    invoke.mockResolvedValue("/workspace/.rusty/chats/chat.json");
    await new AgentChatSaveQueue().save("/workspace", "agent", [message], ["/a.ts", "/b.ts", "/a.ts"]);
    const saved = JSON.parse(invoke.mock.calls[0][1].content);
    expect(readModifiedFiles(saved.modifiedFiles)).toEqual(["/a.ts", "/b.ts"]);
    expect(saved.messages).toEqual([message]);
    expect(readModifiedFiles(undefined)).toEqual([]);
    expect(readModifiedFiles([null, 4, "", "/a.ts"])).toEqual(["/a.ts"]);
  });

  it("captures data immediately and serializes saves while initial file creation is pending", async () => {
    let finishCreate!: (path: string) => void;
    invoke.mockImplementationOnce(() => new Promise<string>((resolve) => { finishCreate = resolve; }));
    const queue = new AgentChatSaveQueue();
    const messages = [message];
    const files = ["/a.ts"];
    const first = queue.save("/workspace", "agent", messages, files);
    const second = queue.save("/workspace", "agent", [...messages, { ...message, id: "2" }], [...files, "/b.ts"]);
    messages.length = 0;
    files.length = 0;
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    finishCreate("/workspace/chat.json");
    await Promise.all([first, second]);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["save_chat_history", "write_file_disk"]);
    expect(JSON.parse(invoke.mock.calls[0][1].content).modifiedFiles).toEqual(["/a.ts"]);
    expect(JSON.parse(invoke.mock.calls[1][1].content).modifiedFiles).toEqual(["/a.ts", "/b.ts"]);
    expect(invoke.mock.calls[1][1].path).toBe("/workspace/chat.json");
  });

  it("keeps new conversations in the same tab separate and preserves loaded conversation paths", async () => {
    invoke.mockResolvedValue("/new-chat.json");
    await new AgentChatSaveQueue().save("/workspace", "agent", [message], ["/a.ts"]);
    await new AgentChatSaveQueue().save("/workspace", "agent", [message], []);
    expect(invoke.mock.calls[0][1].chatId).not.toBe(invoke.mock.calls[1][1].chatId);
    await new AgentChatSaveQueue("/existing.json").save("/workspace", "agent", [message], ["/old.ts"]);
    expect(invoke.mock.calls[2][0]).toBe("write_file_disk");
    expect(invoke.mock.calls[2][1].path).toBe("/existing.json");
  });

  it("allows retry after a failed write", async () => {
    invoke.mockRejectedValueOnce(new Error("disk unavailable")).mockResolvedValue(undefined);
    const queue = new AgentChatSaveQueue("/existing.json");
    await expect(queue.save("/workspace", "agent", [message], [])).rejects.toThrow("disk unavailable");
    await queue.save("/workspace", "agent", [message], ["/a.ts"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
