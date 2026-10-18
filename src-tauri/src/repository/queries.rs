//! Read-only queries for the canvas, each a thin composition of repository contracts.
use std::collections::{BTreeMap, BTreeSet, HashSet};

use harness_findings::{FindingExplanation, FindingId, FindingsListQuery, FindingsPage, Severity};
use harness_git_analysis::{
    ChurnQuery, ChurnScope, ChurnSort, CoChangeQuery, ContributorQuery, GitQueryError,
};
use harness_workspace::{
    dependency_groups::{
        GraphProjection, GraphQuery, GroupAssignment, GroupId, GroupMembersQuery, GroupOverview,
        MemberPage, OverviewQuery, Truncation,
    },
    import_graph::{ImportFilter, ImportPage, ImportQuery},
    repository_intelligence::{PackageId, RootRelativePath},
};

use super::{
    dto::{
        BoundaryCounts, EdgeDirection, EdgesRequest, FindingBadges, FindingsRequest,
        FrameworkRequest, GitFileFacts, GroupGraph, GroupGraphEdge, GroupGraphNode,
        GroupGraphRequest, MembersRequest, NeighbourhoodRequest, NodesExist, NodesExistRequest,
        OverviewRequest, SeverityCounts,
    },
    entry::Entry,
    error::RepositoryError,
};

const DEFAULT_OVERVIEW_NODES: usize = 150;
const DEFAULT_OVERVIEW_EDGES: usize = 800;
const DEFAULT_GROUP_NODES: usize = 300;
const DEFAULT_GROUP_EDGES: usize = 1500;
const DEFAULT_NEIGHBOURHOOD_NODES: usize = 200;
const DEFAULT_NEIGHBOURHOOD_EDGES: usize = 800;
const DEFAULT_PAGE: usize = 50;
const GIT_FACTS_LIMIT: usize = 10;

fn path(value: &str) -> Result<RootRelativePath, RepositoryError> {
    RootRelativePath::new(value)
        .map_err(|_| RepositoryError::invalid(format!("not a workspace-relative path: {value}")))
}

impl Entry {
    /// Framework relations (routes, injected providers, rendered components, commands), paged.
    pub fn framework_relations(
        &self,
        request: FrameworkRequest,
    ) -> Result<harness_workspace::framework_relations::FrameworkPage, RepositoryError> {
        use harness_workspace::framework_relations::{FrameworkFilter, FrameworkQuery};
        let snapshot = self.snapshot()?;
        Ok(self.graph.framework_relations(&FrameworkQuery {
            snapshot: snapshot.id.clone(),
            filter: FrameworkFilter {
                framework: request.framework,
                kind: request.kind,
                file: request.file.as_deref().map(path).transpose()?,
                package: request.package.map(PackageId),
            },
            cursor: request.cursor,
            limit: request.limit.unwrap_or(DEFAULT_PAGE),
        })?)
    }

    pub fn overview(&self, request: OverviewRequest) -> Result<GroupOverview, RepositoryError> {
        let snapshot = self.snapshot()?;
        Ok(self.graph.group_overview(&OverviewQuery {
            snapshot: snapshot.id.clone(),
            kind: request.kind,
            node_limit: request.node_limit.unwrap_or(DEFAULT_OVERVIEW_NODES),
            edge_limit: request.edge_limit.unwrap_or(DEFAULT_OVERVIEW_EDGES),
            filter: ImportFilter {
                kind: request.import_kind,
                ..ImportFilter::default()
            },
        })?)
    }

    pub fn members(&self, request: MembersRequest) -> Result<MemberPage, RepositoryError> {
        let snapshot = self.snapshot()?;
        Ok(self.graph.group_members(&GroupMembersQuery {
            snapshot: snapshot.id.clone(),
            group: GroupId(request.group),
            cursor: request.cursor,
            limit: request.limit.unwrap_or(DEFAULT_PAGE),
        })?)
    }

    /// A group's member files and the imports among them, bounded; imports crossing the group
    /// boundary are only counted.
    pub fn group_graph(&self, request: GroupGraphRequest) -> Result<GroupGraph, RepositoryError> {
        let snapshot = self.snapshot()?;
        let group_id = GroupId(request.group);
        let group = snapshot
            .groups
            .group(&group_id)
            .cloned()
            .or_else(|| harness_workspace::folder_tree::derived_group(&snapshot, &group_id.0))
            .ok_or_else(|| {
                RepositoryError::new("unknown_group", format!("unknown group: {}", group_id.0))
            })?;
        let group = &group;
        let node_limit = request.node_limit.unwrap_or(DEFAULT_GROUP_NODES);
        let edge_limit = request.edge_limit.unwrap_or(DEFAULT_GROUP_EDGES);
        if node_limit == 0 || edge_limit == 0 {
            return Err(RepositoryError::new(
                "limit_exceeded",
                "limits must be positive",
            ));
        }
        let shown = group.members.iter().take(node_limit).collect::<Vec<_>>();
        let shown_set = shown.iter().copied().collect::<HashSet<_>>();
        let packages = snapshot
            .imports
            .files
            .iter()
            .map(|file| (&file.path, &file.package))
            .collect::<BTreeMap<_, _>>();
        let mut truncation = if group.members.len() > node_limit {
            Truncation::NodeLimit
        } else {
            Truncation::None
        };
        let (mut edges, mut outgoing, mut incoming) = (Vec::new(), 0, 0);
        for edge in &snapshot.imports.edges {
            let Some(target) = edge.resolution.target_file() else {
                continue;
            };
            let source = &edge.fact.importing_file;
            if source == target {
                continue;
            }
            match (group.contains(source), group.contains(target)) {
                (true, true) if shown_set.contains(source) && shown_set.contains(target) => {
                    if edges.len() >= edge_limit {
                        truncation = Truncation::EdgeLimit;
                    } else {
                        edges.push(GroupGraphEdge {
                            from: source.as_path().display().to_string(),
                            to: target.as_path().display().to_string(),
                            fact: edge.fact.id.0.clone(),
                            kind: edge.fact.kind,
                        });
                    }
                }
                (true, false) => outgoing += 1,
                (false, true) => incoming += 1,
                _ => {}
            }
        }
        Ok(GroupGraph {
            snapshot: snapshot.id.0.clone(),
            group: group.into(),
            nodes: shown
                .iter()
                .map(|file| GroupGraphNode {
                    file: file.as_path().display().to_string(),
                    package: packages
                        .get(*file)
                        .and_then(|package| package.as_ref())
                        .map(|package| package.0.clone()),
                })
                .collect(),
            edges,
            framework_edges: snapshot
                .frameworks
                .relations
                .iter()
                .filter_map(|relation| {
                    let to = relation.to.as_ref()?;
                    (relation.from != *to
                        && shown_set.contains(&relation.from)
                        && shown_set.contains(to))
                    .then(|| super::dto::GroupGraphFrameworkEdge {
                        from: relation.from.as_path().display().to_string(),
                        to: to.as_path().display().to_string(),
                        kind: relation.kind,
                        framework: relation.framework.clone(),
                        label: relation.label.clone(),
                    })
                })
                .take(edge_limit)
                .collect(),
            boundary: BoundaryCounts { outgoing, incoming },
            truncation,
            total_members: group.members.len(),
        })
    }

    /// Files around some files through resolved imports, bounded.
    pub fn neighbourhood(
        &self,
        request: NeighbourhoodRequest,
    ) -> Result<GraphProjection, RepositoryError> {
        let snapshot = self.snapshot()?;
        let roots = request
            .files
            .iter()
            .map(|f| path(f))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(self.graph.graph(&GraphQuery {
            snapshot: snapshot.id.clone(),
            roots,
            direction: request.direction,
            depth: request.depth,
            node_limit: request.node_limit.unwrap_or(DEFAULT_NEIGHBOURHOOD_NODES),
            edge_limit: request.edge_limit.unwrap_or(DEFAULT_NEIGHBOURHOOD_EDGES),
            filter: ImportFilter {
                kind: request.import_kind,
                ..ImportFilter::default()
            },
        })?)
    }

    pub fn edges(&self, request: EdgesRequest) -> Result<ImportPage, RepositoryError> {
        let snapshot = self.snapshot()?;
        let query = ImportQuery {
            snapshot: snapshot.id.clone(),
            file: path(&request.file)?,
            item: None,
            filter: ImportFilter::default(),
            cursor: request.cursor,
            limit: request.limit.unwrap_or(DEFAULT_PAGE),
        };
        Ok(match request.direction {
            EdgeDirection::Imports => self.graph.dependencies(&query)?,
            EdgeDirection::Importers => self.graph.dependents(&query)?,
        })
    }

    pub fn groups_of(&self, file: &str) -> Result<Vec<GroupAssignment>, RepositoryError> {
        let snapshot = self.snapshot()?;
        Ok(self.graph.groups_of(&snapshot.id, &path(file)?)?)
    }

    pub fn findings(&self, request: FindingsRequest) -> Result<FindingsPage, RepositoryError> {
        let set = self.findings.current().ok_or_else(|| {
            RepositoryError::new(
                "snapshot_not_found",
                "no findings have been computed yet; refresh first",
            )
        })?;
        let file = request.file.as_deref().map(path).transpose()?;
        Ok(self.findings.list(&FindingsListQuery {
            set: set.id.clone(),
            rules: request.rules,
            kind: request.kind,
            min_severity: request.min_severity,
            min_confidence: request.min_confidence,
            package: request.package.map(PackageId),
            file,
            include_suppressed: request.include_suppressed,
            cursor: request.cursor,
            limit: request.limit.unwrap_or(DEFAULT_PAGE),
        })?)
    }

    pub fn finding_explain(&self, finding: &str) -> Result<FindingExplanation, RepositoryError> {
        let set = self.findings.current().ok_or_else(|| {
            RepositoryError::new("snapshot_not_found", "no findings have been computed yet")
        })?;
        Ok(self
            .findings
            .explain(&set.id, &FindingId(finding.to_owned()))?)
    }

    /// Finding counts per file and per group, for badges.
    pub fn finding_badges(&self) -> Result<FindingBadges, RepositoryError> {
        let snapshot = self.snapshot()?;
        let Some(set) = self.findings.current() else {
            return Ok(FindingBadges::default());
        };
        let mut badges = FindingBadges {
            finding_set: Some(set.id.0.clone()),
            ..FindingBadges::default()
        };
        for finding in &set.findings {
            let mut groups = BTreeSet::new();
            for file in &finding.subjects {
                count(
                    badges
                        .by_file
                        .entry(file.as_path().display().to_string())
                        .or_default(),
                    finding.severity,
                );
                groups.extend(
                    snapshot
                        .groups
                        .groups_containing(file)
                        .map(|group| group.id.0.clone()),
                );
            }
            for group in groups {
                count(badges.by_group.entry(group).or_default(), finding.severity);
            }
        }
        Ok(badges)
    }

    /// Which of the given group ids and files exist in the current snapshot. Used to tell notes
    /// whose node vanished from notes whose node is simply not on screen.
    pub fn nodes_exist(&self, request: NodesExistRequest) -> Result<NodesExist, RepositoryError> {
        let snapshot = self.snapshot()?;
        Ok(NodesExist {
            groups: request
                .groups
                .into_iter()
                .filter(|id| {
                    snapshot.groups.group(&GroupId(id.clone())).is_some()
                        || harness_workspace::folder_tree::derived_group(&snapshot, id).is_some()
                })
                .collect(),
            files: request
                .files
                .into_iter()
                .filter(|file| {
                    RootRelativePath::new(file.as_str())
                        .is_ok_and(|p| snapshot.imports.has_file(&p))
                })
                .collect(),
        })
    }

    /// Churn, strongest co-change partners, and recent contributors, or `None` without Git history.
    pub fn git_file(&self, file: &str) -> Result<Option<GitFileFacts>, RepositoryError> {
        let Some(git) = self.git.current() else {
            return Ok(None);
        };
        let file = path(file)?;
        let churn = self.git.churn(&ChurnQuery {
            snapshot: git.id.clone(),
            scope: ChurnScope::File(file.clone()),
            sort: ChurnSort::Path,
            cursor: None,
            limit: 1,
        });
        let churn = match churn {
            Ok(page) => page.entries.into_iter().next(),
            Err(GitQueryError::UnknownFile(_)) => None,
            Err(error) => return Err(error.into()),
        };
        if churn.is_none() {
            return Ok(Some(GitFileFacts {
                git_snapshot: git.id.0.clone(),
                churn: None,
                co_changed: Vec::new(),
                contributors: Vec::new(),
                interpretation: git.coverage.interpretation.clone(),
            }));
        }
        let co_changed = self
            .git
            .co_changed(&CoChangeQuery {
                snapshot: git.id.clone(),
                file: file.clone(),
                min_support: None,
                min_confidence_per_mille: None,
                cursor: None,
                limit: GIT_FACTS_LIMIT,
            })?
            .entries;
        let contributors = self
            .git
            .contributors(&ContributorQuery {
                snapshot: git.id.clone(),
                file,
                cursor: None,
                limit: GIT_FACTS_LIMIT,
            })?
            .entries;
        Ok(Some(GitFileFacts {
            git_snapshot: git.id.0.clone(),
            churn,
            co_changed,
            contributors,
            interpretation: git.coverage.interpretation.clone(),
        }))
    }
}

fn count(counts: &mut SeverityCounts, severity: Severity) {
    match severity {
        Severity::High => counts.high += 1,
        Severity::Medium => counts.medium += 1,
        Severity::Low => counts.low += 1,
        Severity::Info => counts.info += 1,
    }
}
