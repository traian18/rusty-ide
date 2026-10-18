//! `repo_risk`: what history and structure say about touching files. Per file: hotspot, bug-fix
//! record, owner, co-change partners, dependents, health and tests. With `changed_files` it leads
//! with a directive for the change as a whole: what may break, partners missing from the change,
//! tests to run, and how far the change reaches.
use std::collections::{BTreeMap, BTreeSet};

use harness_repository_wiki::{
    facts::{path_text, Facts},
    tests_of::is_test_file,
};
use harness_workspace::repository_intelligence::{RepositorySnapshot, RootRelativePath};
use serde_json::{json, Value};

use super::{
    super::{entry::Entry, error::RepositoryError, health::analyse::Analysis},
    envelope::{next, stale_files, Args, Envelope},
};

const KNOWN: [&str; 3] = ["targets", "changed_files", "budget"];
const MAX_FILES: usize = 12;
const LISTED: usize = 15;
const PARTNERS: usize = 5;
/// Commits together before a partner missing from a change is worth naming.
const MISSING_PARTNER_COMMITS: u32 = 3;

struct Graph<'a> {
    facts: Facts<'a>,
    by_text: BTreeMap<String, &'a RootRelativePath>,
}

impl<'a> Graph<'a> {
    fn new(snapshot: &'a RepositorySnapshot) -> Self {
        let by_text = snapshot
            .imports
            .files
            .iter()
            .map(|f| (path_text(&f.path), &f.path))
            .collect();
        Self {
            facts: Facts::new(snapshot),
            by_text,
        }
    }

    fn dependents(&self, path: &str) -> Vec<String> {
        self.by_text
            .get(path)
            .map(|p| {
                self.facts
                    .dependent_files(p)
                    .into_iter()
                    .map(|(d, _)| path_text(&d))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Files that import any of `paths`, within `hops`, not counting `paths` themselves.
    fn reach(&self, paths: &BTreeSet<String>, hops: usize) -> BTreeSet<String> {
        let mut seen = paths.clone();
        let mut frontier: Vec<String> = paths.iter().cloned().collect();
        let mut out = BTreeSet::new();
        for _ in 0..hops {
            let mut next = Vec::new();
            for path in &frontier {
                for dependent in self.dependents(path) {
                    if seen.insert(dependent.clone()) {
                        out.insert(dependent.clone());
                        next.push(dependent);
                    }
                }
            }
            frontier = next;
        }
        out
    }

    /// Test files that import `path` within two hops, and test files named after it.
    fn tests_for(&self, path: &str) -> BTreeSet<String> {
        let one = BTreeSet::from([path.to_owned()]);
        let mut tests: BTreeSet<String> = self
            .reach(&one, 2)
            .into_iter()
            .filter(|p| is_test_file(std::path::Path::new(p)))
            .collect();
        let stem = bare_stem(path);
        if stem.len() >= 3 && !["mod", "index", "lib", "main"].contains(&stem.as_str()) {
            tests.extend(
                self.by_text
                    .keys()
                    .filter(|p| {
                        is_test_file(std::path::Path::new(p.as_str())) && bare_stem(p) == stem
                    })
                    .cloned(),
            );
        }
        tests
    }
}

/// A file's name without extension and without test markers (`a.test`, `a_test`, `test_a`, `a.spec`).
fn bare_stem(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path).to_lowercase();
    let stem = name.split('.').next().unwrap_or(&name);
    let stem = stem.strip_prefix("test_").unwrap_or(stem);
    let stem = stem
        .strip_suffix("_test")
        .or_else(|| stem.strip_suffix("_tests"))
        .unwrap_or(stem);
    stem.to_owned()
}

fn reach_band(files: usize) -> &'static str {
    match files {
        0..=4 => "localized",
        5..=24 => "moderate",
        _ => "broad",
    }
}

fn file_card(entry: &Entry, graph: &Graph<'_>, analysis: &Analysis, path: &str) -> Value {
    let Ok(detail) = entry.dashboard_file(path) else {
        return json!({"path": path, "resolved": false, "reason": "not in the index: a new file, a path typo, or a file type the index does not read"});
    };
    let health = analysis.files.iter().find(|f| f.path == path);
    let signals = health.and_then(|f| f.signals.as_ref());
    let linked: BTreeSet<&str> = detail
        .importers
        .iter()
        .chain(&detail.imports)
        .map(|n| n.path.as_str())
        .collect();
    let partners: Vec<Value> = detail
        .co_changed
        .iter()
        .take(PARTNERS)
        .map(|c| json!({"path": c.path, "commits_together": c.commits, "import_link": linked.contains(c.path.as_str())}))
        .collect();
    let dependents = graph.dependents(path);
    let score = health.and_then(|f| f.score.as_ref());
    let top_issue = health.and_then(|f| {
        let score = f.score.as_ref()?;
        f.findings
            .iter()
            .max_by(|a, b| {
                let ia = score.impacts.get(&a.id).copied().unwrap_or(0.0);
                let ib = score.impacts.get(&b.id).copied().unwrap_or(0.0);
                ia.total_cmp(&ib)
            })
            .map(|f| f.reason.clone())
    });
    let tests: Vec<String> = graph.tests_for(path).into_iter().take(8).collect();
    json!({
        "path": path,
        "resolved": true,
        "hotspot": signals.is_some_and(|s| s.hotspot),
        "commits": detail.row.commits,
        "fix_commits": signals.map(|s| s.fix_commits),
        "owner": detail.row.owner,
        "owner_share": detail.row.owner_share.map(|s| (s * 100.0).round() / 100.0),
        "contributors": detail.row.contributors,
        "dependents": dependents.len(),
        "reach_two_hops": detail.blast_radius,
        "co_change_partners": partners,
        "health": score.map(|s| json!({"score": (s.defect.score * 10.0).round() / 10.0, "band": harness_code_health::Band::of(s.defect.score), "top_issue": top_issue})),
        "tests": tests,
        "test_file": detail.row.test,
    })
}

fn directive(entry: &Entry, graph: &Graph<'_>, changed: &[String]) -> Value {
    let set: BTreeSet<String> = changed.iter().cloned().collect();
    let direct = graph.reach(&set, 1);
    let two = graph.reach(&set, 2);
    let mut missing: BTreeMap<String, (u32, String)> = BTreeMap::new();
    for path in changed {
        if let Ok(detail) = entry.dashboard_file(path) {
            for partner in detail.co_changed {
                if partner.commits >= MISSING_PARTNER_COMMITS
                    && !set.contains(&partner.path)
                    && !is_test_file(std::path::Path::new(&partner.path))
                {
                    let slot = missing.entry(partner.path).or_insert((0, path.clone()));
                    if partner.commits > slot.0 {
                        *slot = (partner.commits, path.clone());
                    }
                }
            }
        }
    }
    let mut missing: Vec<(String, (u32, String))> = missing.into_iter().collect();
    missing.sort_by_key(|m| std::cmp::Reverse(m.1 .0));
    let tests: BTreeSet<String> = changed
        .iter()
        .flat_map(|p| graph.tests_for(p))
        .chain(
            set.iter()
                .filter(|p| is_test_file(std::path::Path::new(p.as_str())))
                .cloned(),
        )
        .collect();
    let may_break: Vec<&String> = direct
        .iter()
        .filter(|p| !is_test_file(std::path::Path::new(p.as_str())))
        .take(LISTED)
        .collect();
    json!({
        "may_break": may_break,
        "may_break_total": direct.len(),
        "reach": reach_band(two.len()),
        "reach_two_hops": two.len(),
        "missing_co_changes": missing.iter().take(LISTED).map(|(p, (n, with))| json!({"path": p, "changed_with": with, "commits_together": n})).collect::<Vec<_>>(),
        "tests_to_run": tests.iter().take(LISTED * 2).collect::<Vec<_>>(),
        "tests_total": tests.len(),
        "basis": "imports in the index (a floor: dynamic use is not seen) and Git co-change; not a prediction of runtime breakage",
    })
}

pub fn run(entry: &Entry, arguments: Value) -> Result<Value, RepositoryError> {
    let args = Args::new(arguments, &KNOWN)?;
    let budget = args.budget();
    let changed = args.strings("changed_files");
    let mut paths = args.strings("targets");
    for path in &changed {
        if !paths.contains(path) {
            paths.push(path.clone());
        }
    }
    if paths.is_empty() {
        return Err(RepositoryError::invalid(
            "name the files: targets, or changed_files for a change",
        ));
    }
    let snapshot = entry.snapshot()?;
    let graph = Graph::new(&snapshot);
    let analysis = entry.health_analysis()?;
    let cards: Vec<Value> = paths
        .iter()
        .take(MAX_FILES)
        .map(|p| file_card(entry, &graph, &analysis, p))
        .collect();
    let risky: Vec<&str> = cards
        .iter()
        .filter(|c| {
            c["hotspot"] == true
                || c["fix_commits"].as_u64().unwrap_or(0) >= 2
                || c["health"]["score"].as_f64().is_some_and(|s| s < 5.5)
        })
        .filter_map(|c| c["path"].as_str())
        .collect();
    let summary = if !changed.is_empty() {
        let d = directive(entry, &graph, &changed);
        let text = format!(
            "change of {} file(s): {} direct dependents, reach {}, {} test file(s) to run{}",
            changed.len(),
            d["may_break_total"],
            d["reach"].as_str().unwrap_or("unknown"),
            d["tests_total"],
            if risky.is_empty() {
                String::new()
            } else {
                format!("; handle with care: {}", risky.join(", "))
            }
        );
        (text, Some(d))
    } else {
        let text = if risky.is_empty() {
            format!(
                "{} file(s): no hotspot, repeated fixes or low health",
                cards.len()
            )
        } else {
            format!(
                "{} file(s); handle with care: {}",
                cards.len(),
                risky.join(", ")
            )
        };
        (text, None)
    };
    let mut envelope = Envelope::new("ok", summary.0)
        .section("directive", summary.1.unwrap_or(Value::Null))
        .section("files", json!(cards))
        .stale(stale_files(entry, &paths))
        .ignored(args.ignored());
    if paths.len() > MAX_FILES {
        envelope = envelope.truncated("files", paths.len(), "ask for the rest in another call");
    }
    if let Some(first) = risky.first() {
        envelope = envelope.next(next(
            "repo_health",
            json!({"targets": [first]}),
            "what pulls its health down, before editing",
        ));
    }
    envelope = envelope.next(next(
        "repo_context",
        json!({"mode": "blast_radius", "target": paths[0]}),
        "every dependent, by depth",
    ));
    Ok(envelope.into_output(budget))
}
