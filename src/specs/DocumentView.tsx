import { Callout } from "../components/ui";
import { MarkdownRenderer } from "../components/ui/MarkdownRenderer";
import { useLoad } from "../dashboard/useLoad";
import type { SpecsClient } from "./client";
import styles from "./Specs.module.css";

export interface DocumentViewProps {
  client: SpecsClient;
  root: string;
  /** Relative to the repository. */
  path: string;
  /** Reload when this changes. */
  revision: number;
  /** Said when the file does not exist. */
  missing: string;
}

/** One Markdown document under the specs root. */
export function DocumentView({ client, root, path, revision, missing }: DocumentViewProps) {
  const loaded = useLoad(() => client.document(root, path), [client, root, path, revision]);
  if (loaded.error) return <Callout variant="danger">{loaded.error}</Callout>;
  if (loaded.loading && loaded.value === null) return <div role="status">Loading…</div>;
  if (loaded.value === null) return <p className={styles.muted}>{missing}</p>;
  return (
    <article className={styles.prose} aria-label={path}>
      <MarkdownRenderer content={loaded.value} />
    </article>
  );
}
