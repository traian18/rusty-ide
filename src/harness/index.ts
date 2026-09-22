// ============================================================
// index.ts — The real, process-wide AgentHarness singleton.
//
// Every consumer imports `harness` from here, not CoreHarness directly.
//
// Sidecar-removal Phase 8c: `harness` used to be a `HarnessRouter`
// dispatching between `SidecarHarness` and `CoreHarness` per a per-
// capability routing preference (`preferences/harnessRouting.ts`,
// `HarnessRoutingSettings.tsx` in the Settings tab) -- both gone now, along
// with `router.ts` itself. There is only one backend left, so `harness` IS
// the `CoreHarness` instance directly; no dispatch layer needed.
//
// `hybridControlPlane` is still named "Hybrid" (see its own doc comment
// for why) -- it still has a real dispatch inside (direct HTTP vs. a clear
// rejection for managed providers), just no sidecar fallback any more.
// ============================================================

import { hybridControlPlane } from "./HybridControlPlane";
import { HybridExecutionAnswerer } from "./HybridExecutionAnswerer";
import { CoreHarness } from "./core/CoreHarness";
import { inlineChatDefinition } from "./core/definitions/inline_chat";
import { generateSkillDefinition } from "./core/definitions/generate_skill";
import { generateTaskNodesDefinition } from "./core/definitions/generate_task_nodes";
import { globalExploreDefinition } from "./core/definitions/global_explore";
import { executeNodeDefinition } from "./core/definitions/execute_node";
import { agentChatDefinition } from "./core/definitions/agent_chat";
import { reconciliateEdgeDefinition } from "./core/definitions/reconciliate_edge";
import { reconciliateGraphDefinition } from "./core/definitions/reconciliate_graph";
import { testBuildDefinition } from "./core/definitions/test_build";
import type { AgentHarness } from "./contract";

export const harness: AgentHarness = new CoreHarness({
  controlPlane: hybridControlPlane,
  executionAnswerer: new HybridExecutionAnswerer(),
  definitions: {
    inline_chat: inlineChatDefinition,
    generate_skill: generateSkillDefinition,
    generate_task_nodes: generateTaskNodesDefinition,
    global_explore: globalExploreDefinition,
    execute_node: executeNodeDefinition,
    agent_chat: agentChatDefinition,
    reconciliate_edge: reconciliateEdgeDefinition,
    reconciliate_graph: reconciliateGraphDefinition,
    test_build: testBuildDefinition,
  },
});

export * from "./contract";
