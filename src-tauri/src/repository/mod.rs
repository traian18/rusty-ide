//! Repository intelligence for the architecture canvas.
//!
//! One [`Entry`] per workspace root holds the repository graph (imports and dependency groups),
//! the Git analysis, and the findings service from rusty-core. The commands in `commands.rs` are
//! thin wrappers over it and return the core's own serializable models, so the frontend never
//! sees scanner or parser types. Refresh is explicit; nothing scans in the background. User layout
//! and notes are stored separately (`persisted_state.rs`), never in the repository.

#![allow(dead_code, unused_imports)]

mod agent_context;
pub mod agent_tools;
mod background;
pub mod commands;
pub mod dashboard;
pub mod directory;
mod dto;
mod entry;
pub mod error;
mod freshness;
pub mod health;
pub mod jobs;
mod levels;
mod overview;
pub mod persisted_state;
mod queries;
mod refresh;
mod registry;
pub mod routing;
pub mod storage;
mod summaries;
mod wiki;
pub mod written;

#[cfg(test)]
mod tests;

pub use directory::{RepoRef, RepositoryDirectory};
pub use entry::Entry;
pub use registry::RepositoryState;
