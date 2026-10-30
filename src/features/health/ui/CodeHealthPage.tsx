import {useState} from "react";

import {Callout} from "../../../lib/ui";
import { dashboardStyles as d, useLoad } from "../../dashboard/ui";
import type { HealthClient } from "../client";
import { HealthDrawer } from "./HealthDrawer";
import { HealthMap } from "./HealthMap";
import { TrendCard } from "./TrendCard";
import s from "./Health.module.css";
import { Lede, Distribution } from "./HealthLede";
import { FilesTab, IssuesTab, FoldersTab } from "./HealthTabs";

export interface CodeHealthPageProps {
  client: HealthClient;
  root: string;
  revision: number;
  openFile(file: string, line?: number): void;
}

type Tab = "files" | "issues" | "folders" | "map";

/**
 * Code health for one repository: how healthy the code is, what pulls it down, and where; every
 * file opens a drawer with its issues and a prompt to fix them.
 */
export function CodeHealthPage({ client, root, revision, openFile }: CodeHealthPageProps) {
  const { value: report, error, loading } = useLoad(() => client.report(root), [client, root, revision]);
  const [tab, setTab] = useState<Tab>("files");
  const [selected, setSelected] = useState<string | null>(null);
  if (error) {
    return (
      <div className={d.page}>
        <Callout variant="danger">{error}</Callout>
      </div>
    );
  }
  if (!report) {
    return (
      <div className={d.page} role="status">
        {loading ? "Measuring the code…" : null}
      </div>
    );
  }
  return (
    <>
      <div className={d.page}>
        <article aria-label="Code health">
          <Lede report={report} onOpen={setSelected} />
          <Distribution report={report} />
          <TrendCard client={client} root={root} revision={revision} onOpen={setSelected} />
          <div className={s.tabs} role="tablist">
            {(["files", "issues", "folders", "map"] as Tab[]).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={s.tab} onClick={() => setTab(t)}>
                {t === "files" ? `Files (${report.repository.file_count})` : t === "issues" ? `Issues (${report.findings})` : t === "folders" ? "Folders" : "Map"}
              </button>
            ))}
          </div>
          {tab === "files" ? <FilesTab report={report} selected={selected} onSelect={setSelected} /> : null}
          {tab === "issues" ? <IssuesTab report={report} onSelect={setSelected} /> : null}
          {tab === "folders" ? <FoldersTab report={report} onSelect={setSelected} /> : null}
          {tab === "map" ? <HealthMap rows={report.files} selected={selected} onSelect={setSelected} /> : null}
        </article>
      </div>
      {selected ? <HealthDrawer key={selected} client={client} root={root} path={selected} revision={revision} onClose={() => setSelected(null)} onOpenFile={openFile} /> : null}
    </>
  );
}

