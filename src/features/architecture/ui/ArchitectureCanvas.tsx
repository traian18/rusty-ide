import { Loader2 } from "lucide-react";
import { Button, Callout } from "../../../lib/ui";
import { Canvas } from "./Canvas";
import { type CanvasGraph } from "../graphModel";
import { withLayout } from "../persistence";
import type { LevelChild } from "../model";
import { useRepository } from "./useRepository";
import { useUserLayer } from "./useUserLayer";
import { useViewData } from "./useViewData";
import { type ArchitectureViewState } from "../viewState";
import styles from "./Architecture.module.css";

export function CanvasView({ graph, view, layer, onOpenGroup, onOpenChild }: { graph: CanvasGraph; view: ArchitectureViewState; layer: ReturnType<typeof useUserLayer>; onOpenGroup(groupId: string): void; onOpenChild(child: LevelChild): void }) {
  return (
    <Canvas
      graph={graph}
      selection={view.selection}
      onSelect={(key) => {
        view.select(key);
        if (key) view.setPanel("inspector");
      }}
      onOpenGroup={onOpenGroup}
      onOpenChild={onOpenChild}
      viewport={view.viewports[graph.viewKey]}
      onViewport={view.setViewport}
      onMoved={(viewKey, positions) => layer.update((current) => withLayout(current, viewKey, positions))}
    />
  );
}

/** What fills the canvas area when there is no graph to draw. */
export function CanvasArea({ session, data, graph, view, snapshotFiles }: { session: ReturnType<typeof useRepository>; data: ReturnType<typeof useViewData>; graph: CanvasGraph | null; view: ArchitectureViewState; snapshotFiles: number }) {
  if (session.status === "opening") {
    return (
      <div className={styles.centered} role="status">
        <Loader2 className="animate-spin" aria-hidden /> Loading repository…
      </div>
    );
  }
  if (session.status === "error") {
    return (
      <div className={styles.centered}>
        <Callout variant="danger">
          <strong>Could not open the repository.</strong> {session.error?.message}
        </Callout>
        <Button onClick={session.retry}>Try again</Button>
      </div>
    );
  }
  if (session.status === "no-snapshot") {
    return (
      <div className={styles.centered}>
        <p>This workspace has not been analyzed yet.</p>
        <p className={styles.muted}>Analysis reads your source files locally to find packages, imports, and cycles. It never runs your code.</p>
        <Button variant="primary" loading={session.refreshing} onClick={() => void session.refresh()}>
          Analyze repository
        </Button>
      </div>
    );
  }
  if (snapshotFiles === 0) {
    return (
      <div className={styles.centered}>
        <p>No supported source files were found.</p>
        <p className={styles.muted}>Rust, TypeScript, Java, Kotlin, Python, C#, C, C++, PHP, Go and JavaScript files are analyzed.</p>
      </div>
    );
  }
  if (data.error && !graph) {
    return (
      <div className={styles.centered}>
        <Callout variant="danger">
          <strong>Could not load this view.</strong> {data.error.message}
        </Callout>
        {view.trail.length ? <Button onClick={() => view.goTo(view.trail.length - 1)}>Back</Button> : null}
      </div>
    );
  }
  if (data.loading && !graph) {
    return (
      <div className={styles.centered} role="status">
        <Loader2 className="animate-spin" aria-hidden /> Loading view…
      </div>
    );
  }
  if (graph && graph.nodes.length === 0) {
    return (
      <div className={styles.centered}>
        <p>{graph.hiddenByFilter > 0 ? "Nothing matches the current filters." : "Nothing to show here."}</p>
        {graph.hiddenByFilter > 0 ? (
          <Button
            onClick={() => {
              view.setSearch("");
              view.setOnlyWithFindings(false);
              view.setImportKind("all");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>
    );
  }
  return null;
}
