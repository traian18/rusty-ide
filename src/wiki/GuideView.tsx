import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, PenLine } from "lucide-react";

import { CompactSelect } from "../components/CompactSelect";
import { Button, Callout } from "../components/ui";
import { MarkdownRenderer } from "../components/ui/MarkdownRenderer";
import { useSelectableModels } from "../hooks/useSelectableModels";
import { notify } from "../notificationStore";
import { useWorkspaceStore } from "../store";
import { toRepositoryError } from "../architecture/client";
import type { DocsClient } from "./client";
import { useDocsView } from "./docsState";
import { backgroundClient } from "../background/client";
import { runDocumentationUpdate } from "../background/documentationRunner";
import { pageModel } from "./harnessPageModel";
import type { Citation } from "./model";
import { writePages, type PageModel, type WriteProgress } from "./writer";
import { formatTokens, linkPaths, READING_ORDER, splitDiagrams, type DocumentationPlan, type PageState, type PlannedPage, type WrittenView } from "./written";
import styles from "./Docs.module.css";

const STATE_TEXT: Record<PageState, string> = { missing: "Not written", fresh: "Up to date", stale: "Out of date", expired: "Rewrite" };
const STYLES = [
  { id: "comprehensive", name: "Explanatory" },
  { id: "reference", name: "Reference" },
  { id: "tutorial", name: "Tutorial" },
];
const DEFAULT_MODEL = "";

export interface GuideViewProps {
  client: DocsClient;
  root: string;
  /** Reload when this changes (a new snapshot). */
  revision: number;
  openCitation(citation: Citation, stale: boolean): void;
  /** Builds the function that answers a brief; replaced in tests. */
  makeModel?(model: string): PageModel;
}

export function GuideView({ client, root, revision, openCitation, makeModel }: GuideViewProps) {
  const selected = useDocsView((state) => state.guidePage);
  const select = useDocsView((state) => state.selectGuide);
  const [plan, setPlan] = useState<DocumentationPlan | null>(null);
  const [view, setView] = useState<WrittenView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"all" | null>(null);
  const [progress, setProgress] = useState<WriteProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [reload, setReload] = useState(0);
  const chatModel = useWorkspaceStore((state) => state.activeModel);
  const customProviders = useWorkspaceStore((state) => state.customProviders);
  const providerStatus = useWorkspaceStore((state) => state.providerStatus);
  const activeCustomProviderId = useWorkspaceStore((state) => state.activeCustomProviderId);
  const { options: modelOptions } = useSelectableModels(customProviders, providerStatus, activeCustomProviderId);
  const writing = progress !== null && progress.current !== null;

  useEffect(() => {
    let live = true;
    client.documentationPlan(root).then(
      (loaded) => live && setPlan(loaded),
      (failure) => live && setError(toRepositoryError(failure).message),
    );
    return () => {
      live = false;
    };
  }, [client, root, revision, reload]);

  useEffect(() => {
    let live = true;
    setView(null);
    client.documentationPage(root, selected).then(
      (loaded) => live && setView(loaded),
      (failure) => live && setError(toRepositoryError(failure).message),
    );
    return () => {
      live = false;
    };
  }, [client, root, revision, selected, reload]);

  const settings = plan?.settings ?? { model: null, style: null };
  const modelId = settings.model || chatModel || DEFAULT_MODEL;
  const ask = useCallback(
    (): PageModel => (makeModel ? makeModel(modelId) : pageModel({ customProviders, providerStatus, activeCustomProviderId }, modelId, root)),
    [makeModel, modelId, customProviders, providerStatus, activeCustomProviderId, root],
  );

  const changeSettings = (next: Partial<typeof settings>) => {
    const merged = { ...settings, ...next };
    setPlan((current) => (current ? { ...current, settings: merged } : current));
    client.setDocumentationSettings(root, merged).catch((failure) => setError(toRepositoryError(failure).message));
  };

  const run = async (pages: PlannedPage[]) => {
    setConfirm(null);
    setError(null);
    if (!makeModel) {
      // In the app the pages are written as a background job (shown in the process bubble, stopped
      // with its ×, resumed after a restart); this page reloads when the job ends.
      await backgroundClient.queue(root, pages.map((p) => p.id), modelId || null);
      notify("Writing documentation", `${pages.length} page${pages.length === 1 ? "" : "s"} are being written in the background.`, "info");
      void runDocumentationUpdate(root).finally(() => setReload((n) => n + 1));
      return;
    }
    let model: PageModel;
    try {
      model = ask();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    const result = await writePages(client, root, pages, modelId, model, controller.signal, setProgress);
    abort.current = null;
    setProgress(null);
    setReload((n) => n + 1);
    if (result.failures.length) setError(`${result.failures.length} of ${result.total} pages could not be written: ${result.failures[0].message}`);
    else if (!controller.signal.aborted) notify("Documentation written", `${result.total} pages are ready to read.`, "info");
  };

  const toWrite = useMemo(() => (plan?.pages ?? []).filter((page) => page.state !== "fresh"), [plan]);
  const tokens = toWrite.reduce((sum, page) => sum + page.inputTokens, 0);
  const current = plan?.pages.find((page) => page.id === selected);
  const modules = (plan?.pages ?? []).filter((page) => page.kind === "module");
  const top = (plan?.pages ?? []).filter((page) => page.kind !== "module").sort((a, b) => READING_ORDER.indexOf(a.kind as never) - READING_ORDER.indexOf(b.kind as never));

  return (
    <div className={styles.body}>
      <nav className={styles.guideNav} aria-label="Documentation pages">
        {top.length ? <div className={styles.guideGroup}>Start here</div> : null}
        {top.map((page) => (
          <GuideRow key={page.id} page={page} selected={selected === page.id} onSelect={select} />
        ))}
        {modules.length ? <div className={styles.guideGroup}>Modules</div> : null}
        {modules.map((page) => (
          <GuideRow key={page.id} page={page} selected={selected === page.id} onSelect={select} />
        ))}
      </nav>
      <div className={styles.page}>
        {plan ? <DocumentationHeader root={root} plan={plan} /> : null}
        <div className={styles.guideBar} role="group" aria-label="Writing documentation">
          <label className={styles.muted} htmlFor="docs-model">
            Written by
          </label>
          <CompactSelect
            id="docs-model"
            value={settings.model ?? ""}
            onChange={(value) => changeSettings({ model: value || null })}
            options={[{ id: "", name: chatModel ? `Chat model (${chatModel})` : "Chat model" }, ...modelOptions]}
            placeholder="Chat model"
          />
          <CompactSelect id="docs-style" value={settings.style ?? "comprehensive"} onChange={(value) => changeSettings({ style: value })} options={STYLES} placeholder="Style" />
          <span className={styles.spacer} />
          {writing ? (
            <>
              <Loader2 size={14} className="animate-spin" aria-hidden />
              <span className={styles.muted} role="status">
                Writing {progress.done + 1} of {progress.total}
              </span>
              <Button variant="ghost" onClick={() => abort.current?.abort()}>
                Stop
              </Button>
            </>
          ) : confirm === "all" ? (
            <>
              <span className={styles.muted}>
                {toWrite.length} pages, about {formatTokens(tokens)} input tokens, one model call each.
              </span>
              <Button variant="primary" onClick={() => void run(toWrite)}>
                Write
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button variant="secondary" icon={<PenLine size={14} />} disabled={!toWrite.length} onClick={() => setConfirm("all")}>
              {toWrite.length ? `Write documentation (${toWrite.length})` : "Documentation is up to date"}
            </Button>
          )}
        </div>
        {error ? <Callout variant="danger">{error}</Callout> : null}
        {view ? (
          <WrittenPageView view={view} onOpenCitation={openCitation} />
        ) : current ? (
          <div className={styles.centered}>
            <p>{current.title} has not been written yet.</p>
            <p className={styles.muted}>About {formatTokens(current.inputTokens)} input tokens.</p>
            <Button variant="primary" disabled={writing} onClick={() => void run([current])}>
              Write this page
            </Button>
          </div>
        ) : (
          <div role="status">Loading…</div>
        )}
      </div>
    </div>
  );
}

function GuideRow({ page, selected, onSelect }: { page: PlannedPage; selected: boolean; onSelect(id: string): void }) {
  return (
    <button type="button" className={styles.treeRow} aria-current={selected ? "page" : undefined} onClick={() => onSelect(page.id)}>
      <span className={styles.treeLabel} title={page.title}>
        {page.title}
      </span>
      <span className={styles.treeCount}>{STATE_TEXT[page.state]}</span>
    </button>
  );
}

/** A written page: header with who wrote it and how current it is, prose with diagrams drawn from the index, and its sources. */
export function WrittenPageView({ view, onOpenCitation }: { view: WrittenView; onOpenCitation(citation: Citation, stale: boolean): void }) {
  const { page } = view;
  const diagrams = new Map(view.diagrams.map((diagram) => [diagram.key, diagram]));
  const stale = view.freshness !== "fresh";
  const named = page.footnotes.flatMap((source) => (source.reference.kind === "lines" ? [source.reference.citation.file] : []));
  return (
    <article className={styles.prose} aria-label={`Page ${page.title}`}>
      <header className={styles.pageHeader}>
        <h2 className={styles.title}>{page.title}</h2>
        <span className={`${styles.badge} ${stale ? styles.badgeWarn : ""}`}>{view.freshness === "fresh" ? "Up to date" : view.freshness === "stale" ? "Code changed since written" : "Out of date"}</span>
        {page.needs_review ? <span className={`${styles.badge} ${styles.badgeWarn}`}>Needs review</span> : null}
        <span className={styles.muted}>
          {page.author.model} · {new Date(page.author.written_at_ms).toLocaleDateString()}
        </span>
      </header>
      {page.dropped > 0 ? <p className={styles.muted}>{page.dropped} names the model used were not found in the code and are shown as plain text.</p> : null}
      {splitDiagrams(page.markdown).map((segment, index) => {
        if (segment.type === "markdown") {
          return (
            <MarkdownRenderer
              key={index}
              content={linkPaths(segment.text, named)}
              onLinkClick={(href, event) => {
                const file = /^#file:(.+)$/.exec(href);
                if (!file) return;
                event.preventDefault();
                onOpenCitation({ file: decodeURI(file[1]), start_line: 1, end_line: 1, content_hash: "" }, stale);
              }}
            />
          );
        }
        const diagram = diagrams.get(segment.key);
        return diagram ? (
          <figure key={index} className={styles.diagram} aria-label={diagram.title}>
            <div dangerouslySetInnerHTML={{ __html: diagram.svg }} />
            <figcaption className={styles.diagramTitle}>{diagram.title}</figcaption>
          </figure>
        ) : null;
      })}
      {named.length ? (
        <section className={styles.sources} aria-label="Files this page names">
          <span className={styles.muted}>Files this page names: </span>
          {named.map((file) => (
            <button key={file} type="button" className={styles.chip} title={`Open ${file}`} onClick={() => onOpenCitation({ file, start_line: 1, end_line: 1, content_hash: "" }, stale)}>
              {file}
            </button>
          ))}
        </section>
      ) : null}
    </article>
  );
}

/** What the documentation of this repository holds, before the reader picks a page. */
export function DocumentationHeader({ root, plan }: { root: string; plan: DocumentationPlan }) {
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  const modules = plan.pages.filter((page) => page.kind === "module").length;
  const guides = plan.pages.length - modules;
  const written = plan.pages.filter((page) => page.state !== "missing").length;
  const fresh = plan.pages.filter((page) => page.state === "fresh").length;
  const outdated = written - fresh;
  const parts = [`${plan.pages.length} pages: ${guides} to start with (overview, getting started, key concepts, how it works, architecture and more) and ${modules} module${modules === 1 ? "" : "s"}`];
  parts.push(written ? `${written} written${outdated ? `, ${outdated} out of date` : ""}` : "none written yet");
  return (
    <header className={styles.docHeader} aria-label="Project documentation">
      <h2 className={styles.title}>{name}</h2>
      <p className={styles.muted}>
        Documentation for {name}, explained module by module: {parts.join("; ")}. Each page is written by a model from the repository's real code and its own README; names that do not exist in the code are removed, and pages are marked when the code moves on.
      </p>
    </header>
  );
}
