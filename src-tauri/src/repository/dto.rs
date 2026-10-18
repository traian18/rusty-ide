//! Request and response shapes of the repository commands. Responses embed the core's own
//! serializable models wherever one exists, so the frontend sees the same data the agent tools do.
use std::collections::BTreeMap;

use harness_findings::{FindingsCursor, FindingsSummary};
use harness_git_analysis::{CoChange, ContributorShare, FileChurn};
use harness_workspace::dependency_groups::{GraphDirection, GroupKind, GroupSummary, Truncation};
use harness_workspace::import_graph::{ImportCursor, ImportKind};
use harness_workspace::repository_intelligence::{DiscoveryCapabilities, DiscoveryDiagnostic};
use serde::{Deserialize, Serialize};

/// What the frontend needs to know about a built repository snapshot.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotSummary {
    pub id: String,
    pub packages: usize,
    pub files: usize,
    pub imports: usize,
    pub partial: bool,
    pub languages: Vec<String>,
    pub groups_configured: bool,
    pub group_count: usize,
    pub unattached_files: usize,
    pub diagnostics_total: usize,
    /// Bounded; `diagnostics_total` says how many exist.
    pub diagnostics: Vec<DiscoveryDiagnostic>,
    pub frameworks: FrameworksSummary,
}

/// Which frameworks were found active, and what the adapters could and could not read.
#[derive(Debug, Clone, Serialize)]
pub struct FrameworksSummary {
    pub configured: bool,
    /// Frameworks found active, by package, with the manifest fact that showed it.
    pub applications: Vec<harness_workspace::framework_relations::FrameworkApplication>,
    pub relations: usize,
    pub partial: bool,
    pub diagnostics_total: usize,
    /// Conventions that could not be read statically; bounded.
    pub diagnostics: Vec<DiscoveryDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitSummary {
    pub id: String,
    pub head: String,
    pub commits_used: usize,
    pub shallow: bool,
    pub working_tree_dirty: bool,
    pub walk_stop: String,
    pub interpretation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FindingsStatus {
    pub id: String,
    pub summary: FindingsSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct StageError {
    pub stage: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenResponse {
    pub root: String,
    pub discovery: DiscoveryCapabilities,
    pub snapshot: Option<SnapshotSummary>,
    pub git: Option<GitSummary>,
    pub findings: Option<FindingsStatus>,
    pub built_at_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RefreshResponse {
    pub snapshot: SnapshotSummary,
    pub git: Option<GitSummary>,
    pub findings: Option<FindingsStatus>,
    pub built_at_ms: u64,
    /// Stages after the repository scan that failed without invalidating it.
    pub stage_errors: Vec<StageError>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OverviewRequest {
    pub kind: GroupKind,
    pub node_limit: Option<usize>,
    pub edge_limit: Option<usize>,
    pub import_kind: Option<ImportKind>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MembersRequest {
    pub group: String,
    pub cursor: Option<ImportCursor>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GroupGraphRequest {
    pub group: String,
    pub node_limit: Option<usize>,
    pub edge_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupGraphNode {
    pub file: String,
    pub package: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupGraphEdge {
    pub from: String,
    pub to: String,
    pub fact: String,
    pub kind: ImportKind,
}

#[derive(Debug, Clone, Serialize)]
pub struct BoundaryCounts {
    pub outgoing: usize,
    pub incoming: usize,
}

/// A group's member files and the imports among them.
#[derive(Debug, Clone, Serialize)]
pub struct GroupGraph {
    pub snapshot: String,
    pub group: GroupSummary,
    pub nodes: Vec<GroupGraphNode>,
    pub edges: Vec<GroupGraphEdge>,
    /// Framework relations between the files shown (not imports).
    pub framework_edges: Vec<GroupGraphFrameworkEdge>,
    pub boundary: BoundaryCounts,
    pub truncation: Truncation,
    pub total_members: usize,
}

#[derive(Debug, Clone, Deserialize)]
pub struct NeighbourhoodRequest {
    pub files: Vec<String>,
    pub direction: GraphDirection,
    pub depth: usize,
    pub node_limit: Option<usize>,
    pub edge_limit: Option<usize>,
    pub import_kind: Option<ImportKind>,
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EdgeDirection {
    Imports,
    Importers,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EdgesRequest {
    pub file: String,
    pub direction: EdgeDirection,
    pub cursor: Option<ImportCursor>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FindingsRequest {
    #[serde(default)]
    pub rules: Vec<String>,
    pub kind: Option<harness_findings::FindingKind>,
    pub min_severity: Option<harness_findings::Severity>,
    pub min_confidence: Option<harness_findings::Confidence>,
    pub package: Option<String>,
    pub file: Option<String>,
    #[serde(default)]
    pub include_suppressed: bool,
    pub cursor: Option<FindingsCursor>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct SeverityCounts {
    pub high: usize,
    pub medium: usize,
    pub low: usize,
    pub info: usize,
}

/// Finding counts per file and per group, for badges on the canvas.
#[derive(Debug, Clone, Default, Serialize)]
pub struct FindingBadges {
    pub finding_set: Option<String>,
    pub by_file: BTreeMap<String, SeverityCounts>,
    pub by_group: BTreeMap<String, SeverityCounts>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GitFileFacts {
    pub git_snapshot: String,
    pub churn: Option<FileChurn>,
    pub co_changed: Vec<CoChange>,
    pub contributors: Vec<ContributorShare>,
    pub interpretation: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Freshness {
    pub built_at_ms: Option<u64>,
    pub checked: usize,
    pub changed: Vec<String>,
    pub missing: Vec<String>,
}

/// Which of the asked-about nodes still exist in the current snapshot.
#[derive(Debug, Clone, Deserialize)]
pub struct NodesExistRequest {
    #[serde(default)]
    pub groups: Vec<String>,
    #[serde(default)]
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodesExist {
    pub groups: Vec<String>,
    pub files: Vec<String>,
}

/// Which level of the levelled architecture view to build.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LevelName {
    /// Declared packages (or source roots / top-level directories when there are no manifests).
    Packages,
    /// The source roots and directories inside one package; everything else is collapsed.
    Components,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LevelRequest {
    pub level: LevelName,
    /// The package whose components are shown; required for `components`.
    pub focus: Option<String>,
    pub import_kind: Option<ImportKind>,
    pub node_limit: Option<usize>,
    pub edge_limit: Option<usize>,
}

/// A candidate node of a level. The frontend ranks and folds these; nothing here is a score.
#[derive(Debug, Clone, Serialize)]
pub struct LevelNode {
    pub id: String,
    pub label: String,
    pub kind: GroupKind,
    /// Absent for synthetic nodes (`other`, `rest:…`).
    pub basis: Option<harness_workspace::dependency_groups::GroupBasis>,
    pub explanation: String,
    pub file_count: usize,
    /// File counts by language.
    pub languages: BTreeMap<String, usize>,
    /// Always `None`: a level shows only the direct components of its focus, and what lies deeper
    /// is previewed in `children`. Kept for the workspace frame and older saved views.
    pub parent: Option<String>,
    /// The node's direct components, biggest first, drawn as small circles inside it.
    pub children: Vec<LevelChild>,
    /// Components beyond the ones listed in `children`.
    pub more_children: usize,
    /// Paths of the files of a loose-files node (empty for every other node).
    pub files: Vec<String>,
    /// True when some member file takes part in an import cycle.
    pub in_cycle: bool,
    /// True for nodes that stand for files outside any candidate.
    pub synthetic: bool,
}

/// One small circle inside a node: a component that opens to its own components or its files.
#[derive(Debug, Clone, Serialize)]
pub struct LevelChild {
    /// A `dir:<path>` id that `components` accepts as a focus.
    pub id: String,
    pub label: String,
    pub file_count: usize,
    /// False when opening it shows its files, because it has no components of its own.
    pub has_children: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct LevelEdge {
    pub from: String,
    pub to: String,
    pub runtime: usize,
    pub type_only: usize,
    /// True when some import it stands for lies inside one import cycle.
    pub in_cycle: bool,
}

/// Framework relations between two nodes of a level, counted by kind.
#[derive(Debug, Clone, Serialize)]
pub struct LevelFrameworkEdge {
    pub from: String,
    pub to: String,
    pub kinds: BTreeMap<String, usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LevelView {
    pub snapshot: String,
    pub level: LevelName,
    pub focus: Option<String>,
    /// The kind of group that forms the packages level of this repository.
    pub unit_kind: GroupKind,
    /// True when the focus has no folders to show, so the person should see its files instead.
    pub leaf: bool,
    pub nodes: Vec<LevelNode>,
    pub edges: Vec<LevelEdge>,
    pub framework_edges: Vec<LevelFrameworkEdge>,
    pub total_nodes: usize,
    pub nodes_truncated: bool,
    pub edges_truncated: bool,
    pub cycle_groups: usize,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct FrameworkRequest {
    pub framework: Option<String>,
    pub kind: Option<harness_workspace::framework_relations::RelationKind>,
    pub file: Option<String>,
    pub package: Option<String>,
    pub cursor: Option<harness_workspace::framework_relations::FrameworkCursor>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupGraphFrameworkEdge {
    pub from: String,
    pub to: String,
    pub kind: harness_workspace::framework_relations::RelationKind,
    pub framework: String,
    pub label: String,
}

/// One repository of a workspace folder, as the Docs tab lists it.
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceRepository {
    pub id: String,
    pub name: String,
    /// Relative to the workspace folder; `.` when the repository is the folder itself.
    pub path: String,
    pub kind: String,
    pub branch: Option<String>,
    /// An index is loaded for it now.
    pub indexed: bool,
    pub built_at_ms: Option<u64>,
    pub files: usize,
}
