//! The score trend: a point recorded after every analysis, and points rebuilt from past commits
//! on request. Maintainability is the measure that compares across them (see
//! `harness_code_health::trend`).
use std::{
    collections::HashMap,
    path::Path,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use harness_code_analysis::metrics::{measure_file, FileMetrics, METRICS_VERSION};
use harness_code_health::{
    detect_file,
    duplication::DuplicateIndex,
    score_file,
    trend::{direction, file_scores, PointMeta, TrendPoint, TrendSeries},
    DetectorConfig, FileContext, Finding,
};
use harness_repository_wiki::tests_of::is_test_file;
use serde::Serialize;
use tokio_util::sync::CancellationToken;

use super::{
    super::{entry::Entry, error::RepositoryError},
    analyse::{language_id, Analysis},
    report::file_health,
};

/// A new recorded point within this long of the previous one replaces it.
const MERGE_WINDOW_MS: u64 = 10 * 60 * 1000;
/// Largest file measured when rebuilding history.
const MAX_BYTES: usize = 2 * 1024 * 1024;
/// Commits looked at when choosing where to sample, and how far back.
const MAX_WALK: usize = 20_000;
const HORIZON_MS: u64 = 730 * 24 * 60 * 60 * 1000;
const DAY_MS: u64 = 24 * 60 * 60 * 1000;
const SKIPPED: [&str; 6] = ["node_modules", "vendor", "target", "dist", "build", ".git"];

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn digest(detectors: &DetectorConfig) -> String {
    let scoring = harness_infra_analysis::scoring_config();
    format!("{}{}", &detectors.digest()[..8], &scoring.digest()[..8])
}

/// What the page and the agent tool receive.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendView {
    pub points: Vec<TrendPoint>,
    /// `improving`, `declining`, `steady` or `unknown`, from maintainability across the points.
    pub direction: &'static str,
    /// Maintainability change since the previous point and since about 30 days before the latest.
    pub change_since_previous: Option<f64>,
    pub change_30_days: Option<f64>,
    /// Points rebuilt from Git are marked, so the page can say so.
    pub backfilled: usize,
}

impl Entry {
    /// Records a point for `analysis` (identified by `key`), unless this analysis was recorded.
    pub(in crate::repository) fn record_trend(&self, analysis: &Analysis, key: &str) {
        if !self.health.should_record(key) {
            return;
        }
        let code: Vec<&super::analyse::FileAnalysis> = analysis
            .files
            .iter()
            .filter(|f| f.metrics.is_some())
            .collect();
        if code.is_empty() {
            return;
        }
        let health: Vec<_> = code.iter().map(|f| file_health(f)).collect();
        let point = TrendPoint::from_files(
            &health,
            code.iter().flat_map(|f| f.findings.iter()),
            PointMeta {
                at_ms: now_ms(),
                commit: Some(key.to_owned()),
                backfilled: false,
                digest: digest(&analysis.detectors),
            },
        );
        let scores = file_scores(&health);
        self.health.update_trend(|series| {
            // Several analyses in a short while are one point, not a stream of them.
            if let Some(last) = series
                .points
                .iter()
                .rposition(|p| !p.backfilled)
                .filter(|i| point.at_ms.saturating_sub(series.points[*i].at_ms) < MERGE_WINDOW_MS)
            {
                series.points.remove(last);
            }
            series.push(point, Some(&scores));
        });
        if let Some(storage) = &self.storage {
            self.health.save_trend(&storage.trend_path());
        }
    }

    pub fn code_health_trend(&self) -> Result<TrendView, RepositoryError> {
        let analysis = self.health_analysis()?;
        self.record_trend(&analysis, &self.trend_key());
        Ok(view(&self.health.trend()))
    }

    pub(in crate::repository) fn trend_key(&self) -> String {
        let snapshot = self.snapshot().map(|s| s.id.0.clone()).unwrap_or_default();
        let git = self
            .git
            .current()
            .map(|g| g.id.0.clone())
            .unwrap_or_default();
        format!("{git}:{snapshot}")
    }

    /// Re-scores up to `points` past commits, evenly spaced over the last two years, straight
    /// from Git objects (nothing is checked out), and adds them to the trend. Returns how many
    /// were added.
    pub(in crate::repository) fn build_history(
        &self,
        points: usize,
        token: &CancellationToken,
        progress: &dyn Fn(u32, u32, &str),
    ) -> Result<usize, RepositoryError> {
        let repo = git2::Repository::open(self.root())
            .map_err(|e| RepositoryError::new("git", e.to_string()))?;
        let head = repo
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|e| RepositoryError::new("git", e.to_string()))?;
        let mut walk = repo
            .revwalk()
            .map_err(|e| RepositoryError::new("git", e.to_string()))?;
        walk.push(head.id())
            .map_err(|e| RepositoryError::new("git", e.to_string()))?;
        let _ = walk.simplify_first_parent();
        let cutoff = now_ms().saturating_sub(HORIZON_MS);
        let mut commits: Vec<(git2::Oid, u64)> = Vec::new();
        for oid in walk.flatten().take(MAX_WALK) {
            let Ok(commit) = repo.find_commit(oid) else {
                continue;
            };
            let at = (commit.time().seconds().max(0) as u64) * 1000;
            if at < cutoff {
                break;
            }
            commits.push((oid, at));
        }
        // Skip the newest commit: the recorded point already describes it.
        if !commits.is_empty() {
            commits.remove(0);
        }
        let known: Vec<String> = self
            .health
            .trend()
            .commits(true)
            .into_iter()
            .map(str::to_owned)
            .collect();
        let chosen = sample(&commits, points);
        let detectors = super::super::guidelines::detectors(&self.root);
        let scoring = harness_infra_analysis::scoring_config();
        let digest = digest(&detectors);
        let mut cache: HashMap<(git2::Oid, &'static str), Option<Arc<FileMetrics>>> =
            HashMap::new();
        let mut added = 0;
        let total = chosen.len() as u32;
        for (done, (oid, at)) in chosen.into_iter().enumerate() {
            if token.is_cancelled() {
                break;
            }
            if known.iter().any(|k| *k == oid.to_string()) {
                continue;
            }
            progress(done as u32, total, &oid.to_string()[..8]);
            let Ok(commit) = repo.find_commit(oid) else {
                continue;
            };
            let Ok(tree) = commit.tree() else {
                continue;
            };
            let mut files: Vec<(String, Arc<FileMetrics>, bool)> = Vec::new();
            let _ = tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
                if entry.kind() != Some(git2::ObjectType::Blob) {
                    return git2::TreeWalkResult::Ok;
                }
                let Ok(name) = entry.name() else {
                    return git2::TreeWalkResult::Ok;
                };
                let path = format!("{dir}{name}");
                if path.split('/').any(|part| SKIPPED.contains(&part)) {
                    return git2::TreeWalkResult::Ok;
                }
                let Some(id) = language_id(&path) else {
                    return git2::TreeWalkResult::Ok;
                };
                let language: &'static str = leak(&format!("{id:?}"));
                let measured = cache
                    .entry((entry.id(), language))
                    .or_insert_with(|| {
                        let blob = repo.find_blob(entry.id()).ok()?;
                        if blob.size() > MAX_BYTES {
                            return None;
                        }
                        measure_file(&id, &path, blob.content()).ok().map(Arc::new)
                    })
                    .clone();
                if let Some(metrics) = measured {
                    let test = is_test_file(Path::new(&path));
                    files.push((path, metrics, test));
                }
                git2::TreeWalkResult::Ok
            });
            if files.is_empty() {
                continue;
            }
            let duplicates = DuplicateIndex::build(
                files.iter().map(|(p, m, t)| (p.as_str(), m.as_ref(), *t)),
                &detectors.duplicated_code,
            );
            let mut health = Vec::new();
            let mut findings: Vec<Finding> = Vec::new();
            for (path, metrics, test) in &files {
                let context = FileContext::new(path, metrics)
                    .with_test(*test)
                    .with_duplicates(duplicates.duplicates_in(path));
                let found = detect_file(&context, &detectors);
                let score = score_file(&found, &scoring);
                health.push(harness_code_health::rollup::FileHealth {
                    path: path.clone(),
                    nloc: metrics.nloc,
                    test: *test,
                    hotspot: false,
                    score: Some(score),
                    fix_commits: None,
                });
                findings.extend(found);
            }
            let point = TrendPoint::from_files(
                &health,
                findings.iter(),
                PointMeta {
                    at_ms: at,
                    commit: Some(oid.to_string()),
                    backfilled: true,
                    digest: digest.clone(),
                },
            );
            self.health.update_trend(|series| series.push(point, None));
            added += 1;
        }
        if let Some(storage) = &self.storage {
            self.health.save_trend(&storage.trend_path());
        }
        let _ = METRICS_VERSION;
        Ok(added)
    }
}

/// A language name that lives as long as the program, for use as a cache key part.
fn leak(name: &str) -> &'static str {
    use std::sync::{Mutex, OnceLock};
    static NAMES: OnceLock<Mutex<Vec<&'static str>>> = OnceLock::new();
    let mut names = NAMES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(found) = names.iter().find(|n| **n == name) {
        return found;
    }
    let leaked: &'static str = Box::leak(name.to_owned().into_boxed_str());
    names.push(leaked);
    leaked
}

/// Up to `count` entries spread evenly across `commits` (newest first), oldest included.
fn sample(commits: &[(git2::Oid, u64)], count: usize) -> Vec<(git2::Oid, u64)> {
    if commits.len() <= count {
        return commits.to_vec();
    }
    let mut out = Vec::new();
    for i in 0..count {
        let index = i * (commits.len() - 1) / (count - 1).max(1);
        out.push(commits[index]);
    }
    out.dedup_by_key(|(oid, _)| *oid);
    out
}

fn view(series: &TrendSeries) -> TrendView {
    let points = series.points.clone();
    let latest = points.last().and_then(|p| p.maintainability);
    let previous = points
        .len()
        .checked_sub(2)
        .and_then(|i| points.get(i))
        .and_then(|p| p.maintainability);
    let month = series.before(30 * DAY_MS).and_then(|p| p.maintainability);
    let change = |from: Option<f64>| match (latest, from) {
        (Some(now), Some(then)) => Some(((now - then) * 100.0).round() / 100.0),
        _ => None,
    };
    TrendView {
        direction: direction(&points, 0.1),
        change_since_previous: change(previous),
        change_30_days: change(month),
        backfilled: points.iter().filter(|p| p.backfilled).count(),
        points,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn oid(n: u8) -> git2::Oid {
        git2::Oid::from_bytes(&[n; 20]).unwrap()
    }

    fn commit(repo: &git2::Repository, message: &str, days_ago: i64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let when = git2::Time::new(now - days_ago * 86_400, 0);
        let sig = git2::Signature::new("t", "t@example.com", &when).unwrap();
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let tree = repo.find_tree(index.write_tree().unwrap()).unwrap();
        let parent = repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let parents: Vec<&git2::Commit> = parent.iter().collect();
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
            .unwrap();
    }

    const CLEAN: &str = "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";
    const MESSY: &str = "fn tangled(x: i32) -> i32 {\n    let mut t = 0;\n    if x > 0 { if x > 1 { if x > 2 { if x > 3 { if x > 4 { t += 1; } } } } }\n    for i in 0..x { for j in 0..i { for k in 0..j { if k > 1 { t += k; } } } }\n    match x { 1 => t += 1, 2 => t += 2, 3 => t += 3, 4 => t += 4, 5 => t += 5, _ => {} }\n    let _ = std::fs::read(\"a\");\n    t\n}\n";

    #[test]
    fn history_is_rebuilt_from_git_objects_and_ordered_in_time() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        std::fs::create_dir_all(dir.path().join("src")).unwrap();
        let file = dir.path().join("src/lib.rs");
        std::fs::write(&file, CLEAN).unwrap();
        commit(&repo, "one", 300);
        std::fs::write(&file, format!("{CLEAN}{MESSY}")).unwrap();
        commit(&repo, "two", 200);
        std::fs::write(&file, format!("{CLEAN}{MESSY}\n// more\n")).unwrap();
        commit(&repo, "three", 100);
        std::fs::write(&file, CLEAN).unwrap();
        commit(&repo, "four", 1);

        let entry = Entry::new(dir.path()).unwrap();
        let added = entry
            .build_history(5, &CancellationToken::new(), &|_, _, _| {})
            .unwrap();
        // The newest commit is left to the recorded point.
        assert_eq!(added, 3);
        let trend = entry.health.trend();
        assert!(trend.points.iter().all(|p| p.backfilled));
        let times: Vec<u64> = trend.points.iter().map(|p| p.at_ms).collect();
        assert!(times.windows(2).all(|w| w[0] < w[1]));
        let maintainability: Vec<f64> = trend
            .points
            .iter()
            .filter_map(|p| p.maintainability)
            .collect();
        assert_eq!(maintainability.len(), 3);
        // Clean, then messy, then messy: the messy commits score lower than the clean one.
        assert!(
            maintainability[1] < maintainability[0],
            "{maintainability:?}"
        );
        assert!(trend.points[1].findings > trend.points[0].findings);
        // Running again adds nothing.
        let again = entry
            .build_history(5, &CancellationToken::new(), &|_, _, _| {})
            .unwrap();
        assert_eq!(again, 0);
        // A cancelled build adds nothing.
        let token = CancellationToken::new();
        token.cancel();
        assert_eq!(entry.build_history(5, &token, &|_, _, _| {}).unwrap(), 0);
    }

    #[test]
    fn sampling_spreads_points_and_keeps_the_oldest() {
        let commits: Vec<_> = (1..=100u8).map(|n| (oid(n), u64::from(n))).collect();
        let picked = sample(&commits, 5);
        assert_eq!(picked.len(), 5);
        assert_eq!(picked.first().unwrap().1, 1);
        assert_eq!(picked.last().unwrap().1, 100);
        assert_eq!(sample(&commits[..3], 5).len(), 3);
    }
}
