//! What the Code Health page receives (camelCase on the wire; core types keep their own names).
use std::collections::BTreeMap;

use harness_code_health::{
    rollup::{FolderHealth, RepositoryHealth, SelfCheck},
    scoring::CategoryDeduction,
    Band, Category, Finding,
};
use harness_git_analysis::FileSignals;
use serde::Serialize;

#[derive(Debug, Clone, Default, Serialize)]
pub struct SeverityCounts {
    pub critical: usize,
    pub high: usize,
    pub medium: usize,
    pub low: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthFileRow {
    pub path: String,
    pub language: String,
    pub nloc: u32,
    pub test: bool,
    pub hotspot: bool,
    /// `None` when the language is not measured.
    pub defect: Option<f64>,
    pub maintainability: Option<f64>,
    pub band: Option<Band>,
    pub structure: f64,
    pub history: f64,
    pub findings: SeverityCounts,
    /// The reason of the finding that costs the most.
    pub top_issue: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectorSummary {
    pub id: String,
    pub category: Category,
    pub summary: String,
    pub files: usize,
    pub findings: SeverityCounts,
    /// The files it fired on, worst score first, at most twenty.
    pub examples: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub snapshot: String,
    pub repository: RepositoryHealth,
    pub self_check: Option<SelfCheck>,
    /// Worst first; unscored files last.
    pub files: Vec<HealthFileRow>,
    pub folders: Vec<FolderHealth>,
    /// Detectors with findings, most findings first.
    pub detectors: Vec<DetectorSummary>,
    pub findings: usize,
    /// Git history was available, so history detectors ran.
    pub history: bool,
    pub languages_measured: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionRow {
    pub name: String,
    pub start_line: u32,
    pub end_line: u32,
    pub nloc: u32,
    pub ccn: u32,
    pub cognitive: u32,
    pub max_nesting: u32,
    pub params: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoredFinding {
    #[serde(flatten)]
    pub finding: Finding,
    /// Points this finding takes off the defect score.
    pub impact: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthFileDetail {
    pub row: HealthFileRow,
    /// Most costly first.
    pub findings: Vec<ScoredFinding>,
    pub defect_categories: BTreeMap<Category, CategoryDeduction>,
    pub maintainability_categories: BTreeMap<Category, CategoryDeduction>,
    pub unclamped: Option<f64>,
    /// The most complex functions, at most ten.
    pub functions: Vec<FunctionRow>,
    pub importers: u32,
    pub signals: Option<FileSignals>,
    /// A refactoring would aim here.
    pub target: f64,
}
