//! `repo_overview`: what an agent should know before working in an unfamiliar repository, in one
//! call: the written overview (when documentation was written), the packages and the heaviest
//! dependencies between them, entry points and the most depended-on files, code health, the Git
//! picture, and where to start reading.
use std::collections::HashMap;

use harness_repository_wiki::written::{
    ACTIVE_LANDSCAPE, ARCHITECTURE, GETTING_STARTED, GLOSSARY, HOW_IT_WORKS, KEY_CONCEPTS, OVERVIEW,
};
use serde_json::{json, Value};

use super::{
    super::{
        dto::{LevelName, LevelRequest},
        entry::Entry,
        error::RepositoryError,
        written::{store_path, WrittenView},
    },
    envelope::{next, Args, Envelope},
};

const KNOWN: [&str; 2] = ["include", "budget"];
const INCLUDES: [&str; 3] = ["outline", "glossary", "landscape"];
const DEFAULT_BUDGET: usize = 6_000;
const OVERVIEW_CHARS: usize = 2_500;
const START_CHARS: usize = 1_200;
const EXTRA_CHARS: usize = 3_000;
const PACKAGES: usize = 12;
const EDGES: usize = 10;
/// Files listed with entry points, labels shown per file, and most depended-on files.
const ENTRY_FILES: usize = 8;
const SAMPLE: usize = 5;
const HUBS: usize = 8;

/// Markdown cut to about `chars` at a paragraph boundary, without diagram markers.
fn excerpt(markdown: &str, chars: usize) -> String {
    let clean: String = markdown
        .lines()
        .filter(|l| !l.trim_start().starts_with("@@diagram"))
        .collect::<Vec<_>>()
        .join("\n");
    if clean.len() <= chars {
        return clean;
    }
    let mut end = chars;
    while !clean.is_char_boundary(end) {
        end -= 1;
    }
    let cut = clean[..end].rfind("\n\n").unwrap_or(end);
    format!("{}\n…", &clean[..cut])
}

fn written(entry: &Entry, id: &str) -> Option<WrittenView> {
    let data = entry.storage.as_ref()?.app_data_dir()?;
    entry
        .documentation_page(&store_path(data, entry.root()), id)
        .ok()
        .flatten()
}

fn freshness(view: &WrittenView) -> String {
    format!("{:?}", view.freshness).to_lowercase()
}

fn packages(entry: &Entry) -> Value {
    let Ok(level) = entry.architecture_level(LevelRequest {
        level: LevelName::Packages,
        focus: None,
        import_kind: None,
        node_limit: Some(PACKAGES),
        edge_limit: Some(60),
    }) else {
        return Value::Null;
    };
    let labels: HashMap<&str, &str> = level
        .nodes
        .iter()
        .map(|n| (n.id.as_str(), n.label.as_str()))
        .collect();
    let mut nodes = level.nodes.clone();
    nodes.sort_by_key(|n| std::cmp::Reverse(n.file_count));
    let mut edges = level.edges.clone();
    edges.sort_by_key(|e| std::cmp::Reverse(e.runtime + e.type_only));
    json!({
        "kind": format!("{:?}", level.unit_kind).to_lowercase(),
        "packages": nodes.iter().take(PACKAGES).map(|n| {
            let mut languages: Vec<(&String, &usize)> = n.languages.iter().collect();
            languages.sort_by(|a, b| b.1.cmp(a.1));
            json!({"name": n.label, "files": n.file_count, "languages": languages.iter().take(3).map(|(l, _)| l).collect::<Vec<_>>(), "what": n.explanation})
        }).collect::<Vec<_>>(),
        "packages_total": level.total_nodes,
        "heaviest_dependencies": edges.iter().take(EDGES).map(|e| json!({
            "from": labels.get(e.from.as_str()).copied().unwrap_or(&e.from),
            "to": labels.get(e.to.as_str()).copied().unwrap_or(&e.to),
            "imports": e.runtime + e.type_only,
            "in_cycle": e.in_cycle,
        })).collect::<Vec<_>>(),
    })
}

fn health(entry: &Entry) -> Value {
    let Ok(report) = entry.code_health() else {
        return Value::Null;
    };
    let r = &report.repository;
    json!({
        "score": r.average.map(|s| (s * 10.0).round() / 10.0),
        "band": r.band,
        "hotspot_health": r.hotspot_health.map(|s| (s * 10.0).round() / 10.0),
        "findings": report.findings,
        "worst_file": r.worst_file.as_ref().map(|w| json!({"path": w.path, "score": (w.score * 10.0).round() / 10.0})),
        "scored_files": r.file_count - r.unanalysed_count,
    })
}

fn git(entry: &Entry) -> Value {
    let Some(git) = entry.git.current() else {
        return Value::Null;
    };
    let s = &git.index.signal_summary;
    let mut hottest: Vec<_> = git.index.signals.iter().filter(|f| f.hotspot).collect();
    hottest.sort_by_key(|f| std::cmp::Reverse(f.decayed_churn_milli));
    json!({
        "active_contributors_recent": s.active_contributors_recent,
        "recent_days": s.recent_days,
        "hotspots": s.hotspots,
        "hottest_files": hottest.iter().take(5).map(|f| f.file.as_path().display().to_string()).collect::<Vec<_>>(),
        "fix_commits": s.fix_commits,
        "fix_window_days": s.fix_window_days,
    })
}

/// Entry points grouped by file and kind, so a file exposing hundreds of commands is one row.
fn entry_points(items: &[Value]) -> Value {
    let mut groups: Vec<(String, String, String, Vec<String>)> = Vec::new();
    for item in items {
        let file = item["file"].as_str().unwrap_or_default().to_owned();
        let framework = item["framework"].as_str().unwrap_or_default().to_owned();
        let kind = item["kind"].as_str().unwrap_or_default().to_owned();
        let label = item["label"].as_str().unwrap_or_default().to_owned();
        match groups.iter_mut().find(|g| g.0 == file && g.2 == kind) {
            Some(group) => group.3.push(label),
            None => groups.push((file, framework, kind, vec![label])),
        }
    }
    json!(groups
        .iter()
        .take(ENTRY_FILES)
        .map(|(file, framework, kind, labels)| json!({
            "file": file, "framework": framework, "kind": kind, "count": labels.len(),
            "sample": labels.iter().take(SAMPLE).collect::<Vec<_>>(),
        }))
        .collect::<Vec<_>>())
}

/// The orient answer's useful parts: entry points and the most depended-on files.
fn map_of(orient: Option<Value>) -> Value {
    let Some(sections) = orient.as_ref().map(|o| &o["result"]["sections"]) else {
        return Value::Null;
    };
    let mut out = serde_json::Map::new();
    if let Some(items) = sections.get("entry_points").and_then(Value::as_array) {
        out.insert("entry_points".into(), entry_points(items));
    }
    if let Some(items) = sections.get("most_depended_on").and_then(Value::as_array) {
        out.insert(
            "most_depended_on".into(),
            json!(items.iter().take(HUBS).collect::<Vec<_>>()),
        );
    }
    if let Some(languages) = sections.get("languages") {
        out.insert("languages".into(), languages.clone());
    }
    Value::Object(out)
}

pub fn run(
    entry: &Entry,
    arguments: Value,
    orient: Option<Value>,
) -> Result<Value, RepositoryError> {
    let mut args = Args::new(arguments, &KNOWN)?;
    let include = args.choices("include", &INCLUDES);
    let budget = args.number("budget", DEFAULT_BUDGET, 1_000, 24_000);
    let name = entry.root().file_name().map_or_else(
        || "repository".to_owned(),
        |n| n.to_string_lossy().into_owned(),
    );
    let overview = written(entry, OVERVIEW);
    let summary = match &overview {
        Some(view) => format!(
            "{name}: written overview ({}), packages, entry points, health and history",
            freshness(view)
        ),
        None => format!(
            "{name}: packages, entry points, health and history (no written documentation yet)"
        ),
    };
    let mut envelope = Envelope::new("ok", summary);
    if let Some(view) = &overview {
        envelope = envelope.section("overview", json!({"freshness": freshness(view), "text": excerpt(&view.page.markdown, OVERVIEW_CHARS)}));
    }
    envelope = envelope
        .section("structure", packages(entry))
        .section("map", map_of(orient))
        .section("code_health", health(entry))
        .section("history", git(entry));
    if let Some(view) = written(entry, GETTING_STARTED) {
        envelope = envelope.section(
            "start_here",
            json!(excerpt(&view.page.markdown, START_CHARS)),
        );
    }
    if include.iter().any(|i| i == "outline") {
        let pages: Vec<Value> = [
            OVERVIEW,
            GETTING_STARTED,
            KEY_CONCEPTS,
            HOW_IT_WORKS,
            ARCHITECTURE,
            ACTIVE_LANDSCAPE,
            GLOSSARY,
        ]
        .iter()
        .map(|id| match written(entry, id) {
            Some(view) => {
                json!({"id": id, "title": view.page.title, "freshness": freshness(&view)})
            }
            None => json!({"id": id, "written": false}),
        })
        .collect();
        envelope = envelope.section("outline", json!(pages));
    }
    for (key, id) in [("glossary", GLOSSARY), ("landscape", ACTIVE_LANDSCAPE)] {
        if include.iter().any(|i| i == key) {
            envelope = envelope.section(
                key,
                written(entry, id).map_or(json!("not written yet"), |v| {
                    json!(excerpt(&v.page.markdown, EXTRA_CHARS))
                }),
            );
        }
    }
    Ok(envelope
        .ignored(args.ignored())
        .next(next(
            "repo_context",
            json!({"mode": "orient", "target": ""}),
            "the folder map in detail",
        ))
        .next(next("repo_health", json!({}), "what to fix first"))
        .into_output(budget))
}
