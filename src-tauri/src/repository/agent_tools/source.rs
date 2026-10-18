//! Reading code as it is on disk now: lines, the symbols the metrics find in them, one symbol's
//! body, and a skeleton with the bodies elided. Never from the index, so never stale.
use harness_code_analysis::metrics::{measure_file, FileMetrics, FunctionKind};
use serde_json::{json, Value};

use super::super::{entry::Entry, error::RepositoryError, health::analyse::language_id};

/// Largest file read for an agent.
const MAX_BYTES: u64 = 2 * 1024 * 1024;
/// Lines searched below a declaration for the end of its signature.
const SIGNATURE_LINES: u32 = 6;
const SIGNATURE_CHARS: usize = 160;

pub struct LiveFile {
    pub path: String,
    pub lines: Vec<String>,
    /// `None` when the language is not measured.
    pub metrics: Option<FileMetrics>,
}

pub fn read(entry: &Entry, path: &str) -> Result<LiveFile, RepositoryError> {
    let full = entry.root().join(path);
    let metadata = std::fs::metadata(&full)
        .map_err(|_| RepositoryError::new("not_found", format!("{path} does not exist")))?;
    if !metadata.is_file() {
        return Err(RepositoryError::new(
            "not_found",
            format!("{path} is not a file"),
        ));
    }
    if metadata.len() > MAX_BYTES {
        return Err(RepositoryError::invalid(format!(
            "{path} is larger than 2 MB"
        )));
    }
    let bytes =
        std::fs::read(&full).map_err(|e| RepositoryError::new("io_error", e.to_string()))?;
    let metrics = language_id(path).and_then(|id| measure_file(&id, path, &bytes).ok());
    let text = String::from_utf8_lossy(&bytes);
    Ok(LiveFile {
        path: path.to_owned(),
        lines: text.lines().map(str::to_owned).collect(),
        metrics,
    })
}

impl LiveFile {
    fn line(&self, number: u32) -> &str {
        self.lines
            .get(number.saturating_sub(1) as usize)
            .map_or("", String::as_str)
    }

    /// The last line of the signature that starts at `start`: the first that opens the body.
    fn signature_end(&self, start: u32, end: u32) -> u32 {
        (start..=end.min(start + SIGNATURE_LINES))
            .find(|&n| {
                let text = self.line(n).trim_end();
                text.ends_with('{') || text.ends_with(':') || text.ends_with("=>")
            })
            .unwrap_or(start)
    }

    /// The declaration line, trimmed and shortened.
    pub fn signature(&self, start: u32) -> String {
        let text = self.line(start).trim();
        if text.chars().count() > SIGNATURE_CHARS {
            format!(
                "{}…",
                text.chars().take(SIGNATURE_CHARS).collect::<String>()
            )
        } else {
            text.to_owned()
        }
    }

    /// `first..=last` as numbered lines.
    pub fn numbered(&self, first: u32, last: u32) -> String {
        let last = last.min(self.lines.len() as u32);
        (first.max(1)..=last)
            .map(|n| format!("{n:>5}| {}", self.line(n)))
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Classes, then the largest functions, at most `limit`, each with its span and complexity.
    pub fn symbols(&self, limit: usize) -> (Vec<Value>, usize) {
        let Some(metrics) = &self.metrics else {
            return (Vec::new(), 0);
        };
        let mut rows: Vec<(u32, Value)> = metrics
            .classes
            .iter()
            .map(|c| {
                (
                    u32::MAX,
                    json!({"name": c.name, "kind": "class", "lines": format!("{}-{}", c.start_line, c.end_line),
                        "signature": self.signature(c.start_line), "methods": c.method_count}),
                )
            })
            .collect();
        let mut functions: Vec<_> = metrics
            .functions
            .iter()
            .filter(|f| f.kind != FunctionKind::Closure)
            .collect();
        functions.sort_by(|a, b| b.nloc.cmp(&a.nloc).then(a.start_line.cmp(&b.start_line)));
        rows.extend(functions.iter().map(|f| {
            (
                f.nloc,
                json!({"name": f.qualified_name, "kind": if f.kind == FunctionKind::Method { "method" } else { "function" },
                    "lines": format!("{}-{}", f.start_line, f.end_line), "signature": self.signature(f.start_line),
                    "ccn": f.ccn, "nloc": f.nloc}),
            )
        }));
        let total = rows.len();
        rows.truncate(limit);
        (rows.into_iter().map(|(_, v)| v).collect(), total)
    }

    /// Spans of the functions and classes named `name` (`Type.method` and `Type::method` match a
    /// method; a bare name matches any function, method or class with that name).
    pub fn find(&self, name: &str) -> Vec<(String, &'static str, u32, u32)> {
        let Some(metrics) = &self.metrics else {
            return Vec::new();
        };
        let wanted = name.replace("::", ".");
        let qualified = wanted.contains('.');
        let mut out: Vec<(String, &'static str, u32, u32)> = metrics
            .classes
            .iter()
            .filter(|c| !qualified && c.name == wanted)
            .map(|c| (c.name.clone(), "class", c.start_line, c.end_line))
            .collect();
        out.extend(
            metrics
                .functions
                .iter()
                .filter(|f| {
                    if qualified {
                        f.qualified_name == wanted
                    } else {
                        f.name == wanted
                    }
                })
                .map(|f| {
                    let kind = if f.kind == FunctionKind::Method {
                        "method"
                    } else {
                        "function"
                    };
                    (f.qualified_name.clone(), kind, f.start_line, f.end_line)
                }),
        );
        out
    }

    /// Every line, with the bodies of functions and methods replaced by one `… lines a-b` marker;
    /// signatures, imports, types and fields stay.
    pub fn skeleton(&self, max_lines: usize) -> (String, bool) {
        let mut elided: Vec<(u32, u32)> = Vec::new();
        if let Some(metrics) = &self.metrics {
            let mut functions: Vec<_> = metrics
                .functions
                .iter()
                .filter(|f| f.kind != FunctionKind::Closure)
                .collect();
            functions.sort_by_key(|f| f.start_line);
            for f in functions {
                if elided
                    .iter()
                    .any(|&(a, b)| f.start_line >= a && f.start_line <= b)
                {
                    continue;
                }
                let body_start = self.signature_end(f.start_line, f.end_line) + 1;
                let body_end = f.end_line.saturating_sub(1);
                if body_end > body_start {
                    elided.push((body_start, body_end));
                }
            }
        }
        let mut out = Vec::new();
        let mut n = 1u32;
        let total = self.lines.len() as u32;
        while n <= total {
            if let Some(&(a, b)) = elided.iter().find(|&&(a, _)| a == n) {
                out.push(format!("     | … lines {a}-{b} ({} lines)", b - a + 1));
                n = b + 1;
                continue;
            }
            out.push(format!("{n:>5}| {}", self.line(n)));
            n += 1;
        }
        let cut = out.len() > max_lines;
        out.truncate(max_lines);
        (out.join("\n"), cut)
    }
}
