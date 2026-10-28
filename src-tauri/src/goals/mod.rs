//! Goal loops in the host: the Tauri commands over `harness-goals`.
//!
//! A goal is saved in the workspace (`.rusty/goals/<id>.json`); the Agent tab runs its passes and
//! after each one asks [`commands::goal_after_pass`] what happens next. That command measures the
//! scope (code health, guidelines; the pass's own checks come from the tab), decides with
//! `harness-goals`, undoes a pass that made things worse from the checkpoint taken before it, and
//! answers with the next pass's prompt while the goal runs.
//!
//! | Module | Responsibility |
//! |---|---|
//! | `store` | Reading and writing goals and their checkpoints |
//! | `commands` | The Tauri commands |
pub mod commands;
mod store;
