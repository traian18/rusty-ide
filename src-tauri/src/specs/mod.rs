//! Spec-driven development in the host: the Tauri commands over `harness-specs`.
//!
//! The specs are plain Markdown in the repository (`specs/` by default), so these commands read
//! and write files directly and never need the repository to be analyzed. The format, the checks
//! and the scaffolding live in rusty-core; this module adds the disk, the Git branch of a new
//! change and the error type the frontend already understands.
//!
//! | Module | Responsibility |
//! |---|---|
//! | `commands` | The Tauri commands, each a thin wrapper that runs off the UI thread |
//! | `branch` | Creating and switching to a change's Git branch |
//! | `linked` | Changes linked across a workspace's repositories: creating, context and switching |
//! | `workspace` | The workspace's own specs under `.rusty/specs` and its optional Git repository |
pub mod branch;
pub mod commands;
pub mod linked;
pub mod workspace;
