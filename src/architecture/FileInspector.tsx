import { Callout } from "../components/ui";
import type { ArchitectureClient } from "./client";
import { SeverityPill } from "./SeverityPill";
import { useAsyncData, type AsyncData } from "./useAsyncData";
import type { NavigationTarget } from "./navigation";
import { RELATION_LABEL, type FrameworkRelation, type ImportEdge } from "./model";
import styles from "./Architecture.module.css";

const LIMIT = 20;

export interface FileInspectorProps {
  root: string;
  client: ArchitectureClient;
  file: string;
  revision: number;
  hasGit: boolean;
  /** True when the snapshot has framework relations to look up. */
  hasFrameworks?: boolean;
  onNavigate(target: NavigationTarget): void;
}

function Section<T>({ title, data, children }: { title: string; data: AsyncData<T>; children(value: T): React.ReactNode }) {
  return (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {data.status === "loading" ? <p className={styles.muted}>Loading…</p> : null}
      {data.status === "error" ? <Callout variant="danger">{data.error.message}</Callout> : null}
      {data.status === "ready" ? children(data.data) : null}
    </div>
  );
}

/** "internal", "declared external", ... from the externally tagged resolution object. */
export function resolutionLabel(resolution: Record<string, unknown>): string {
  const [kind] = Object.keys(resolution);
  const detail = kind ? (resolution[kind] as Record<string, unknown> | null) : null;
  const label = (kind ?? "unknown").replace(/_/g, " ");
  const target = detail && (detail.target_file ?? detail.package);
  return typeof target === "string" ? `${label}: ${target}` : label;
}

function ImportRows({ edges, empty, onNavigate, showFile }: { edges: ImportEdge[]; empty: string; onNavigate(t: NavigationTarget): void; showFile: "importing" | "target" }) {
  if (!edges.length) return <p className={styles.muted}>{empty}</p>;
  return (
    <ul className={styles.list}>
      {edges.map((edge) => (
        <li key={edge.fact.id} className={styles.row}>
          {showFile === "importing" ? (
            <button className={styles.linkButton} onClick={() => onNavigate({ file: edge.fact.importing_file })}>
              {edge.fact.importing_file}
            </button>
          ) : (
            <span>{edge.fact.spelling}</span>
          )}
          <span className={styles.muted}>
            {edge.fact.kind === "type_only" ? "type-only · " : ""}
            {showFile === "importing" ? edge.fact.spelling : resolutionLabel(edge.resolution)} · {edge.rule}
          </span>
        </li>
      ))}
    </ul>
  );
}

function FrameworkRows({ relations, file, onNavigate }: { relations: FrameworkRelation[]; file: string; onNavigate(t: NavigationTarget): void }) {
  if (!relations.length) return <p className={styles.muted}>No framework relations touch this file.</p>;
  return (
    <ul className={styles.list}>
      {relations.map((relation) => {
        const other = relation.from === file ? relation.to : relation.from;
        return (
          <li key={relation.id} className={styles.row}>
            <span>
              <strong>{relation.label}</strong> <span className={styles.muted}>{RELATION_LABEL[relation.kind]} · {relation.framework}</span>
            </span>
            {other && other !== file ? (
              <button className={styles.linkButton} onClick={() => onNavigate({ file: other })}>
                {relation.from === file ? "to " : "from "}
                {other}
              </button>
            ) : null}
            <span className={styles.muted}>
              {relation.certainty === "convention" ? "implied by a convention" : "written in the code"} · {relation.rule.id} v{relation.rule.version}
            </span>
            <code className={styles.muted}>{relation.evidence.text}</code>
          </li>
        );
      })}
    </ul>
  );
}

export function FileInspector({ root, client, file, revision, hasGit, hasFrameworks = false, onNavigate }: FileInspectorProps) {
  const key = (section: string) => `${revision}|${file}|${section}`;
  const groups = useAsyncData(key("groups"), () => client.groupsOf(root, file));
  const imports = useAsyncData(key("imports"), () => client.edges(root, { file, direction: "imports", limit: LIMIT }));
  const importers = useAsyncData(key("importers"), () => client.edges(root, { file, direction: "importers", limit: LIMIT }));
  const findings = useAsyncData(key("findings"), () => client.findings(root, { file, limit: LIMIT }));
  const frameworks = useAsyncData(hasFrameworks ? key("frameworks") : null, async () => (await client.frameworkRelations(root, { file, limit: LIMIT })).relations);
  const git = useAsyncData(hasGit ? key("git") : null, () => client.gitFile(root, file));

  return (
    <div>
      <h3 className={styles.title}>{file.split("/").pop()}</h3>
      <p className={styles.muted}>
        <button className={styles.linkButton} onClick={() => onNavigate({ file })}>
          {file}
        </button>
      </p>
      <Section title="Groups" data={groups}>
        {(assignments) =>
          assignments.length ? (
            <ul className={styles.list}>
              {assignments.map((assignment) => (
                <li key={assignment.group.id} className={styles.row}>
                  <strong>{assignment.group.label}</strong>
                  <span className={styles.muted}>
                    {assignment.group.kind.replace("_", " ")} · {assignment.group.explanation}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>Not in any group.</p>
          )
        }
      </Section>
      <Section title="Findings" data={findings}>
        {(page) =>
          page.entries.length ? (
            <ul className={styles.list}>
              {page.entries.map(({ finding }) => (
                <li key={finding.id} className={styles.row}>
                  <span className={styles.rowHeader}>
                    <SeverityPill severity={finding.severity} />
                    <strong>{finding.title}</strong>
                  </span>
                  {finding.kind === "candidate" ? <span className={styles.caveat}>Candidate · {finding.confidence} confidence</span> : null}
                  {finding.locations
                    .filter((location) => location.file === file)
                    .slice(0, 3)
                    .map((location) => (
                      <button key={`${location.start}`} className={styles.linkButton} onClick={() => onNavigate({ file, line: location.line, column: location.column, stale: location.stale })}>
                        {location.line ? `Line ${location.line}` : "Open file"}
                        {location.stale ? " (file changed)" : ""}
                      </button>
                    ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.muted}>No findings for this file.</p>
          )
        }
      </Section>
      {hasFrameworks ? (
        <Section title="Framework relations" data={frameworks}>
          {(relations) => <FrameworkRows relations={relations} file={file} onNavigate={onNavigate} />}
        </Section>
      ) : null}
      <Section title="Imports" data={imports}>
        {(page) => <ImportRows edges={page.edges} empty="Imports nothing." onNavigate={onNavigate} showFile="target" />}
      </Section>
      <Section title="Imported by" data={importers}>
        {(page) => <ImportRows edges={page.edges} empty="Nothing imports this file." onNavigate={onNavigate} showFile="importing" />}
      </Section>
      {hasGit ? (
        <Section title="History" data={git}>
          {(facts) =>
            facts === null || facts.churn === null ? (
              <p className={styles.muted}>No changes in the analysed history window.</p>
            ) : (
              <div>
                <p>
                  {facts.churn.commits} commit{facts.churn.commits === 1 ? "" : "s"}, +{facts.churn.lines_added} −{facts.churn.lines_removed}, last changed{" "}
                  {new Date(facts.churn.last_change * 1000).toLocaleDateString()}
                </p>
                {facts.contributors.length ? (
                  <p>Recent contributors: {facts.contributors.map((c) => `${c.contributor.name} (${Math.round(c.commit_share_per_mille / 10)}%)`).join(", ")}</p>
                ) : null}
                {facts.co_changed.length ? (
                  <>
                    <p className={styles.sectionTitle}>Often changed together with</p>
                    <ul className={styles.list}>
                      {facts.co_changed.map((partner) => (
                        <li key={partner.partner} className={styles.row}>
                          <button className={styles.linkButton} onClick={() => onNavigate({ file: partner.partner })}>
                            {partner.partner}
                          </button>
                          <span className={styles.muted}>
                            {partner.support} of {partner.file_commits} commits
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : null}
                <p className={styles.caveat}>{facts.interpretation}</p>
              </div>
            )
          }
        </Section>
      ) : null}
    </div>
  );
}
