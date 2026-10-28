//! The `.rusty` folder's own guide (`README.md`) and ignore file (`.gitignore`): what each part
//! holds, and which parts are shared through Git and which stay on this machine. Both are written
//! when the folder is created or its workspace is opened, and kept current while their first line
//! says Rusty wrote them; a person who removes that line keeps their own version.
use std::path::Path;

/// The folder's name inside a workspace or a repository.
pub const FOLDER: &str = ".rusty";

/// One file or folder Rusty keeps in `.rusty`.
pub struct Part {
    /// Relative to `.rusty`; a folder ends with `/`.
    pub path: &'static str,
    /// Kept in Git (the project's); otherwise it stays on this machine.
    pub shared: bool,
    /// What goes into it, in a few words.
    pub holds: &'static str,
}

pub const PARTS: &[Part] = &[
    Part { path: "README.md", shared: true, holds: "this guide to the folder" },
    Part { path: ".gitignore", shared: true, holds: "what Git keeps of this folder: the shared parts only" },
    Part { path: "guidelines/", shared: true, holds: "the project's code guidelines: rules.json (patterns, size and complexity limits, import boundaries; checked on every edit and before a run finishes) and style.md (the prose style guide the agent is shown before it edits a file)" },
    Part { path: "specs/", shared: true, holds: "spec-driven changes: each change's proposal, design and task list, and the capability specs (Specs page)" },
    Part { path: "specs.json", shared: true, holds: "where the specs live" },
    Part { path: "skills/", shared: true, holds: "the project's own skills" },
    Part { path: "workflows/", shared: true, holds: "saved workflows (Behaviors page)" },
    Part { path: "profiles/", shared: true, holds: "behavior profiles, and config.json naming the default one" },
    Part { path: "canvas/", shared: true, holds: "canvas pipelines and their layout" },
    Part { path: "chats/", shared: false, holds: "the Agent tab's conversations, one file per chat" },
    Part { path: "runs/", shared: false, holds: "event logs of agent and workflow runs" },
    Part { path: "goals/", shared: false, holds: "goal loops (/goal): each goal's targets, plan, measurements and journal; <id>.checkpoint.json names the snapshot the running pass started from" },
    Part { path: "findings/", shared: false, holds: "long answers the agent saved as documents" },
    Part { path: "metrics/", shared: false, holds: "usage and code health history" },
    Part { path: "observability/", shared: false, holds: "traces of model and tool calls" },
    Part { path: "notepad.txt", shared: false, holds: "the notepad" },
];

const GITIGNORE_MARK: &str = "# Written by Rusty; remove this line to keep your own version.";
const README_MARK: &str = "<!-- Written by Rusty; remove this line to keep your own version. -->";

fn gitignore() -> String {
    let mut out = format!(
        "{GITIGNORE_MARK}\n\
         # Git keeps only the shared parts of this folder; everything else, including anything new,\n\
         # stays on this machine. (A repository whose own .gitignore ignores /.rusty keeps none of it.)\n\
         /*\n"
    );
    for part in PARTS.iter().filter(|p| p.shared) {
        out.push_str(&format!(
            "# {}: {}\n!/{}\n",
            part.path, part.holds, part.path
        ));
    }
    out.push_str("\n# Stays on this machine:\n");
    for part in PARTS.iter().filter(|p| !p.shared) {
        out.push_str(&format!("# {}: {}\n", part.path, part.holds));
    }
    out
}

fn readme() -> String {
    let mut out = format!(
        "{README_MARK}\n# .rusty\n\n\
         What Rusty keeps for this project. The shared parts are meant to be committed with it; the\n\
         others are this machine's own and `.gitignore` here keeps them out of Git. If the\n\
         repository's own `.gitignore` ignores `/.rusty`, remove that line to share the shared parts.\n\n\
         | Path | Shared | What goes into it |\n|---|---|---|\n"
    );
    for part in PARTS {
        let shared = if part.shared { "yes" } else { "no" };
        out.push_str(&format!(
            "| `{}` | {shared} | {} |\n",
            part.path, part.holds
        ));
    }
    out
}

/// Writes `text` to `path` when there is no file yet, or when the one there is Rusty's (its first
/// line is `mark`) and says something else. Returns whether it wrote.
fn write_owned(path: &Path, mark: &str, text: &str) -> std::io::Result<bool> {
    match std::fs::read_to_string(path) {
        Ok(existing) if existing == text || existing.lines().next() != Some(mark) => Ok(false),
        _ => std::fs::write(path, text).map(|()| true),
    }
}

/// Keeps the guide and the ignore file of `root`'s `.rusty` folder current. Nothing happens when
/// `root` has no `.rusty` folder: this never creates one.
pub fn ensure(root: &Path) -> std::io::Result<()> {
    let folder = root.join(FOLDER);
    if !folder.is_dir() {
        return Ok(());
    }
    write_owned(&folder.join(".gitignore"), GITIGNORE_MARK, &gitignore())?;
    write_owned(&folder.join("README.md"), README_MARK, &readme())?;
    Ok(())
}

/// [`ensure`] for a workspace folder and each repository inside it; failures are only logged, since
/// they must never stop the workspace from opening.
pub fn ensure_workspace(workspace: &Path) {
    let mut roots = vec![workspace.to_path_buf()];
    if let Ok(repositories) =
        crate::git::discover_workspace_repositories(&workspace.to_string_lossy())
    {
        roots.extend(
            repositories
                .into_iter()
                .map(|r| std::path::PathBuf::from(r.worktree_path)),
        );
    }
    roots.sort();
    roots.dedup();
    for root in roots {
        if let Err(error) = ensure(&root) {
            eprintln!(
                "[rusty_folder] could not update {}/.rusty: {error}",
                root.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_folder_gets_a_guide_and_keeps_only_the_shared_parts_in_git() {
        let dir = tempfile::tempdir().unwrap();
        ensure(dir.path()).unwrap();
        assert!(
            !dir.path().join(FOLDER).exists(),
            "it never creates the folder"
        );

        std::fs::create_dir(dir.path().join(FOLDER)).unwrap();
        ensure(dir.path()).unwrap();
        let ignore = std::fs::read_to_string(dir.path().join(".rusty/.gitignore")).unwrap();
        assert!(ignore.starts_with(GITIGNORE_MARK));
        assert!(ignore.contains("/*\n"));
        assert!(ignore.contains("# guidelines/: the project's code guidelines"));
        assert!(ignore.contains("!/guidelines/\n"));
        assert!(!ignore.contains("!/chats/"));
        assert!(ignore.contains("# chats/: the Agent tab's conversations"));
        let readme = std::fs::read_to_string(dir.path().join(".rusty/README.md")).unwrap();
        assert!(readme.contains("| `goals/` | no |"));
        assert!(readme.contains("| `specs/` | yes |"));

        // A version without the first line is the person's own and stays as it is.
        std::fs::write(dir.path().join(".rusty/README.md"), "mine\n").unwrap();
        std::fs::write(
            dir.path().join(".rusty/.gitignore"),
            format!("{GITIGNORE_MARK}\nold\n"),
        )
        .unwrap();
        ensure(dir.path()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".rusty/README.md")).unwrap(),
            "mine\n"
        );
        assert_eq!(
            std::fs::read_to_string(dir.path().join(".rusty/.gitignore")).unwrap(),
            ignore
        );
    }
}
