import { useEffect, useState } from "react";
import { loadElk } from "./elkLoader";
import { placeLevel, type LevelCanvas } from "./levelGraph";
import type { CanvasGraph } from "./graphModel";
import { layoutLevel, type ElkLike, type LevelLayout } from "./layoutElk";
import type { Point } from "./layout";

export type LayoutEngineLoader = () => Promise<ElkLike | null>;

export interface LevelLayoutState {
  graph: CanvasGraph | null;
  engine: LevelLayout["engine"] | null;
  computing: boolean;
}

/**
 * Lays out a level asynchronously. The previous drawing stays on screen until the new layout is
 * ready; a result for a canvas that has since been replaced is discarded.
 */
export function useLevelLayout(
  canvas: LevelCanvas | null,
  pinned: Readonly<Record<string, Point>> | undefined,
  spacing: number,
  load: LayoutEngineLoader = loadElk,
): LevelLayoutState {
  const [state, setState] = useState<{ source: LevelCanvas | null; graph: CanvasGraph | null; engine: LevelLayout["engine"] | null }>({ source: null, graph: null, engine: null });

  useEffect(() => {
    if (canvas === null) {
      setState({ source: null, graph: null, engine: null });
      return;
    }
    let current = true;
    void (async () => {
      const elk = await load();
      const layout = await layoutLevel({ items: canvas.items, links: canvas.links, frame: canvas.frame, spacing, pinned }, elk);
      if (current) setState({ source: canvas, graph: placeLevel(canvas, layout.boxes, layout.flattened), engine: layout.engine });
    })();
    return () => {
      current = false;
    };
    // The loader is stable by contract; the canvas and pinned positions are the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas, pinned, spacing]);

  return { graph: state.graph, engine: state.engine, computing: canvas !== null && state.source !== canvas };
}
