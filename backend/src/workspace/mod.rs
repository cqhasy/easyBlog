pub mod checkout;
pub mod commit_log;
pub mod diff;
pub mod file_lock;
pub mod objects;
pub mod working_tree;

pub use checkout::{Checkout, CheckoutError};
pub use diff::{Diff, FileChangeKind, FileDiff};
pub use file_lock::{FileLock, FileLockError};
pub use objects::{GitBlob, GitObjectError, GitObjectStore};
pub use working_tree::{WorkingTree, WorkingTreeError};
