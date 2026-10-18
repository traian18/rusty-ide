//! `repo_context` with the host's additions on top of the core tool: several targets in one call,
//! and for files the symbols they define (always the top ones; all with `include: ["symbols"]`),
//! a `skeleton` with the bodies elided, `health` measured from disk now, and `owners`.
use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::{
    super::{entry::Entry, error::RepositoryError, health::analyse::analyse_live},
    blocking,
    envelope::DEFAULT_BUDGET,
    health::{findings_of, round},
    source,
};

const CORE_INCLUDES: [&str; 4] = ["frameworks", "findings", "history", "tests"];
const HOST_INCLUDES: [&str; 4] = ["symbols", "skeleton", "health", "owners"];
const MAX_TARGETS: usize = 8;
const TOP_SYMBOLS: usize = 15;
const ALL_SYMBOLS: usize = 200;
const SKELETON_LINES: usize = 400;

fn extras(entry: &Entry, path: &str, wanted: &[String]) -> Map<String, Value> {
    let mut out = Map::new();
    if !entry.root().join(path).is_file() {
        if !wanted.is_empty() {
            out.insert(
                "note".into(),
                json!("symbols, skeleton, health and owners are given for files"),
            );
        }
        return out;
    }
    let has = |name: &str| wanted.iter().any(|w| w == name);
    if let Ok(file) = source::read(entry, path) {
        if file.metrics.is_some() {
            let limit = if has("symbols") {
                ALL_SYMBOLS
            } else {
                TOP_SYMBOLS
            };
            let (symbols, total) = file.symbols(limit);
            out.insert("symbols".into(), json!({"items": symbols, "total": total,
                "more": (total > symbols.len()).then_some("include symbols to list them all; repo_symbol path::Name reads one")}));
        }
        if has("skeleton") {
            let (text, cut) = file.skeleton(SKELETON_LINES);
            out.insert("skeleton".into(), json!({"text": text, "cut": cut,
                "how": "bodies are elided as `… lines a-b`; read one with repo_symbol path:a-b or path::Name"}));
        }
    }
    if has("health") {
        let value = entry
            .health_analysis()
            .ok()
            .and_then(|analysis| analyse_live(entry, &analysis, path))
            .map_or(json!("not measured for this language"), |live| {
                let score = live.score.as_ref().map(|s| round(s.defect.score));
                json!({"score_now": score, "band": score.map(harness_code_health::Band::of), "findings": findings_of(&live)})
            });
        out.insert("health".into(), value);
    }
    if has("owners") {
        if let Ok(detail) = entry.dashboard_file(path) {
            out.insert("owners".into(), json!({
                "main": detail.row.owner, "share": detail.row.owner_share.map(round),
                "contributors": detail.row.contributors,
                "authors": detail.authors.iter().take(5).map(|a| json!({"name": a.name, "commits": a.commits})).collect::<Vec<_>>(),
            }));
        }
    }
    out
}

/// One core call for `target`, with the host's sections added to its answer.
async fn one(
    entry: &Arc<Entry>,
    mut arguments: Map<String, Value>,
    target: Option<String>,
    wanted: Vec<String>,
    files: bool,
) -> Value {
    if let Some(target) = &target {
        arguments.insert("target".into(), json!(target));
    }
    let mut output = match entry
        .agent_tool("repo_context", Value::Object(arguments))
        .await
    {
        Ok(output) => output,
        Err(error) => {
            return json!({"result": {"status": "error", "summary": format!("{}: {}", error.code, error.message), "sections": {}, "next": []}})
        }
    };
    if let (true, Some(path)) = (files, target.filter(|t| !t.is_empty())) {
        let entry = entry.clone();
        let added = blocking(move || Ok(extras(&entry, &path, &wanted)))
            .await
            .unwrap_or_default();
        if let Some(sections) = output["result"]["sections"].as_object_mut() {
            sections.extend(added);
        }
    }
    output
}

pub async fn run(entry: Arc<Entry>, arguments: Value) -> Result<Value, RepositoryError> {
    let Value::Object(mut map) = arguments else {
        return Err(RepositoryError::invalid("arguments must be an object"));
    };
    let mut ignored = Vec::new();
    let mut core = Vec::new();
    let mut host = Vec::new();
    if let Some(include) = map.remove("include") {
        let values: Vec<String> = match include {
            Value::String(s) => vec![s],
            Value::Array(items) => items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            _ => Vec::new(),
        };
        for value in values {
            if CORE_INCLUDES.contains(&value.as_str()) {
                core.push(value);
            } else if HOST_INCLUDES.contains(&value.as_str()) {
                host.push(value);
            } else {
                let accepted: Vec<&str> = CORE_INCLUDES
                    .iter()
                    .chain(&HOST_INCLUDES)
                    .copied()
                    .collect();
                ignored.push(json!({"argument": "include", "value": value, "accepted": accepted}));
            }
        }
    }
    if !core.is_empty() {
        map.insert("include".into(), json!(core));
    }
    let mode = map
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("connections")
        .to_owned();
    let files = mode == "connections";
    let mut targets: Vec<String> = Vec::new();
    if mode != "changes" {
        if let Some(Value::Array(list)) = map.remove("targets") {
            targets = list
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect();
        }
        if let Some(target) = map.get("target").and_then(Value::as_str) {
            if !targets.iter().any(|t| t == target) {
                targets.insert(0, target.to_owned());
            }
        }
    }

    if targets.len() <= 1 {
        let mut output = one(&entry, map, targets.pop(), host, files).await;
        if !ignored.is_empty() {
            output["result"]["ignored"] = json!(ignored);
        }
        return Ok(output);
    }

    let budget = map
        .get("budget")
        .and_then(Value::as_u64)
        .map_or(DEFAULT_BUDGET, |b| b as usize);
    let shown = targets.len().min(MAX_TARGETS);
    map.insert("budget".into(), json!((budget / shown).max(1_000)));
    let mut sections = Map::new();
    let mut next = Vec::new();
    let mut lines = Vec::new();
    let mut stale = Vec::new();
    for target in targets.iter().take(MAX_TARGETS) {
        let output = one(
            &entry,
            map.clone(),
            Some(target.clone()),
            host.clone(),
            files,
        )
        .await;
        let result = &output["result"];
        lines.push(format!(
            "{target}: {}",
            result["summary"].as_str().unwrap_or("")
        ));
        if result["status"] == "stale" {
            stale.push(target.clone());
        }
        if let Some(calls) = result["next"].as_array() {
            next.extend(calls.iter().take(1).cloned());
        }
        sections.insert(target.clone(), json!({"status": result["status"], "summary": result["summary"], "sections": result["sections"], "truncated": result["truncated"]}));
    }
    next.truncate(3);
    let mut result = json!({
        "status": "ok",
        "summary": lines.join("; "),
        "sections": sections,
        "next": next,
    });
    if targets.len() > MAX_TARGETS {
        result["truncated"] = json!([{"section": "targets", "total": targets.len(), "how": format!("at most {MAX_TARGETS} targets per call; ask for the rest in another")}]);
    }
    if !stale.is_empty() {
        result["stale"] = json!({"files": stale, "do": "these changed after the index was built: read them before relying on this answer"});
    }
    if !ignored.is_empty() {
        result["ignored"] = json!(ignored);
    }
    Ok(json!({ "result": result }))
}
