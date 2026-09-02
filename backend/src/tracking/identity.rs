use std::path::Path;

pub fn local_source_identity(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}
