import { useState } from "react";

import { repositoryContextEnabled, repositoryIndexingEnabled, setRepositoryContextEnabled, setRepositoryIndexingEnabled } from "../services/repositoryContextSettings";
import { backgroundClient } from "../background/client";
import styles from "./Docs.module.css";

/** The two switches that decide whether chats are given these pages. */
export function ModelSwitches() {
  const [indexing, setIndexing] = useState(repositoryIndexingEnabled);
  const [context, setContext] = useState(repositoryContextEnabled);
  return (
    <>
      <label className={styles.muted} title="Analyse the code again in the background a few seconds after files change (only the changed files are re-measured). No model is used.">
        <input
          type="checkbox"
          checked={indexing}
          onChange={(event) => {
            setRepositoryIndexingEnabled(event.target.checked);
            setIndexing(event.target.checked);
            void backgroundClient.setBackground(event.target.checked).catch(() => undefined);
          }}
        />{" "}
        Index in background
      </label>
      <label className={styles.muted} title="Add the pages that match a request to the chat's context.">
        <input
          type="checkbox"
          checked={context}
          onChange={(event) => {
            setRepositoryContextEnabled(event.target.checked);
            setContext(event.target.checked);
          }}
        />{" "}
        Use in chats
      </label>
    </>
  );
}
