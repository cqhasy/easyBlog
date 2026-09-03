use std::{fs, io, path::Path};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ContentHash(pub String);

#[derive(Debug)]
pub enum HashError {
    Read { path: String, source: io::Error },
}

impl ContentHash {
    pub fn from_bytes(bytes: &[u8]) -> Self {
        Self(format!("{:x}", Sha256::digest(bytes)))
    }

    pub fn read(path: &Path) -> Result<Option<Self>, HashError> {
        match fs::read(path) {
            Ok(bytes) => Ok(Some(Self::from_bytes(&bytes))),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(source) => Err(HashError::Read {
                path: path.display().to_string(),
                source,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::ContentHash;

    #[test]
    fn hashes_exact_binary_bytes_and_distinguishes_absence() {
        assert_ne!(
            ContentHash::from_bytes(b"a"),
            ContentHash::from_bytes(b"a\n")
        );
        assert_eq!(ContentHash::read(Path::new("missing")).unwrap(), None);
    }
}
