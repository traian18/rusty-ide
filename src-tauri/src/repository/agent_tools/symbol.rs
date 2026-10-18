//! `repo_symbol`: the body of one function, method or class, or a line range, line-numbered and
//! read from the file on disk now. With `depth` 2 it adds the bodies of the functions in the same
//! file that the body calls.
use serde_json::{json, Value};

use super::{
    super::{entry::Entry, error::RepositoryError},
    envelope::{next, Args, Envelope},
    source::{self, LiveFile},
};

const KNOWN: [&str; 4] = ["target", "context_lines", "depth", "budget"];
/// Longest body served in one answer.
const MAX_LINES: u32 = 600;
/// Longest line range a caller may ask for.
const MAX_RANGE: u32 = 200;
/// Callee bodies added at depth 2.
const MAX_CALLEES: usize = 5;

enum Target {
    Symbol(String, String),
    Range(String, u32, u32),
}

fn parse(target: &str) -> Result<Target, RepositoryError> {
    if let Some((path, name)) = target.split_once("::") {
        return Ok(Target::Symbol(path.to_owned(), name.to_owned()));
    }
    if let Some((path, range)) = target.rsplit_once(':') {
        let (a, b) = range.split_once('-').unwrap_or((range, range));
        if let (Ok(a), Ok(b)) = (a.parse::<u32>(), b.parse::<u32>()) {
            return Ok(Target::Range(path.to_owned(), a.max(1), b.max(a)));
        }
    }
    Err(RepositoryError::invalid(
        "target must be `path::Name`, `path::Type.method` or `path:start-end`",
    ))
}

/// Same-file functions the lines `a..=b` call, by name followed by `(`.
fn callees(file: &LiveFile, a: u32, b: u32, own: &str) -> Vec<(String, u32, u32)> {
    let Some(metrics) = &file.metrics else {
        return Vec::new();
    };
    let body: String = file.numbered(a, b);
    let mut out: Vec<(String, u32, u32)> = Vec::new();
    for f in &metrics.functions {
        if f.qualified_name == own || (f.start_line >= a && f.end_line <= b) {
            continue;
        }
        let called = [
            format!("{}(", f.name),
            format!(".{}(", f.name),
            format!("::{}(", f.name),
        ]
        .iter()
        .any(|needle| body.contains(needle.as_str()));
        if called && !out.iter().any(|(n, _, _)| n == &f.qualified_name) {
            out.push((f.qualified_name.clone(), f.start_line, f.end_line));
        }
    }
    out.truncate(MAX_CALLEES);
    out
}

pub fn run(entry: &Entry, arguments: Value) -> Result<Value, RepositoryError> {
    let args = Args::new(arguments, &KNOWN)?;
    let budget = args.budget().max(12_000);
    let target = args
        .string("target")
        .ok_or_else(|| RepositoryError::invalid("target is required"))?;
    let context = args.number("context_lines", 0, 0, 50) as u32;
    let depth = args.number("depth", 1, 1, 2);
    let (path, found) = match parse(&target)? {
        Target::Symbol(path, name) => {
            let file = source::read(entry, &path)?;
            if file.metrics.is_none() {
                let envelope = Envelope::new("unsupported", format!("{path}: symbols are not measured for this language; ask for a line range instead"))
                    .ignored(args.ignored())
                    .next(next("repo_symbol", json!({"target": format!("{path}:1-{}", MAX_RANGE)}), "read the start of the file"));
                return Ok(envelope.into_output(budget));
            }
            let matches = file.find(&name);
            match matches.as_slice() {
                [] => {
                    let (symbols, _) = file.symbols(30);
                    let envelope = Envelope::new(
                        "not_found",
                        format!("no function, method or class named `{name}` in {path}"),
                    )
                    .section("candidates", json!(symbols))
                    .ignored(args.ignored());
                    return Ok(envelope.into_output(budget));
                }
                [one] => {
                    let (qualified, kind, a, b) = one.clone();
                    (path.clone(), (file, Some((qualified, kind)), a, b))
                }
                many => {
                    let candidates: Vec<Value> = many
                        .iter()
                        .map(|(q, kind, a, b)| json!({"name": q, "kind": kind, "lines": format!("{a}-{b}"), "signature": file.signature(*a)}))
                        .collect();
                    let mut envelope = Envelope::new(
                        "partial",
                        format!(
                            "`{name}` matches {} symbols in {path}; name one",
                            many.len()
                        ),
                    )
                    .section("candidates", json!(candidates))
                    .ignored(args.ignored());
                    for (q, _, _, _) in many.iter().take(3) {
                        envelope = envelope.next(next(
                            "repo_symbol",
                            json!({"target": format!("{path}::{q}")}),
                            "this one",
                        ));
                    }
                    return Ok(envelope.into_output(budget));
                }
            }
        }
        Target::Range(path, a, b) => {
            let file = source::read(entry, &path)?;
            let b = b.min(a + MAX_RANGE - 1);
            (path, (file, None, a, b))
        }
    };
    let (file, symbol, a, b) = found;
    let total = file.lines.len() as u32;
    let first = a.saturating_sub(context).max(1);
    let wanted_last = (b + context).min(total);
    let last = wanted_last.min(first + MAX_LINES - 1);
    let whole = last == wanted_last;
    let label = match &symbol {
        Some((name, _)) => format!("{path}::{name} lines {a}-{b}"),
        None => format!("{path}:{first}-{last}"),
    };
    let mut envelope = Envelope::new(
        "ok",
        match &symbol {
            Some((name, kind)) => format!("{kind} `{name}` in {path}, lines {a}-{b}"),
            None => format!("{path}, lines {first}-{last} of {total}"),
        },
    )
    .section("source", json!(file.numbered(first, last)))
    .ignored(args.ignored());
    if let Some((_, kind)) = &symbol {
        envelope = envelope.section(
            "signature",
            json!({"kind": kind, "text": file.signature(a)}),
        );
    }
    if whole {
        envelope = envelope.complete(label);
    } else {
        envelope = envelope
            .truncated("source", (wanted_last - first + 1) as usize, "ask for the rest as a line range")
            .next(next("repo_symbol", json!({"target": format!("{path}:{}-{}", last + 1, (last + MAX_RANGE).min(wanted_last))}), "the rest of the body"));
    }
    if depth > 1 {
        if let Some((name, _)) = &symbol {
            let bodies: Vec<Value> = callees(&file, a, b, name)
                .into_iter()
                .map(|(q, s, e)| json!({"name": q, "lines": format!("{s}-{e}"), "source": file.numbered(s, e.min(s + MAX_RANGE - 1))}))
                .collect();
            envelope = envelope.section("callees", json!({"basis": "functions of the same file whose names the body calls", "bodies": bodies}));
        }
    }
    Ok(envelope.into_output(budget))
}
