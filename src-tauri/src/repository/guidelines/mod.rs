//! A repository's code guidelines (`.rusty/guidelines/rules.json` and `style.md`): loaded fresh on
//! every call (they are small and the user edits them), checked against files as they are on disk
//! now, and read by code health for the project's thresholds.
mod changed;
mod check;

use std::path::Path;

use harness_code_health::DetectorConfig;
use harness_guidelines::{ConfigError, Guidelines, GUIDELINES_DIR, RULES_FILE, STYLE_FILE};

pub(in crate::repository) use changed::changed_lines;
pub(in crate::repository) use check::{check_paths, CheckOptions, FileReport};

/// What a repository's guidelines folder holds.
pub(in crate::repository) struct Loaded {
    /// Whether the folder has a rules file or a style guide at all.
    pub present: bool,
    pub guidelines: Result<Guidelines, Vec<ConfigError>>,
}

fn read(root: &Path, name: &str) -> Option<String> {
    std::fs::read_to_string(root.join(GUIDELINES_DIR).join(name)).ok()
}

pub(in crate::repository) fn load(root: &Path) -> Loaded {
    let rules = read(root, RULES_FILE);
    let style = read(root, STYLE_FILE);
    Loaded {
        present: rules.is_some() || style.is_some(),
        guidelines: Guidelines::parse(rules.as_deref(), style.as_deref()),
    }
}

/// Code health thresholds for the repository at `root`: its guidelines' `detectors`, or the
/// defaults when it has none or they do not parse.
pub(in crate::repository) fn detectors(root: &Path) -> DetectorConfig {
    load(root)
        .guidelines
        .map(|g| g.detectors())
        .unwrap_or_default()
}
