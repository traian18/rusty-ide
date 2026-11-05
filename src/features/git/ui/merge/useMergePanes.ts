import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import {
  alignmentZones,
  chunkEdit,
  chunkText,
  createMergeDocument,
  hasConflictMarkers,
  initialResult,
  replaceRange,
  shiftRanges,
  splitLines,
  unresolvedIndexes,
  type ChunkChoice,
  type LineRange,
  type MergeChunk,
  type MergePane,
  type PaneZone,
} from "../../mergeModel";
import type { ConflictFile, ConflictSide } from "../../model";
import type { MergeDraft } from "./useMergeConflicts";
import styles from "./GitMergeTab.module.css";

type Editors = Partial<Record<MergePane, editor.IStandaloneCodeEditor>>;

interface MergePanesOptions {
  file: ConflictFile;
  localLabel: string;
  incomingLabel: string;
  draft: MergeDraft | undefined;
  onDraftChange: (draft: MergeDraft) => void;
}

/** The tint of a chunk's lines in a pane, or nothing when that pane has no part in it. */
function chunkClass(chunk: MergeChunk, choice: ChunkChoice, pane: MergePane): string | undefined {
  if (chunk.kind === "same") return styles.lineSame;
  if (chunk.kind === "local") return pane === "incoming" ? undefined : styles.lineLocal;
  if (chunk.kind === "incoming") return pane === "local" ? undefined : styles.lineIncoming;
  if (choice === "unresolved") return styles.lineConflict;
  if (pane === "result") return styles.lineResolved;
  const chosen = choice === pane || choice === "both";
  return chosen ? styles.lineChosen : styles.lineDropped;
}

const paneRange = (chunk: MergeChunk, result: LineRange, pane: MergePane): LineRange =>
  pane === "local" ? chunk.local : pane === "incoming" ? chunk.incoming : result;

function actionButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = styles.zoneButton;
  button.textContent = label;
  button.title = title;
  // Monaco would otherwise take the press as a click in the text and move focus away.
  button.addEventListener("mousedown", (event) => event.stopPropagation());
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Drives the three Monaco panes. The chunks' places in the result are tracked
 * here, not in Monaco, so a chunk with no lines (a deletion) keeps its place too.
 */
export function useMergePanes({ file, localLabel, incomingLabel, draft, onDraftChange }: MergePanesOptions) {
  const doc = useMemo(() => createMergeDocument(file), [file]);
  const opening = useMemo(
    () => draft ?? { ...initialResult(doc), choices: doc.chunks.map((): ChunkChoice => "unresolved") },
    // A draft is only read when the file opens; later ones came from these panes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc],
  );
  const [ranges, setRanges] = useState<LineRange[]>(opening.ranges);
  const [choices, setChoices] = useState<ChunkChoice[]>(opening.choices);
  const [editors, setEditors] = useState<Editors>({});
  const applying = useRef(false);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;
  // Read by Monaco's listeners, which outlive any one render.
  const rangesRef = useRef(ranges);
  const choicesRef = useRef(choices);
  const zoneIds = useRef<Partial<Record<MergePane, string[]>>>({});
  const decorations = useRef<Partial<Record<MergePane, editor.IEditorDecorationsCollection>>>({});
  const cursor = useRef(-1);

  const publish = useCallback((nextRanges: LineRange[], nextChoices: ChunkChoice[]) => {
    rangesRef.current = nextRanges;
    choicesRef.current = nextChoices;
    setRanges(nextRanges);
    setChoices(nextChoices);
  }, []);

  const saveDraft = useCallback((result: editor.IStandaloneCodeEditor) => {
    onDraftChangeRef.current({ text: result.getValue(), ranges: rangesRef.current, choices: choicesRef.current });
  }, []);

  const applyChoice = useCallback((index: number, choice: ChunkChoice) => {
    const result = editors.result;
    const model = result?.getModel();
    if (!result || !model) return;
    const text = chunkText(doc, doc.chunks[index], choice);
    const lineCount = model.getLineCount();
    const edit = chunkEdit(rangesRef.current[index], text, lineCount, model.getLineMaxColumn(lineCount));
    applying.current = true;
    result.executeEdits("merge-choice", [{
      range: { startLineNumber: edit.startLine, startColumn: edit.startColumn, endLineNumber: edit.endLine, endColumn: edit.endColumn },
      text: edit.text,
      forceMoveMarkers: true,
    }]);
    applying.current = false;
    const nextChoices = choicesRef.current.map((current, position) => (position === index ? choice : current));
    publish(replaceRange(rangesRef.current, index, splitLines(text).length), nextChoices);
    saveDraft(result);
  }, [doc, editors.result, publish, saveDraft]);

  const applyChoiceRef = useRef(applyChoice);
  applyChoiceRef.current = applyChoice;

  const mountPane = useCallback((pane: MergePane): OnMount => (mounted) => {
    setEditors((current) => ({ ...current, [pane]: mounted }));
  }, []);

  // Scrolling any pane scrolls the others; the zones keep the same lines at the same height.
  useEffect(() => {
    const panes = Object.values(editors);
    if (panes.length < 3) return;
    let following = false;
    const subscriptions = panes.map((source) => source.onDidScrollChange((event) => {
      if (following || !event.scrollTopChanged) return;
      following = true;
      for (const target of panes) if (target !== source) target.setScrollTop(event.scrollTop);
      following = false;
    }));
    return () => subscriptions.forEach((subscription) => subscription.dispose());
  }, [editors]);

  // Edits typed into the result. An edit inside a conflict decides it, unless it puts the common text back.
  useEffect(() => {
    const result = editors.result;
    const model = result?.getModel();
    if (!result || !model) return;
    const subscription = model.onDidChangeContent((event) => {
      if (applying.current) return;
      let nextRanges = rangesRef.current;
      let nextChoices = choicesRef.current;
      const touched = new Set<number>();
      for (const change of event.changes) {
        const startLine = change.range.startLineNumber - 1;
        const endLine = change.range.endLineNumber - 1;
        const added = change.text.split("\n").length - 1;
        const shifted = shiftRanges(nextRanges, { startLine, endLine, lineDelta: added - (endLine - startLine) });
        nextRanges = shifted.ranges;
        shifted.touched.forEach((index) => touched.add(index));
      }
      for (const index of touched) {
        const chunk = doc.chunks[index];
        if (chunk.kind !== "conflict") continue;
        const range = nextRanges[index];
        const text = range.end > range.start
          ? model.getValueInRange({ startLineNumber: range.start + 1, startColumn: 1, endLineNumber: range.end + 1, endColumn: 1 })
          : "";
        const choice: ChunkChoice = text === chunkText(doc, chunk) ? "unresolved" : "manual";
        nextChoices = nextChoices.map((current, position) => (position === index ? choice : current));
      }
      publish(nextRanges, nextChoices);
      saveDraft(result);
    });
    return () => subscription.dispose();
  }, [doc, editors.result, publish, saveDraft]);

  const headerRow = useCallback((pane: MergePane, chunkIndex: number, position: number, total: number): HTMLElement => {
    const row = document.createElement("div");
    const choice = choices[chunkIndex];
    const choose = (next: ChunkChoice) => () => applyChoiceRef.current(chunkIndex, next);
    row.className = choice === "unresolved" ? styles.zoneRow : styles.zoneRowDone;
    if (pane === "result") {
      const label = document.createElement("span");
      label.className = styles.zoneLabel;
      label.textContent = `Conflict ${position} of ${total}`;
      row.append(label);
      if (choice === "unresolved") {
        row.append(
          actionButton("Accept Both", "Keep the local lines, then the incoming lines", choose("both")),
          actionButton("Keep Base", "Keep the lines both sides started from", choose("base")),
        );
      } else {
        row.append(actionButton("Reset", "Undo this decision", choose("unresolved")));
      }
    } else if (choice === "unresolved") {
      const name = pane === "local" ? localLabel : incomingLabel;
      row.append(actionButton(pane === "local" ? `Accept ${name} →` : `← Accept ${name}`, `Use these lines from ${name}`, choose(pane as ConflictSide)));
    }
    // Monaco sets its own display on a zone's root, so the row sits inside one.
    const zoneRoot = document.createElement("div");
    zoneRoot.className = styles.zonePadding;
    zoneRoot.append(row);
    return zoneRoot;
  }, [choices, incomingLabel, localLabel]);

  // Rebuilt only when the structure changes, so typing inside a line costs nothing.
  const zones = useMemo(() => alignmentZones(doc.chunks, ranges), [doc, ranges]);
  useEffect(() => {
    if (Object.keys(editors).length < 3) return;
    const conflicts = doc.chunks.flatMap((chunk, index) => (chunk.kind === "conflict" ? [index] : []));
    const zoneNode = (pane: MergePane, zone: PaneZone): HTMLElement => {
      if (zone.header && zone.chunk !== undefined) {
        return headerRow(pane, zone.chunk, conflicts.indexOf(zone.chunk) + 1, conflicts.length);
      }
      const node = document.createElement("div");
      const tint = zone.chunk === undefined ? undefined : chunkClass(doc.chunks[zone.chunk], choices[zone.chunk], pane);
      node.className = tint ? `${styles.zonePadding} ${tint}` : styles.zonePadding;
      return node;
    };
    for (const pane of ["local", "result", "incoming"] as const) {
      const target = editors[pane];
      if (!target) continue;
      target.changeViewZones((accessor) => {
        (zoneIds.current[pane] ?? []).forEach((id) => accessor.removeZone(id));
        zoneIds.current[pane] = zones[pane].map((zone) => accessor.addZone({
          afterLineNumber: zone.afterLine,
          heightInLines: zone.lines,
          domNode: zoneNode(pane, zone),
          // A conflict with no lines has its row and its padding after the same line.
          ordinal: zone.header ? 0 : 1,
        }));
      });
      const lineDecorations = doc.chunks.flatMap((chunk, index) => {
        const range = paneRange(chunk, ranges[index], pane);
        const className = chunkClass(chunk, choices[index], pane);
        if (!className || range.end === range.start) return [];
        return [{
          range: { startLineNumber: range.start + 1, startColumn: 1, endLineNumber: range.end, endColumn: 1 },
          options: { isWholeLine: true, className },
        }];
      });
      decorations.current[pane] ??= target.createDecorationsCollection();
      decorations.current[pane].set(lineDecorations);
    }
  }, [choices, doc, editors, headerRow, ranges, zones]);

  const unresolved = useMemo(() => unresolvedIndexes(doc, choices), [choices, doc]);

  const goToConflict = useCallback((step: 1 | -1) => {
    if (unresolved.length === 0) return;
    const position = unresolved.indexOf(cursor.current);
    const next = position === -1 ? (step === 1 ? 0 : unresolved.length - 1) : (position + step + unresolved.length) % unresolved.length;
    cursor.current = unresolved[next];
    editors.result?.revealLineNearTop(rangesRef.current[cursor.current].start + 1);
  }, [editors.result, unresolved]);

  const acceptAll = useCallback((side: ConflictSide) => {
    for (const index of unresolved) applyChoice(index, side);
  }, [applyChoice, unresolved]);

  return {
    openingText: opening.text,
    unresolved,
    conflictCount: doc.chunks.filter((chunk) => chunk.kind === "conflict").length,
    settledOnDisk: file.working !== null && !hasConflictMarkers(file.working),
    mountLocal: useMemo(() => mountPane("local"), [mountPane]),
    mountResult: useMemo(() => mountPane("result"), [mountPane]),
    mountIncoming: useMemo(() => mountPane("incoming"), [mountPane]),
    goToConflict,
    acceptAll,
    resultText: useCallback(() => editors.result?.getValue() ?? opening.text, [editors.result, opening.text]),
  };
}
