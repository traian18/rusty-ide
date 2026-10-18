//! What the dashboard pages receive. Field names are camelCase on the wire.
use serde::{Deserialize, Serialize};

use super::super::dto::SeverityCounts;

/// One tile of the files map: a folder (aggregated over everything below it) or a file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tile {
    pub path: String,
    pub name: String,
    pub folder: bool,
    pub files: usize,
    pub lines: u64,
    /// Lines per language, most first (all languages for a folder, one for a file).
    pub languages: Vec<(String, u64)>,
    pub commits: u64,
    /// Highest importer percentile below this tile, 0 to 100.
    pub dependents: u32,
    pub findings: SeverityCounts,
    /// A single main author for most of the commits (files only).
    pub single_owner: bool,
    pub tests: usize,
}

/// Every file of the repository at once, for the whole-project map.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapFiles {
    pub rows: Vec<FileRow>,
    /// Every language, most lines first, as in [`MapLevel::language_ranks`].
    pub language_ranks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapLevel {
    pub path: String,
    pub tiles: Vec<Tile>,
    /// Tiles merged into the last one because the level had too many.
    pub merged: usize,
    /// Every language of the repository, most lines first, so a language keeps its colour
    /// whatever the level.
    pub language_ranks: Vec<String>,
    /// Highest commit count of any tile at this level, for the ramp.
    pub max_commits: u64,
    pub total: Tile,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesQuery {
    /// Only files under this folder.
    pub path: Option<String>,
    pub language: Option<String>,
    pub text: Option<String>,
    pub has_findings: Option<bool>,
    /// Changed within this many days of the latest commit.
    pub changed_within_days: Option<u32>,
    pub tests: Option<bool>,
    /// `path`, `lines`, `commits`, `importers` or `findings`.
    pub sort: Option<String>,
    pub descending: Option<bool>,
    pub offset: Option<usize>,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRow {
    pub path: String,
    pub language: String,
    pub package: Option<String>,
    pub lines: u32,
    pub importers: usize,
    pub imports: usize,
    pub dependents: u32,
    pub commits: u32,
    pub lines_changed: u64,
    pub contributors: u32,
    pub owner: Option<String>,
    pub owner_share: Option<f64>,
    pub last_change: Option<i64>,
    pub findings: SeverityCounts,
    pub test: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesPage {
    pub rows: Vec<FileRow>,
    pub total: usize,
    pub offset: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFinding {
    pub id: String,
    pub rule: String,
    pub title: String,
    pub summary: String,
    pub rationale: String,
    pub severity: String,
    pub confidence: String,
    pub candidate: bool,
    pub interpretation: Option<String>,
    /// 1-based lines in this file, when known.
    pub lines: Vec<u32>,
    pub other_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Neighbour {
    pub path: String,
    pub weight: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoChanged {
    pub path: String,
    pub commits: u32,
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub name: String,
    pub commits: u32,
    pub share: f64,
}

/// Everything the drawer shows for one file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDetail {
    pub row: FileRow,
    pub groups: Vec<String>,
    pub importers: Vec<Neighbour>,
    pub imports: Vec<Neighbour>,
    /// Files reachable through importers within two hops.
    pub blast_radius: usize,
    pub findings: Vec<FileFinding>,
    pub authors: Vec<Author>,
    pub co_changed: Vec<CoChanged>,
    pub first_change: Option<i64>,
    /// The documentation page for the file.
    pub page: String,
}
