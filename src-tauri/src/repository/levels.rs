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
    dependency_groups::{Group, GroupBasis, GroupId, GroupKind},
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

/// The prefix that marks a directory node that is derived from file paths rather than a group.
pub(super) const DIRECTORY_PREFIX: &str = "dir:";

/// A directory of files, derived from paths. Groups from the core cover declared structure only;
/// the directories inside a package are not groups, so they are computed here and labelled as such.
fn directory_group(path: &Path, label: String, members: Vec<RootRelativePath>) -> Group {
    let shown = path.display();
    Group {
        id: GroupId(format!("{DIRECTORY_PREFIX}{shown}")),
        kind: GroupKind::Directory,
        label,
        basis: GroupBasis::Inferred,
        explanation: format!(
            "Inferred: the files under `{shown}`. Directories inside a package are read from file \
             paths; they are not boundaries declared by a manifest."
        ),
        evidence: Vec::new(),
        cycle_sites: Vec::new(),
        evidence_truncated: false,
        involves_type_only: false,
        members,
    }
}

/// The prefix of the node that gathers the files of a focus that sit in none of its components.
pub(super) const REST_PREFIX: &str = "rest:";

/// The files of `rest:<focus>`: the focus's files that are in none of its direct components.
fn rest_group(snapshot: &RepositorySnapshot, id: &str) -> Option<Group> {
    let focus_id = id.strip_prefix(REST_PREFIX)?;
    let focus = snapshot
        .groups
        .group(&GroupId(focus_id.to_owned()))
        .cloned()
        .or_else(|| directory_group_of(snapshot, focus_id))?;
    let components = immediate_directories(&focus);
    let members = focus
        .members
        .iter()
        .filter(|file| !components.iter().any(|component| component.contains(file)))
        .cloned()
        .collect::<Vec<_>>();
    (!members.is_empty()).then(|| Group {
        id: GroupId(id.to_owned()),
        label: format!("Files in {}", focus.label),
        explanation: format!(
            "Inferred: the files of `{}` that are in none of its folders.",
            focus.label
        ),
        members,
        ..focus
    })
}

/// A group that exists only as a view: a `dir:` directory or the loose files of a focus.
pub(super) fn derived_group(snapshot: &RepositorySnapshot, id: &str) -> Option<Group> {
    if id.starts_with(REST_PREFIX) {
        return rest_group(snapshot, id);
    }
    directory_group_of(snapshot, id)
}

/// The directory node `dir:<path>` as a group, if any indexed file lives under it.
fn directory_group_of(snapshot: &RepositorySnapshot, id: &str) -> Option<Group> {
    let path = PathBuf::from(id.strip_prefix(DIRECTORY_PREFIX)?);
    let members = snapshot
        .imports
        .files
        .iter()
        .filter(|file| file.path.as_path().starts_with(&path))
        .map(|file| file.path.clone())
        .collect::<Vec<_>>();
    let label = path.display().to_string();
    (!members.is_empty() && !label.is_empty()).then(|| {
        let mut members = members;
        members.sort();
        directory_group(&path, label, members)
    })
}

/// Directories strictly below `base` that hold files, each with all files under it. With
/// `top_only` only the first level below `base` is produced.
fn directories_below<'a>(
    files: impl Iterator<Item = &'a RootRelativePath>,
    base: &Path,
    top_only: bool,
) -> Vec<Group> {
    let mut buckets: BTreeMap<PathBuf, Vec<RootRelativePath>> = BTreeMap::new();
    let base_depth = base.components().count();
    for file in files {
        let directories = file
            .as_path()
            .ancestors()
            .skip(1)
            .filter(|dir| dir.starts_with(base) && dir.components().count() > base_depth)
            .collect::<Vec<_>>();
        let chosen = if top_only {
            directories.last().copied().into_iter().collect()
        } else {
            directories
        };
        for dir in chosen {
            buckets
                .entry(dir.to_path_buf())
                .or_default()
                .push(file.clone());
        }
    }
    buckets
        .into_iter()
        .map(|(dir, mut members)| {
            members.sort();
            let label = dir.strip_prefix(base).unwrap_or(&dir).display().to_string();
            directory_group(&dir, label, members)
        })
        .collect()
}

/// The directory that holds every member of the group.
fn common_directory(group: &Group) -> PathBuf {
    let mut common: Option<Vec<_>> = None;
    for file in &group.members {
        let dir = file
            .as_path()
            .parent()
            .map(|p| p.components().collect::<Vec<_>>())
            .unwrap_or_default();
        common = Some(match common {
            None => dir,
            Some(current) => current
                .into_iter()
                .zip(dir)
                .take_while(|(a, b)| a == b)
                .map(|(a, _)| a)
                .collect(),
        });
    }
    common.unwrap_or_default().into_iter().collect()
}

/// The kind of group that stands for "a package" in this repository, if the core declares any.
fn declared_unit(snapshot: &RepositorySnapshot) -> Option<GroupKind> {
    [GroupKind::DeclaredPackage, GroupKind::SourceRoot]
        .into_iter()
        .find(|kind| {
            snapshot
                .groups
                .groups
                .iter()
                .any(|group| group.kind == *kind)
        })
}

fn package_candidates(snapshot: &RepositorySnapshot) -> (GroupKind, Vec<Group>) {
    match declared_unit(snapshot) {
        Some(kind) => (
            kind,
            snapshot
                .groups
                .groups
                .iter()
                .filter(|group| group.kind == kind)
                .cloned()
                .collect(),
        ),
        None => (
            GroupKind::Directory,
            directories_below(
                snapshot.imports.files.iter().map(|file| &file.path),
                Path::new(""),
                true,
            ),
        ),
    }
}

/// Directory path of a derived `dir:` group.
fn directory_path(group: &Group) -> Option<&str> {
    group.id.0.strip_prefix(DIRECTORY_PREFIX)
}

/// Small circles drawn inside a node: its direct components, the biggest first. Only these are
/// shown at once; opening the node shows the same components as nodes of their own.
fn children_of(group: &Group) -> (Vec<LevelChild>, usize) {
    let top = immediate_directories(group);
    // Files that sit in none of the folders are one more circle, so a mixed folder reads as
    // "these folders, and the rest of its files" rather than as every file at once.
    let loose = group
        .members
        .iter()
        .filter(|file| !top.iter().any(|folder| folder.contains(file)))
        .count();
    let mut children = top
        .into_iter()
        .map(|child| {
            // A folder holds more folders when some file sits deeper than the folder itself.
            let has_children = directory_path(&child).is_some_and(|path| {
                child
                    .members
                    .iter()
                    .any(|file| file.as_path().parent() != Some(Path::new(path)))
            });
            LevelChild {
                id: child.id.0,
                label: child.label,
                file_count: child.members.len(),
                has_children,
            }
        })
        .collect::<Vec<_>>();
    if !children.is_empty() && loose > 0 {
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

/// The folder a group is read from: the folder a `dir:` node names, otherwise the deepest folder
/// that holds all of its files.
fn base_directory(group: &Group) -> PathBuf {
    directory_path(group).map_or_else(|| common_directory(group), PathBuf::from)
}

/// The folders directly inside the group's folder, each with every file under it. Files that sit
/// in the folder itself belong to none of them. One level only: opening a folder shows the next.
fn immediate_directories(focus: &Group) -> Vec<Group> {
    let base = base_directory(focus);
    let mut buckets: BTreeMap<PathBuf, Vec<RootRelativePath>> = BTreeMap::new();
    for file in &focus.members {
        let Ok(below) = file.as_path().strip_prefix(&base) else {
            continue;
        };
        let mut parts = below.components();
        if let (Some(first), Some(_file_name)) = (parts.next(), parts.next()) {
            buckets
                .entry(base.join(first.as_os_str()))
                .or_default()
                .push(file.clone());
        }
    }
    buckets
        .into_iter()
        .map(|(dir, mut members)| {
            members.sort();
            let label = dir
                .strip_prefix(&base)
                .unwrap_or(&dir)
                .display()
                .to_string();
            directory_group(&dir, label, members)
        })
        .collect()
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
                let group = snapshot
                    .groups
                    .group(&GroupId(id.to_owned()))
                    .cloned()
                    .or_else(|| derived_group(&snapshot, id))
                    .ok_or_else(|| {
                        RepositoryError::new("unknown_group", format!("unknown group: {id}"))
                    })?;
                Some(group)
            }
        };
        let (unit, candidates) = match &focus_group {
            None => package_candidates(&snapshot),
            Some(focus) => (
                declared_unit(&snapshot).unwrap_or(GroupKind::Directory),
                immediate_directories(focus),
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
