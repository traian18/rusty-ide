//! The files page of the documentation: the files map and table, and one file's facts for the
//! drawer. Everything is computed from the indexes the entry already holds (repository
//! snapshot, Git analysis, findings); code health is computed in `repository::health`.
mod file;
mod index;
mod map;
pub mod model;
mod prompt;
mod table;

pub use index::LineCounts;
