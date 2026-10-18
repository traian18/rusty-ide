//! The answer shape every agent tool shares, and the argument reader that reports what it did not
//! understand instead of applying it.
//!
//! An answer carries a `status`, a one-line `summary` and named `sections`, plus only when they
//! say something: `stale` (files the answer used that changed after the index was built: read
//! those), `complete` (bodies served whole from disk: do not read them again), `truncated` (what
//! was cut and how to get it back), `ignored` (arguments not understood, with the accepted values)
//! and `next` (ready-to-run calls).
use std::time::UNIX_EPOCH;

use serde_json::{json, Map, Value};

use super::super::{entry::Entry, error::RepositoryError};

/// Default answer size in characters, and the bounds a caller may ask for.
pub const DEFAULT_BUDGET: usize = 8_000;
const MIN_BUDGET: usize = 1_000;
const MAX_BUDGET: usize = 24_000;

/// The arguments of one call. Keys the tool does not know, and values outside a closed list, are
/// recorded in `ignored` rather than applied.
pub struct Args {
    map: Map<String, Value>,
    ignored: Vec<Value>,
}

impl Args {
    pub fn new(arguments: Value, known: &[&str]) -> Result<Self, RepositoryError> {
        let Value::Object(mut map) = arguments else {
            return Err(RepositoryError::invalid("arguments must be an object"));
        };
        let unknown: Vec<String> = map
            .keys()
            .filter(|k| !known.contains(&k.as_str()))
            .cloned()
            .collect();
        let mut ignored = Vec::new();
        for key in unknown {
            map.remove(&key);
            ignored.push(json!({"argument": key, "accepted": known}));
        }
        Ok(Self { map, ignored })
    }

    pub fn string(&self, key: &str) -> Option<String> {
        self.map
            .get(key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    }

    /// A list of strings; a single string counts as a list of one.
    pub fn strings(&self, key: &str) -> Vec<String> {
        match self.map.get(key) {
            Some(Value::String(s)) if !s.trim().is_empty() => vec![s.trim().to_owned()],
            Some(Value::Array(items)) => items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            _ => Vec::new(),
        }
    }

    pub fn number(&self, key: &str, default: usize, min: usize, max: usize) -> usize {
        self.map
            .get(key)
            .and_then(Value::as_u64)
            .map_or(default, |n| (n as usize).clamp(min, max))
    }

    pub fn budget(&self) -> usize {
        self.number("budget", DEFAULT_BUDGET, MIN_BUDGET, MAX_BUDGET)
    }

    /// The values of `key` that are in `accepted`; the others go to `ignored`.
    pub fn choices(&mut self, key: &str, accepted: &[&str]) -> Vec<String> {
        let mut kept = Vec::new();
        for value in self.strings(key) {
            if accepted.contains(&value.as_str()) {
                kept.push(value);
            } else {
                self.ignored
                    .push(json!({"argument": key, "value": value, "accepted": accepted}));
            }
        }
        kept
    }

    pub fn ignored(&self) -> &[Value] {
        &self.ignored
    }
}

/// A suggested follow-up call.
pub fn next(tool: &str, arguments: Value, why: &str) -> Value {
    json!({"tool": tool, "arguments": arguments, "why": why})
}

pub struct Envelope {
    status: &'static str,
    summary: String,
    sections: Vec<(String, Value)>,
    stale: Vec<String>,
    complete: Vec<String>,
    truncated: Vec<Value>,
    ignored: Vec<Value>,
    next: Vec<Value>,
}

impl Envelope {
    pub fn new(status: &'static str, summary: impl Into<String>) -> Self {
        Self {
            status,
            summary: summary.into(),
            sections: Vec::new(),
            stale: Vec::new(),
            complete: Vec::new(),
            truncated: Vec::new(),
            ignored: Vec::new(),
            next: Vec::new(),
        }
    }

    /// Sections are dropped from the end when the answer is over budget, so add the most useful first.
    pub fn section(mut self, name: &str, value: Value) -> Self {
        if !value.is_null() {
            self.sections.push((name.to_owned(), value));
        }
        self
    }

    pub fn stale(mut self, files: Vec<String>) -> Self {
        self.stale.extend(files);
        self
    }

    pub fn complete(mut self, what: impl Into<String>) -> Self {
        self.complete.push(what.into());
        self
    }

    /// `what` was cut; `how` is the call or argument that gets it back.
    pub fn truncated(mut self, what: &str, total: usize, how: &str) -> Self {
        self.truncated
            .push(json!({"section": what, "total": total, "how": how}));
        self
    }

    pub fn ignored(mut self, ignored: &[Value]) -> Self {
        self.ignored.extend_from_slice(ignored);
        self
    }

    pub fn next(mut self, call: Value) -> Self {
        if self.next.len() < 3 {
            self.next.push(call);
        }
        self
    }

    /// `{"result": …}`, the shape every repository tool returns, within `budget` characters.
    pub fn into_output(mut self, budget: usize) -> Value {
        let mut result = self.render();
        while result.to_string().len() > budget && self.sections.len() > 1 {
            let (name, _) = self.sections.pop().expect("more than one section");
            self.truncated.push(
                json!({"section": name, "how": "ask with a larger budget, or for fewer targets"}),
            );
            result = self.render();
        }
        json!({ "result": result })
    }

    fn render(&self) -> Value {
        let mut out = Map::new();
        out.insert("status".into(), json!(self.status));
        out.insert("summary".into(), json!(self.summary));
        let sections: Map<String, Value> = self.sections.iter().cloned().collect();
        out.insert("sections".into(), Value::Object(sections));
        if !self.stale.is_empty() {
            out.insert("stale".into(), json!({"files": self.stale, "do": "these changed after the index was built: read them before relying on what this answer says about them"}));
        }
        if !self.complete.is_empty() {
            out.insert("complete".into(), json!({"served": self.complete, "do": "served whole from the file on disk: do not read it again"}));
        }
        if !self.truncated.is_empty() {
            out.insert("truncated".into(), json!(self.truncated));
        }
        if !self.ignored.is_empty() {
            out.insert("ignored".into(), json!(self.ignored));
        }
        out.insert("next".into(), json!(self.next));
        Value::Object(out)
    }
}

/// The files among `paths` modified on disk after the index was built.
pub fn stale_files(entry: &Entry, paths: &[String]) -> Vec<String> {
    let Some(built_at) = entry.built_at_ms() else {
        return Vec::new();
    };
    paths
        .iter()
        .filter(|path| {
            std::fs::metadata(entry.root().join(path))
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .is_some_and(|t| t.as_millis() as u64 > built_at)
        })
        .cloned()
        .collect()
}
