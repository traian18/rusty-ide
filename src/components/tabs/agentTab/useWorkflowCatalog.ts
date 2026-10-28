import { useEffect, useState } from "react";
import { workflowCatalogService } from "../../../services/workflowCatalogService";
import type { WorkflowChoice } from "../behaviors/AgentWorkflowBar";
import type { JsonObject } from "../behaviors/behaviorModel";
import { AUTO_FLOW, shortWorkflowId, workflowMayEdit, workflowRoute, workflowSwitchTargets } from "../behaviors/flowCatalog";
import { BUILTIN_WORKFLOW_ID, BUILTIN_WORKFLOW_PATH, workflowKind } from "../behaviors/starterFlow";

type Catalog = Awaited<ReturnType<typeof workflowCatalogService.load>>;

/** How the Mode picker offers each workflow of the catalog. Whether a
 * workflow edits is read from the profiles its steps run under. */
function workflowChoices(catalog: Catalog): WorkflowChoice[] {
  const library = catalog.profiles.map((profile) => profile.document);
  return catalog.workflows.map(({ path, document }) => ({
    path,
    name: String(document.name ?? document.id ?? path.split("/").pop()),
    kind: workflowKind(document),
    description: typeof document.description === "string" ? document.description : undefined,
    id: shortWorkflowId(String(document.id ?? "")),
    route: workflowRoute(document)?.when,
    edits: workflowMayEdit(document, library),
    switchTo: workflowSwitchTargets(document),
  }));
}

/** The workspace's workflows, as the Mode picker offers them. */
export function useWorkflowOptions(rootPath: string, catalogVersion: number): WorkflowChoice[] {
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowChoice[]>([]);
  useEffect(() => {
    if (!rootPath) {
      setWorkflowOptions([]);
      return;
    }
    let cancelled = false;
    void workflowCatalogService.load(rootPath)
      .then((catalog) => {
        if (!cancelled) setWorkflowOptions(workflowChoices(catalog));
      })
      // Without the catalog the chat runs as a single agent; the picker shows no workflows.
      .catch(() => !cancelled && setWorkflowOptions([]));
    return () => {
      cancelled = true;
    };
  }, [rootPath, catalogVersion]);
  return workflowOptions;
}

/** The followed workflow's document, for the bar's step list. With Auto that
 * is whichever workflow was chosen for the latest message. It only reads: what
 * the chat follows is set by the chat's own actions, never by the view showing it. */
export function useWorkflowDocument(
  rootPath: string,
  chatWorkflow: string | undefined,
  autoWorkflow: string | undefined,
  catalogVersion: number,
): JsonObject | undefined {
  const [workflowDocument, setWorkflowDocument] = useState<JsonObject | undefined>();
  const activeWorkflowPath = chatWorkflow === AUTO_FLOW ? autoWorkflow : chatWorkflow;
  useEffect(() => {
    if (!activeWorkflowPath) {
      setWorkflowDocument(undefined);
      return;
    }
    let cancelled = false;
    workflowCatalogService.workflow(rootPath, activeWorkflowPath)
      .then((document) => {
        if (!cancelled) setWorkflowDocument(document);
      })
      .catch(() => !cancelled && setWorkflowDocument(undefined));
    return () => {
      cancelled = true;
    };
  }, [activeWorkflowPath, rootPath, catalogVersion]);
  return workflowDocument;
}

/** A chat that follows the built-in workflow under an older path (a saved chat, a workspace copy)
 * follows it by its own path from now on, so the Mode picker shows it. Called by the chat's own
 * actions (loading it, sending in it) with that chat's `adopt`. */
export function adoptsBuiltinPath(followedPath: string | undefined, document: Record<string, unknown> | undefined): boolean {
  return Boolean(followedPath) && followedPath !== AUTO_FLOW && followedPath !== BUILTIN_WORKFLOW_PATH && document?.id === BUILTIN_WORKFLOW_ID;
}
