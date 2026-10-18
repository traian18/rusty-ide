import { vi } from "vitest";

import { fakeClient } from "../architecture/testing";
import type { DocsClient } from "./client";

export function fakeDocsClient(overrides: Partial<DocsClient> = {}): DocsClient {
  return {
    ...fakeClient(),
    workspaceRepositories: vi.fn(async () => []),
    documentationPlan: vi.fn(async () => ({ pages: [], inputTokens: 0, settings: { model: null, style: null } })),
    documentationBrief: vi.fn(async (_root: string, id: string) => ({ id, title: id, system: "rules", prompt: "facts", inputChars: 100, style: "comprehensive" })),
    documentationSave: vi.fn(),
    documentationPage: vi.fn(async () => null),
    documentationSettings: vi.fn(async () => ({ model: null, style: null })),
    setDocumentationSettings: vi.fn(async () => undefined),
    ...overrides,
  } as never;
}
