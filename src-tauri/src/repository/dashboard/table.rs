//! The files table under the map: filtered, sorted and paged on the host.
use super::{
    super::{entry::Entry, error::RepositoryError},
    index::FileIndex,
    model::{FileRow, FilesPage, FilesQuery},
};

const DEFAULT_LIMIT: usize = 100;
const MAX_LIMIT: usize = 500;
const DAY: i64 = 86_400;

fn findings_total(row: &FileRow) -> usize {
    row.findings.high + row.findings.medium + row.findings.low + row.findings.info
}

pub fn query(index: FileIndex, query: &FilesQuery) -> Result<FilesPage, RepositoryError> {
    let prefix = query
        .path
        .as_deref()
        .map(|p| p.trim_matches('/'))
        .filter(|p| !p.is_empty() && *p != ".")
        .map(|p| format!("{p}/"));
    let text = query
        .text
        .as_deref()
        .map(str::to_lowercase)
        .filter(|t| !t.is_empty());
    let since = query
        .changed_within_days
        .zip(index.latest_change)
        .map(|(days, latest)| latest - i64::from(days) * DAY);
    let mut rows: Vec<FileRow> = index
        .rows
        .into_iter()
        .filter(|r| {
            prefix
                .as_ref()
                .is_none_or(|p| r.path.starts_with(p.as_str()))
        })
        .filter(|r| query.language.as_ref().is_none_or(|l| &r.language == l))
        .filter(|r| {
            text.as_ref()
                .is_none_or(|t| r.path.to_lowercase().contains(t.as_str()))
        })
        .filter(|r| {
            query
                .has_findings
                .is_none_or(|want| (findings_total(r) > 0) == want)
        })
        .filter(|r| query.tests.is_none_or(|want| r.test == want))
        .filter(|r| since.is_none_or(|s| r.last_change.is_some_and(|t| t >= s)))
        .collect();
    let descending = query.descending.unwrap_or(true);
    match query.sort.as_deref().unwrap_or("lines") {
        "path" => rows.sort_by(|a, b| a.path.cmp(&b.path)),
        "lines" => rows.sort_by(|a, b| a.lines.cmp(&b.lines).then(b.path.cmp(&a.path))),
        "commits" => rows.sort_by(|a, b| a.commits.cmp(&b.commits).then(b.path.cmp(&a.path))),
        "importers" => rows.sort_by(|a, b| a.importers.cmp(&b.importers).then(b.path.cmp(&a.path))),
        "findings" => rows.sort_by(|a, b| {
            (a.findings.high, a.findings.medium, findings_total(a))
                .cmp(&(b.findings.high, b.findings.medium, findings_total(b)))
                .then(b.path.cmp(&a.path))
        }),
        other => return Err(RepositoryError::invalid(format!("unknown sort `{other}`"))),
    }
    let path_sort = query.sort.as_deref() == Some("path");
    if descending != path_sort {
        // Numeric sorts read largest first by default; path sorts read A to Z.
        rows.reverse();
    }
    let total = rows.len();
    let offset = query.offset.unwrap_or(0).min(total);
    let limit = query.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let rows = rows.into_iter().skip(offset).take(limit).collect();
    Ok(FilesPage {
        rows,
        total,
        offset,
    })
}

impl Entry {
    pub fn dashboard_files(&self, request: &FilesQuery) -> Result<FilesPage, RepositoryError> {
        query(self.file_index()?, request)
    }
}
