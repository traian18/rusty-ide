//! One file for the shared drawer: its row, neighbours, findings that name it, and its history.
use std::collections::{BTreeSet, VecDeque};

use harness_findings::FindingKind;
use harness_repository_wiki::{facts::Facts, PageId};
use harness_workspace::repository_intelligence::RootRelativePath;

use super::{
    super::{entry::Entry, error::RepositoryError},
    index::severity_name,
    model::{Author, CoChanged, FileDetail, FileFinding, Neighbour},
};

const NEIGHBOURS: usize = 12;
const CO_CHANGED: usize = 8;
const AUTHORS: usize = 5;
const RADIUS_HOPS: usize = 2;

fn text(path: &RootRelativePath) -> String {
    path.as_path().display().to_string()
}

impl Entry {
    pub fn dashboard_file(&self, file: &str) -> Result<FileDetail, RepositoryError> {
        let path =
            RootRelativePath::new(file).map_err(|e| RepositoryError::invalid(e.to_string()))?;
        let index = self.file_index()?;
        let row = index
            .rows
            .into_iter()
            .find(|r| r.path == text(&path))
            .ok_or_else(|| RepositoryError::new("not_found", format!("{file} is not indexed")))?;
        let snapshot = self.snapshot()?;
        let facts = Facts::new(&snapshot);
        let importers: Vec<Neighbour> = facts
            .dependent_files(&path)
            .into_iter()
            .take(NEIGHBOURS)
            .map(|(p, weight)| Neighbour {
                path: text(&p),
                weight,
            })
            .collect();
        let mut imports: std::collections::BTreeMap<String, usize> = Default::default();
        for edge in facts.imports_of(&path) {
            if let harness_workspace::import_graph::Resolution::ResolvedInternal {
                target_file,
                ..
            } = &edge.resolution
            {
                *imports.entry(text(target_file)).or_default() += 1;
            }
        }
        let mut imports: Vec<Neighbour> = imports
            .into_iter()
            .map(|(path, weight)| Neighbour { path, weight })
            .collect();
        imports.sort_by(|a, b| b.weight.cmp(&a.weight).then(a.path.cmp(&b.path)));
        imports.truncate(NEIGHBOURS);

        // Files that reach this one through importers, within two hops.
        let mut seen: BTreeSet<RootRelativePath> = BTreeSet::new();
        let mut queue: VecDeque<(RootRelativePath, usize)> = VecDeque::from([(path.clone(), 0)]);
        while let Some((current, depth)) = queue.pop_front() {
            if depth == RADIUS_HOPS {
                continue;
            }
            for (importer, _) in facts.dependent_files(&current) {
                if importer != path && seen.insert(importer.clone()) {
                    queue.push_back((importer, depth + 1));
                }
            }
        }

        let findings = self
            .findings
            .current()
            .map(|set| {
                set.findings
                    .iter()
                    .filter(|f| f.subjects.contains(&path))
                    .map(|f| FileFinding {
                        id: f.id.0.clone(),
                        rule: f.rule.id.clone(),
                        title: f.title.clone(),
                        summary: f.summary.clone(),
                        rationale: f.rationale.clone(),
                        severity: severity_name(f.severity).to_owned(),
                        confidence: format!("{:?}", f.confidence).to_lowercase(),
                        candidate: f.kind == FindingKind::Candidate,
                        interpretation: f.interpretation.clone(),
                        lines: f
                            .locations
                            .iter()
                            .filter(|l| l.file == path)
                            .filter_map(|l| l.line)
                            .collect(),
                        other_files: f
                            .subjects
                            .iter()
                            .filter(|s| **s != path)
                            .take(NEIGHBOURS)
                            .map(text)
                            .collect(),
                    })
                    .collect()
            })
            .unwrap_or_default();

        let git = self.git.current();
        let authors = git
            .as_ref()
            .and_then(|g| g.index.contributors.iter().find(|c| c.file == path))
            .map(|c| {
                c.entries
                    .iter()
                    .take(AUTHORS)
                    .map(|e| Author {
                        name: e.contributor.name.clone(),
                        commits: e.commits,
                        share: f64::from(e.commit_share_per_mille) / 1000.0,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let co_changed = git
            .as_ref()
            .map(|g| {
                g.index
                    .co_changes
                    .iter()
                    .filter(|c| c.file == path)
                    .take(CO_CHANGED)
                    .map(|c| CoChanged {
                        path: text(&c.partner),
                        commits: c.support,
                        confidence: f64::from(c.confidence_per_mille) / 1000.0,
                    })
                    .collect()
            })
            .unwrap_or_default();
        let first_change = git
            .as_ref()
            .and_then(|g| g.index.churn.iter().find(|c| c.file == path))
            .map(|c| c.first_change);
        let groups = snapshot
            .groups
            .groups_containing(&path)
            .map(|g| g.label.clone())
            .collect();
        Ok(FileDetail {
            page: PageId::file(&row.path).0,
            row,
            groups,
            importers,
            imports,
            blast_radius: seen.len(),
            findings,
            authors,
            co_changed,
            first_change,
        })
    }
}
