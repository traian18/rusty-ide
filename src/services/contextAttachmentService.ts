/**
 * Service for reading and formatting attached context files and folders
 * for consumption by AI models in Agent Chat and Node Runs.
 */

import { invoke } from "@tauri-apps/api/core";
import { isBinaryDocumentFile, parseDocument } from "./documentParserService";

export interface ContextAttachment {
  path: string;
  name: string;
  isDir?: boolean;
}

/** Maximum character count to inline per attached file (~100 KB). */
export const MAX_ATTACHMENT_CHAR_LENGTH = 100_000;

/**
 * Reads the content of an attached file from physical disk.
 * For binary documents (Excel, PDF, Word), parses them into formatted markdown/text.
 * For text files, uses `invoke("read_file_disk")` by default.
 */
export async function readAttachmentContent(
  path: string,
  readFileFn?: (path: string) => Promise<string>
): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    if (isBinaryDocumentFile(path)) {
      const parsed = await parseDocument({
        path,
        readFileBase64Fn: readFileFn,
      });
      if (parsed.ok) {
        return { ok: true, content: parsed.content };
      }
      return { ok: false, error: parsed.error };
    }

    const reader = readFileFn || ((p: string) => invoke<string>("read_file_disk", { path: p }));
    const content = await reader(path);
    return { ok: true, content };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Formats a list of attachments into a structured context prompt block
 * that can be appended to the user message or instructions.
 */
export async function buildAttachmentContext(
  attachments: ContextAttachment[] | undefined,
  readFileFn?: (path: string) => Promise<string>
): Promise<string> {
  if (!attachments || attachments.length === 0) {
    return "";
  }

  const sections: string[] = [];

  for (const att of attachments) {
    if (att.isDir) {
      sections.push(
        `--- Attached Directory Context: ${att.path} ---\n[Folder: ${att.name}] Directory available on disk for exploration via list_files or search.`
      );
      continue;
    }

    const result = await readAttachmentContent(att.path, readFileFn);
    if (result.ok && typeof result.content === "string") {
      let content = result.content;
      if (content.length > MAX_ATTACHMENT_CHAR_LENGTH) {
        const originalSizeKb = (content.length / 1024).toFixed(1);
        content = `${content.slice(0, MAX_ATTACHMENT_CHAR_LENGTH)}\n\n[Content truncated: showing first 100 KB of ${originalSizeKb} KB. Full file is available on disk at ${att.path}]`;
      }
      sections.push(
        `--- Attached File Context: ${att.path} ---\n${content}`
      );
    } else {
      sections.push(
        `--- Attached File Context: ${att.path} ---\n[File: ${att.name}] Unable to read content directly (${result.error || "unknown error"}). Path is available on disk.`
      );
    }
  }

  return `<AttachedContext>\nThe user attached the following context file(s)/folder(s) from their system:\n\n${sections.join(
    "\n\n"
  )}\n</AttachedContext>`;
}
