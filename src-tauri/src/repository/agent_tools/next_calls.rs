//! The follow-up calls a core `repo_context` answer suggests, said with the tools an IDE model has.
//! The core names its own `repo_graph.*` operations, which only an agent built on the core alone
//! can call; here the same question is asked of `repo_context`, and a call no model here can make
//! is left out rather than suggested.
use serde_json::{json, Value};

/// The tools a suggestion may name: the ones every IDE model is given.
const HOSTED: [&str; 8] = [
    "repo_context",
    "repo_overview",
    "repo_health",
    "repo_risk",
    "repo_symbol",
    "repo_wiki",
    "read_file",
    "search_codebase",
];
const MAX_DEPTH: u64 = 5;
const MAX_BUDGET: u64 = 8_000;

fn call(arguments: Value, why: &Value) -> Value {
    json!({"tool": "repo_context", "arguments": arguments, "why": why})
}

/// `next` as an IDE model can follow it.
pub(super) fn hosted(next: &[Value]) -> Vec<Value> {
    next.iter()
        .filter_map(|suggestion| {
            let tool = suggestion["tool"].as_str()?;
            let arguments = &suggestion["arguments"];
            let why = &suggestion["why"];
            match tool {
                // The radius was cut: ask again one level deeper, with room for the answer.
                "repo_graph.impact" => {
                    let depth = arguments["depth"].as_u64().unwrap_or(2);
                    (depth < MAX_DEPTH).then(|| {
                        call(json!({"mode": "blast_radius", "targets": arguments["files"],
                            "depth": depth + 1, "budget": MAX_BUDGET}), why)
                    })
                }
                // More dependents or imports than the answer had room for.
                "repo_graph.dependents" | "repo_graph.dependencies" => Some(call(
                    json!({"mode": "connections", "target": arguments["file"], "budget": MAX_BUDGET}),
                    why,
                )),
                // The host refreshes a stale index by itself; `stale` already says what to read.
                tool if HOSTED.contains(&tool) => Some(suggestion.clone()),
                _ => None,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggests_only_tools_an_ide_model_has() {
        let next = vec![
            json!({"tool": "repo_graph.impact", "arguments": {"files": ["src/a.rs"], "depth": 2, "node_limit": 1000}, "why": "the radius was cut by depth_limit"}),
            json!({"tool": "repo_graph.dependents", "arguments": {"file": "src/a.rs", "limit": 50}, "why": "12 more dependents"}),
            json!({"tool": "repo_graph.refresh", "arguments": {}, "why": "the file changed since the snapshot"}),
            json!({"tool": "repo_context", "arguments": {"mode": "blast_radius", "target": "src/a.rs"}, "why": "what may break"}),
            json!({"tool": "repo_git.history", "arguments": {}, "why": "unknown here"}),
        ];

        let hosted = hosted(&next);

        assert_eq!(
            hosted,
            vec![
                json!({"tool": "repo_context", "arguments": {"mode": "blast_radius", "targets": ["src/a.rs"], "depth": 3, "budget": 8000}, "why": "the radius was cut by depth_limit"}),
                json!({"tool": "repo_context", "arguments": {"mode": "connections", "target": "src/a.rs", "budget": 8000}, "why": "12 more dependents"}),
                json!({"tool": "repo_context", "arguments": {"mode": "blast_radius", "target": "src/a.rs"}, "why": "what may break"}),
            ]
        );
    }

    #[test]
    fn a_radius_already_at_the_deepest_level_is_not_suggested_again() {
        let next = vec![
            json!({"tool": "repo_graph.impact", "arguments": {"files": ["src/a.rs"], "depth": 5}, "why": "cut"}),
        ];
        assert!(hosted(&next).is_empty());
    }
}
