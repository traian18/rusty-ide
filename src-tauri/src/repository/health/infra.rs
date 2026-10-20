//! Infrastructure files (Terraform, pipelines, Dockerfiles, manifests, ...) through the
//! infrastructure rules. They are not in the import graph, so the repository is walked for them.
use std::{
    collections::{HashMap, HashSet},
    path::Path,
};

use std::sync::Arc;

use harness_git_analysis::{FileSignals, SignalSummary};
use harness_infra_analysis::{
    analyse, history_findings, is_candidate, InfraConfig, InfraContext, InfraGraph,
};

use super::analyse::FileAnalysis;

/// Largest file read.
const MAX_BYTES: u64 = 1024 * 1024;
/// Most infrastructure files analysed in one repository.
const MAX_FILES: usize = 20_000;
/// Most paths listed for rules that look at the whole repository.
const MAX_LISTED: usize = 500_000;
const SKIPPED_DIRS: [&str; 6] = [
    ".git",
    "node_modules",
    "target",
    ".terraform",
    "vendor",
    ".terragrunt-cache",
];

pub(super) fn nloc(text: &str) -> u32 {
    text.lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('#') && !t.starts_with("//")
        })
        .count() as u32
}

/// The infrastructure files of a repository and what relates them.
#[derive(Default)]
pub struct InfraState {
    pub files: Vec<FileAnalysis>,
    pub graph: Arc<InfraGraph>,
    /// Every path in the repository, for rules about files that should or should not exist.
    pub all_paths: Arc<Vec<String>>,
}

/// Every infrastructure file under `root` that code analysis did not already take (`known`).
pub fn analyse_infra(
    root: &Path,
    known: &HashSet<String>,
    signals: &HashMap<String, &FileSignals>,
    summary: Option<&SignalSummary>,
) -> InfraState {
    let config = InfraConfig::default();
    let scoring = harness_infra_analysis::scoring_config();
    let walker = ignore::WalkBuilder::new(root)
        .hidden(false)
        .filter_entry(|e| {
            e.file_name()
                .to_str()
                .is_none_or(|n| !SKIPPED_DIRS.contains(&n))
        })
        .build();
    // One pass lists every file (rules about the repository itself need the list) and keeps the
    // candidates to read.
    let mut all: Vec<String> = Vec::new();
    let mut candidates: Vec<(String, std::path::PathBuf)> = Vec::new();
    for entry in walker.flatten() {
        if all.len() >= MAX_LISTED {
            break;
        }
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(root) else {
            continue;
        };
        let path = relative.display().to_string();
        if !known.contains(&path)
            && is_candidate(&path)
            && candidates.len() < MAX_FILES
            && entry.metadata().is_ok_and(|m| m.len() <= MAX_BYTES)
        {
            candidates.push((path.clone(), entry.path().to_path_buf()));
        }
        all.push(path);
    }
    // Read every candidate first: the graph relates files to each other, so rules see the
    // whole repository.
    let texts: Vec<(String, String)> = candidates
        .into_iter()
        .filter_map(|(path, full)| Some((path, std::fs::read_to_string(full).ok()?)))
        .collect();
    let pairs: Vec<(&str, &str)> = texts
        .iter()
        .map(|(path, text)| (path.as_str(), text.as_str()))
        .collect();
    let graph = harness_infra_analysis::InfraGraph::build(&pairs, &all);
    let context = InfraContext {
        repo_files: Some(&all),
        graph: Some(&graph),
    };
    let mut out = Vec::new();
    for (path, text) in &texts {
        let Some((kind, mut findings)) = analyse(path, text, &context, &config) else {
            continue;
        };
        if let (Some(s), Some(summary)) = (signals.get(path), summary) {
            findings.extend(history_findings(path, nloc(text), s, summary));
        }
        let score = harness_code_health::score_file(&findings, &scoring);
        out.push(FileAnalysis {
            signals: signals.get(path).map(|s| (*s).clone()),
            language: kind.name().to_owned(),
            nloc: nloc(text),
            metrics: None,
            findings,
            score: Some(score),
            test: false,
            importers: 0,
            links: None,
            path: path.clone(),
        });
    }
    InfraState {
        files: out,
        graph: Arc::new(graph),
        all_paths: Arc::new(all),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::{HashMap, HashSet};

    use super::analyse_infra;

    #[test]
    fn finds_infrastructure_files_and_respects_gitignore() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let write = |path: &str, text: &str| {
            let full = root.join(path);
            std::fs::create_dir_all(full.parent().unwrap()).unwrap();
            std::fs::write(full, text).unwrap();
        };
        write("Dockerfile", "FROM ubuntu\n");
        write(
            ".github/workflows/ci.yml",
            "on: push\njobs:\n  b:\n    steps:\n      - uses: acme/x@main\n",
        );
        write("infra/main.tf", "terraform {\n  required_providers {\n    aws = {\n      source = \"hashicorp/aws\"\n    }\n  }\n}\n");
        write("infra/vars.tf", "variable \"unused\" {}\n");
        write("node_modules/pkg/Dockerfile", "FROM ubuntu\n");
        write("src/app.ts", "export {}\n");
        // `ignore` honours .gitignore only inside a git repository.
        std::fs::create_dir_all(root.join(".git")).unwrap();
        write(".gitignore", "generated/\n");
        write("generated/Dockerfile", "FROM ubuntu\n");

        let files = analyse_infra(root, &HashSet::new(), &HashMap::new(), None).files;
        let mut found: Vec<(String, String, usize)> = files
            .iter()
            .map(|f| (f.path.clone(), f.language.clone(), f.findings.len()))
            .collect();
        found.sort();
        let names: Vec<&str> = found.iter().map(|f| f.0.as_str()).collect();
        assert!(names.contains(&"Dockerfile"));
        assert!(names.contains(&".github/workflows/ci.yml"));
        assert!(names.contains(&"infra/main.tf"));
        assert!(!names
            .iter()
            .any(|n| n.contains("node_modules") || n.starts_with("generated")));
        assert!(!names.contains(&"src/app.ts"));
        let docker = files.iter().find(|f| f.path == "Dockerfile").unwrap();
        assert!(docker
            .findings
            .iter()
            .any(|f| f.detector == "df_latest_tag"));
        assert!(docker.score.as_ref().unwrap().defect.score < 10.0);
        // Graph rules see the whole module directory.
        let vars = files.iter().find(|f| f.path == "infra/vars.tf").unwrap();
        assert!(vars
            .findings
            .iter()
            .any(|f| f.detector == "tf_unused_variable"));
        // The missing `.env` ignore pattern is reported against the root `.gitignore`.
        let ignore = files.iter().find(|f| f.path == ".gitignore").unwrap();
        assert!(ignore
            .findings
            .iter()
            .any(|f| f.detector == "repo_gitignore_gaps"));
    }
}
