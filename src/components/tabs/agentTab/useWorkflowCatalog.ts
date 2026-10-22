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
 * is whichever workflow was chosen for the latest message. A chat that
 * follows the built-in workflow under another path is moved to its own
 * (`adoptBuiltinPath`). */
export function useWorkflowDocument(
  rootPath: string,
  chatWorkflow: string | undefined,
  autoWorkflow: string | undefined,
  catalogVersion: number,
  adoptBuiltinPath: (path: string) => void,
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
        if (cancelled) return;
        setWorkflowDocument(document);
        const followsBuiltinElsewhere = chatWorkflow !== AUTO_FLOW && document.id === BUILTIN_WORKFLOW_ID && chatWorkflow !== BUILTIN_WORKFLOW_PATH;
        if (followsBuiltinElsewhere) adoptBuiltinPath(BUILTIN_WORKFLOW_PATH);
      })
      .catch(() => !cancelled && setWorkflowDocument(undefined));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkflowPath, chatWorkflow, rootPath, catalogVersion]);
  return workflowDocument;
}
