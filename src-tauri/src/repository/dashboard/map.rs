//! One level of the files map: the folders and files directly under a path, each aggregated over
//! everything below it.
use std::collections::BTreeMap;

use super::{
    super::{entry::Entry, error::RepositoryError},
    index::{add_counts, FileIndex, SINGLE_OWNER_SHARE},
    model::{FileRow, MapFiles, MapLevel, Tile},
};

/// Tiles drawn per level; the smallest beyond this are merged into one.
pub const MAX_TILES: usize = 300;

fn empty(path: &str, name: &str, folder: bool) -> Tile {
    Tile {
        path: path.to_owned(),
        name: name.to_owned(),
        folder,
        files: 0,
        lines: 0,
        languages: Vec::new(),
        commits: 0,
        dependents: 0,
        findings: Default::default(),
        single_owner: false,
        tests: 0,
    }
}

fn add(tile: &mut Tile, row: &FileRow, languages: &mut BTreeMap<String, u64>) {
    tile.files += 1;
    tile.lines += u64::from(row.lines);
    tile.commits += u64::from(row.commits);
    tile.dependents = tile.dependents.max(row.dependents);
    add_counts(&mut tile.findings, &row.findings);
    tile.tests += usize::from(row.test);
    *languages.entry(row.language.clone()).or_default() += u64::from(row.lines);
}

fn finish(tile: &mut Tile, languages: BTreeMap<String, u64>) {
    let mut list: Vec<(String, u64)> = languages.into_iter().collect();
    list.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    tile.languages = list;
}

/// `path` normalised: no leading or trailing slash, `.` and empty mean the root.
fn normalise(path: &str) -> String {
    let trimmed = path.trim_matches('/');
    if trimmed == "." {
        String::new()
    } else {
        trimmed.to_owned()
    }
}

pub fn level(index: &FileIndex, path: &str) -> Result<MapLevel, RepositoryError> {
    let base = normalise(path);
    let prefix = if base.is_empty() {
        String::new()
    } else {
        format!("{base}/")
    };
    let mut tiles: BTreeMap<String, (Tile, BTreeMap<String, u64>)> = BTreeMap::new();
    let mut total = (
        empty(&base, base.rsplit('/').next().unwrap_or(""), true),
        BTreeMap::new(),
    );
    for row in index.rows.iter().filter(|r| r.path.starts_with(&prefix)) {
        let rest = &row.path[prefix.len()..];
        let (name, folder) = match rest.split_once('/') {
            Some((head, _)) => (head, true),
            None => (rest, false),
        };
        let child = format!("{prefix}{name}");
        let entry = tiles
            .entry(child.clone())
            .or_insert_with(|| (empty(&child, name, folder), BTreeMap::new()));
        add(&mut entry.0, row, &mut entry.1);
        if !folder {
            entry.0.single_owner =
                row.owner_share.is_some_and(|s| s >= SINGLE_OWNER_SHARE) && row.commits >= 3;
        }
        add(&mut total.0, row, &mut total.1);
    }
    if tiles.is_empty() && !base.is_empty() {
        return Err(RepositoryError::new(
            "not_found",
            format!("no indexed files under {base}"),
        ));
    }
    let mut tiles: Vec<Tile> = tiles
        .into_values()
        .map(|(mut tile, languages)| {
            finish(&mut tile, languages);
            tile
        })
        .collect();
    tiles.sort_by(|a, b| b.lines.cmp(&a.lines).then(a.path.cmp(&b.path)));
    let mut merged = 0;
    if tiles.len() > MAX_TILES {
        let rest = tiles.split_off(MAX_TILES - 1);
        merged = rest.len();
        let mut other = empty(&format!("{prefix}…"), &format!("{merged} more"), false);
        let mut languages = BTreeMap::new();
        for tile in rest {
            other.files += tile.files;
            other.lines += tile.lines;
            other.commits += tile.commits;
            other.dependents = other.dependents.max(tile.dependents);
            other.tests += tile.tests;
            add_counts(&mut other.findings, &tile.findings);
            for (language, lines) in tile.languages {
                *languages.entry(language).or_default() += lines;
            }
        }
        finish(&mut other, languages);
        tiles.push(other);
    }
    let max_commits = tiles.iter().map(|t| t.commits).max().unwrap_or(0);
    finish(&mut total.0, total.1);
    Ok(MapLevel {
        path: base,
        tiles,
        merged,
        language_ranks: index
            .language_ranks()
            .into_iter()
            .map(|(l, ..)| l)
            .collect(),
        max_commits,
        total: total.0,
    })
}

impl Entry {
    pub fn dashboard_map(&self, path: &str) -> Result<MapLevel, RepositoryError> {
        let index = self.file_index()?;
        level(&index, path)
    }

    pub fn dashboard_all_files(&self) -> Result<MapFiles, RepositoryError> {
        let index = self.file_index()?;
        let language_ranks = index
            .language_ranks()
            .into_iter()
            .map(|(l, _, _)| l)
            .collect();
        Ok(MapFiles {
            rows: index.rows,
            language_ranks,
        })
    }

    pub(super) fn file_index(&self) -> Result<FileIndex, RepositoryError> {
        let snapshot = self.snapshot()?;
        let git = self.git.current();
        let findings = self.findings.current();
        Ok(FileIndex::build(
            self.graph.as_ref(),
            &snapshot,
            git.as_deref(),
            findings.as_deref(),
            &self.line_counts,
        ))
    }
}
