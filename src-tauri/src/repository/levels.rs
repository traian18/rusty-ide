//! The levelled architecture view: packages, then the components inside one package.
//!
//! Everything is derived from the snapshot's groups and import edges. Containment is computed
//! (a node's parent is the smallest candidate that holds all of its files), so nothing is invented
//! and the core contracts do not change. Ranking, folding and edge thinning are the frontend's job.
use std::{
    collections::{BTreeMap, HashMap},
    path::{Path, PathBuf},
};

use harness_workspace::{
    dependency_groups::{Group, GroupKind},
    folder_tree::{self, REST_PREFIX},
    import_graph::ImportKind,
    repository_intelligence::{RepositorySnapshot, RootRelativePath},
};

use super::{
    dto::{
        LevelChild, LevelEdge, LevelFrameworkEdge, LevelName, LevelNode, LevelRequest, LevelView,
    },
    entry::Entry,
    error::RepositoryError,
};

const DEFAULT_NODES: usize = 500;
const DEFAULT_EDGES: usize = 5_000;
const OTHER_PACKAGES: &str = "other";
/// Most small circles drawn inside one node; the rest are counted.
const MAX_CHILD_DOTS: usize = 12;
/// Most file paths listed on a loose-files node, so findings can be summed for it.
const MAX_LISTED_FILES: usize = 2_000;

/// Small circles drawn inside a node: its direct components, the biggest first. Only these are
/// shown at once; opening the node shows the same components as nodes of their own.
fn children_of(group: &Group) -> (Vec<LevelChild>, usize) {
    let listing = folder_tree::list(group);
    let loose = listing.loose.len();
    let has_folders = !listing.folders.is_empty();
    let mut children = listing
        .folders
        .into_iter()
        .map(|folder| LevelChild {
            id: folder.group.id.0,
            label: folder.group.label,
            file_count: folder.group.members.len(),
            has_children: folder.has_folders,
        })
        .collect::<Vec<_>>();
    // Files that sit in none of the folders are one more circle, so a mixed folder reads as
    // "these folders, and the rest of its files" rather than as every file at once.
    if has_folders && loose > 0 {
        children.push(LevelChild {
            id: format!("{REST_PREFIX}{}", group.id.0),
            label: "files".into(),
            file_count: loose,
            has_children: false,
        });
    }
    children.sort_by(|a, b| b.file_count.cmp(&a.file_count).then(a.id.cmp(&b.id)));
    let more = children.len().saturating_sub(MAX_CHILD_DOTS);
    children.truncate(MAX_CHILD_DOTS);
    (children, more)
}

struct Builder<'a> {
    snapshot: &'a RepositorySnapshot,
    candidates: Vec<Group>,
    /// Candidate that owns each file: the smallest one holding it.
    owner: HashMap<RootRelativePath, usize>,
    cycle_of: HashMap<&'a RootRelativePath, usize>,
    languages: HashMap<&'a RootRelativePath, String>,
}

impl<'a> Builder<'a> {
    fn new(snapshot: &'a RepositorySnapshot, candidates: Vec<Group>) -> Self {
        let mut order = (0..candidates.len()).collect::<Vec<_>>();
        // Largest first, so the smallest candidate writes last and owns the file.
        order.sort_by(|a, b| {
            candidates[*b]
                .members
                .len()
                .cmp(&candidates[*a].members.len())
                .then(candidates[*a].id.cmp(&candidates[*b].id))
        });
        let mut owner: HashMap<RootRelativePath, usize> = HashMap::new();
        for position in order {
            for file in &candidates[position].members {
                owner.insert(file.clone(), position);
            }
        }
        let mut cycle_of = HashMap::new();
        for (index, group) in snapshot
            .groups
            .groups
            .iter()
            .filter(|group| group.kind == GroupKind::ImportCycle)
            .enumerate()
        {
            for file in &group.members {
                cycle_of.insert(file, index);
            }
        }
        let languages = snapshot
            .imports
            .files
            .iter()
            .map(|file| (&file.path, format!("{:?}", file.profile).to_lowercase()))
            .collect();
        Self {
            snapshot,
            candidates,
            owner,
            cycle_of,
            languages,
        }
    }

    fn language_counts<'b>(
        &self,
        files: impl Iterator<Item = &'b RootRelativePath>,
    ) -> BTreeMap<String, usize>
    where
        'a: 'b,
    {
        let mut counts = BTreeMap::new();
        for file in files {
            if let Some(language) = self.languages.get(file) {
                *counts.entry(language.clone()).or_insert(0) += 1;
            }
        }
        counts
    }
}

impl Entry {
    /// Candidate nodes and aggregated edges for one level of the architecture view.
    pub fn architecture_level(&self, request: LevelRequest) -> Result<LevelView, RepositoryError> {
        let snapshot = self.snapshot()?;
        if !snapshot.groups.configured {
            return Err(RepositoryError::new(
                "not_configured",
                "dependency groups are not configured for this repository",
            ));
        }
        let node_limit = request.node_limit.unwrap_or(DEFAULT_NODES);
        let edge_limit = request.edge_limit.unwrap_or(DEFAULT_EDGES);
        if node_limit == 0 || edge_limit == 0 {
            return Err(RepositoryError::new(
                "limit_exceeded",
                "limits must be positive",
            ));
        }
        let focus_group: Option<Group> = match request.level {
            LevelName::Packages => None,
            LevelName::Components => {
                let id = request
                    .focus
                    .as_deref()
                    .ok_or_else(|| RepositoryError::invalid("components need a focus package"))?;
                let group = folder_tree::group_of(&snapshot, id).ok_or_else(|| {
                    RepositoryError::new("unknown_group", format!("unknown group: {id}"))
                })?;
                Some(group)
            }
        };
        let (unit, candidates) = match &focus_group {
            None => folder_tree::top_level(&snapshot),
            Some(focus) => (
                folder_tree::declared_unit(&snapshot).unwrap_or(GroupKind::Directory),
                folder_tree::immediate_directories(focus),
            ),
        };
        let focus_group = focus_group.as_ref();
        let builder = Builder::new(&snapshot, candidates);

        // Edges are attributed to the owning candidate; files with no owner go to a synthetic node.
        let rest_id = format!(
            "rest:{}",
            focus_group.map_or("workspace", |group| group.id.0.as_str())
        );
        let mut rest_paths: Vec<String> = Vec::new();
        let mut other_files = 0usize;
        let mut node_cycle = vec![false; builder.candidates.len()];
        let (mut rest_cycle, mut other_cycle) = (false, false);
        let mut endpoint = |file: &RootRelativePath, cycle: bool| -> String {
            match builder.owner.get(file) {
                Some(position) => {
                    node_cycle[*position] |= cycle;
                    builder.candidates[*position].id.0.clone()
                }
                None => match focus_group {
                    Some(focus) if !focus.contains(file) => {
                        other_cycle |= cycle;
                        OTHER_PACKAGES.to_owned()
                    }
                    _ => {
                        rest_cycle |= cycle;
                        rest_id.clone()
                    }
                },
            }
        };

        let mut pairs: BTreeMap<(String, String), (usize, usize, bool)> = BTreeMap::new();
        for edge in &snapshot.imports.edges {
            let Some(target) = edge.resolution.target_file() else {
                continue;
            };
            let source = &edge.fact.importing_file;
            if source == target {
                continue;
            }
            if request
                .import_kind
                .is_some_and(|kind| kind != edge.fact.kind)
            {
                continue;
            }
            let shared_cycle = matches!(
                (builder.cycle_of.get(source), builder.cycle_of.get(target)),
                (Some(a), Some(b)) if a == b
            );
            let (from, to) = (
                endpoint(source, shared_cycle),
                endpoint(target, shared_cycle),
            );
            if from == to {
                continue;
            }
            // Edges that never touch the focus package say nothing about it.
            if focus_group.is_some() && from == OTHER_PACKAGES && to == OTHER_PACKAGES {
                continue;
            }
            let entry = pairs.entry((from, to)).or_insert((0, 0, false));
            match edge.fact.kind {
                ImportKind::Runtime => entry.0 += 1,
                ImportKind::TypeOnly => entry.1 += 1,
            }
            entry.2 |= shared_cycle;
        }

        // Framework relations between the same nodes, counted by kind, never mixed with imports.
        let mut framework_pairs: BTreeMap<(String, String), BTreeMap<String, usize>> =
            BTreeMap::new();
        for relation in &snapshot.frameworks.relations {
            let Some(to) = &relation.to else { continue };
            if focus_group
                .is_some_and(|focus| !focus.contains(&relation.from) && !focus.contains(to))
            {
                continue;
            }
            let (from, to) = (endpoint(&relation.from, false), endpoint(to, false));
            if from == to
                || (focus_group.is_some() && from == OTHER_PACKAGES && to == OTHER_PACKAGES)
            {
                continue;
            }
            let kind = serde_json::to_value(relation.kind)
                .ok()
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default();
            *framework_pairs
                .entry((from, to))
                .or_default()
                .entry(kind)
                .or_insert(0) += 1;
        }

        // Which files fall outside every candidate.
        match focus_group {
            Some(focus) => {
                for file in &focus.members {
                    if !builder.owner.contains_key(file) {
                        rest_paths.push(file.as_path().display().to_string());
                    }
                }
                other_files = snapshot
                    .imports
                    .files
                    .len()
                    .saturating_sub(focus.members.len());
            }
            None => {
                for file in &snapshot.imports.files {
                    if !builder.owner.contains_key(&file.path) {
                        rest_paths.push(file.path.as_path().display().to_string());
                    }
                }
            }
        }

        let mut nodes = builder
            .candidates
            .iter()
            .enumerate()
            .map(|(position, group)| {
                let (children, more_children) = children_of(group);
                LevelNode {
                    id: group.id.0.clone(),
                    label: group.label.clone(),
                    kind: group.kind,
                    basis: Some(group.basis),
                    explanation: group.explanation.clone(),
                    file_count: group.members.len(),
                    languages: builder.language_counts(group.members.iter()),
                    parent: None,
                    children,
                    more_children,
                    files: Vec::new(),
                    in_cycle: node_cycle[position]
                        || group
                            .members
                            .iter()
                            .any(|file| builder.cycle_of.contains_key(file)),
                    synthetic: false,
                }
            })
            .collect::<Vec<_>>();
        let rest_files = rest_paths.len();
        if rest_files > 0 {
            nodes.push(LevelNode {
                id: rest_id.clone(),
                label: if focus_group.is_some() {
                    "Inner folder files".into()
                } else {
                    "Other files".into()
                },
                kind: GroupKind::Directory,
                basis: None,
                explanation: "Files that belong to no node at this level.".into(),
                file_count: rest_files,
                languages: BTreeMap::new(),
                parent: None,
                children: Vec::new(),
                more_children: 0,
                files: rest_paths.into_iter().take(MAX_LISTED_FILES).collect(),
                in_cycle: rest_cycle,
                synthetic: true,
            });
        }
        if focus_group.is_some()
            && pairs
                .keys()
                .any(|(from, to)| from == OTHER_PACKAGES || to == OTHER_PACKAGES)
        {
            nodes.push(LevelNode {
                id: OTHER_PACKAGES.into(),
                label: "Other packages".into(),
                kind: unit,
                basis: None,
                explanation: "Every file outside the focused package, shown as one node.".into(),
                file_count: other_files,
                languages: BTreeMap::new(),
                parent: None,
                children: Vec::new(),
                more_children: 0,
                files: Vec::new(),
                in_cycle: other_cycle,
                synthetic: true,
            });
        }

        let total_nodes = nodes.len();
        let nodes_truncated = total_nodes > node_limit;
        if nodes_truncated {
            nodes.sort_by(|a, b| b.file_count.cmp(&a.file_count).then(a.id.cmp(&b.id)));
            nodes.truncate(node_limit);
            nodes.sort_by(|a, b| a.id.cmp(&b.id));
        }
        let kept = nodes
            .iter()
            .map(|node| node.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        let mut edges = pairs
            .into_iter()
            .filter(|((from, to), _)| kept.contains(from.as_str()) && kept.contains(to.as_str()))
            .map(|((from, to), (runtime, type_only, in_cycle))| LevelEdge {
                from,
                to,
                runtime,
                type_only,
                in_cycle,
            })
            .collect::<Vec<_>>();
        let edges_truncated = edges.len() > edge_limit;
        if edges_truncated {
            edges.sort_by(|a, b| {
                (b.runtime + b.type_only)
                    .cmp(&(a.runtime + a.type_only))
                    .then(a.from.cmp(&b.from))
                    .then(a.to.cmp(&b.to))
            });
            edges.truncate(edge_limit);
        }
        let framework_edges = framework_pairs
            .into_iter()
            .filter(|((from, to), _)| kept.contains(from.as_str()) && kept.contains(to.as_str()))
            .map(|((from, to), kinds)| LevelFrameworkEdge { from, to, kinds })
            .collect();
        Ok(LevelView {
            snapshot: snapshot.id.0.clone(),
            level: request.level,
            focus: request.focus,
            unit_kind: unit,
            leaf: focus_group.is_some() && builder.candidates.is_empty(),
            nodes,
            edges,
            framework_edges,
            total_nodes,
            nodes_truncated,
            edges_truncated,
            cycle_groups: snapshot
                .groups
                .groups
                .iter()
                .filter(|group| group.kind == GroupKind::ImportCycle)
                .count(),
        })
    }
}
