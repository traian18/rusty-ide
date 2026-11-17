import { useState } from "react";

import { repositoryContextEnabled, repositoryIndexingEnabled, setRepositoryContextEnabled, setRepositoryIndexingEnabled } from "../../settings";
import { backgroundClient } from "../../background";
import { Switch } from "../../../lib/ui";
import styles from "./Docs.module.css";

/** The two switches that decide whether chats are given these pages. */
export function ModelSwitches() {
  const [indexing, setIndexing] = useState(repositoryIndexingEnabled);
  const [context, setContext] = useState(repositoryContextEnabled);
  return (
    <span className={styles.switches}>
      <Switch
        id="docs-index-in-background"
        label="Index in background"
        title="Analyse the code again in the background a few seconds after files change (only the changed files are re-measured). No model is used."
        checked={indexing}
        onChange={(event) => {
          setRepositoryIndexingEnabled(event.target.checked);
          setIndexing(event.target.checked);
          void backgroundClient.setBackground(event.target.checked).catch(() => undefined);
        }}
      />
      <Switch
        id="docs-use-in-chats"
        label="Use in chats"
        title="Add the pages that match a request to the chat's context."
        checked={context}
        onChange={(event) => {
          setRepositoryContextEnabled(event.target.checked);
          setContext(event.target.checked);
        }}
      />
    </span>
  );
}
