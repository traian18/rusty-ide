use harness_code_health::rollup::TARGET_SCORE;

use super::{
    super::{entry::Entry, error::RepositoryError},
    model::{FunctionRow, HealthFileDetail, ScoredFinding},
    report::row,
};

const FUNCTIONS: usize = 10;

impl Entry {
    /// One file for the health drawer.
    pub fn code_health_file(&self, path: &str) -> Result<HealthFileDetail, RepositoryError> {
        let analysis = self.health_analysis()?;
        let file = analysis
            .files
            .iter()
            .find(|f| f.path == path)
            .ok_or_else(|| RepositoryError::new("not_found", format!("{path} is not indexed")))?;
        let mut findings: Vec<ScoredFinding> = file
            .findings
            .iter()
            .map(|finding| ScoredFinding {
                impact: file
                    .score
                    .as_ref()
                    .and_then(|s| s.impacts.get(&finding.id).copied())
                    .unwrap_or(0.0),
                finding: finding.clone(),
            })
            .collect();
        findings.sort_by(|a, b| {
            b.impact
                .total_cmp(&a.impact)
                .then(b.finding.severity.cmp(&a.finding.severity))
                .then(a.finding.start_line.cmp(&b.finding.start_line))
        });
        let mut functions: Vec<FunctionRow> = file
            .metrics
            .as_ref()
            .map(|m| {
                m.functions
                    .iter()
                    .map(|f| FunctionRow {
                        name: f.qualified_name.clone(),
                        start_line: f.start_line,
                        end_line: f.end_line,
                        nloc: f.nloc,
                        ccn: f.ccn,
                        cognitive: f.cognitive,
                        max_nesting: f.max_nesting,
                        params: f.params,
                    })
                    .collect()
            })
            .unwrap_or_default();
        functions.sort_by(|a, b| {
            b.ccn
                .cmp(&a.ccn)
                .then(b.nloc.cmp(&a.nloc))
                .then(a.start_line.cmp(&b.start_line))
        });
        functions.truncate(FUNCTIONS);
        Ok(HealthFileDetail {
            row: row(file),
            findings,
            defect_categories: file
                .score
                .as_ref()
                .map(|s| s.defect.categories.clone())
                .unwrap_or_default(),
            maintainability_categories: file
                .score
                .as_ref()
                .map(|s| s.maintainability.categories.clone())
                .unwrap_or_default(),
            unclamped: file.score.as_ref().map(|s| s.defect.unclamped),
            functions,
            importers: file.importers,
            signals: file.signals.clone(),
            target: TARGET_SCORE,
        })
    }
}
