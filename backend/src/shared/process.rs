use std::{ffi::OsStr, process::Command};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);

    // Finder/Dock launches do not inherit the user's terminal PATH. Pass the
    // augmented PATH to children too, so Git credential helpers can find gh.
    #[cfg(target_os = "macos")]
    command.env(
        "PATH",
        macos_command_path(std::env::var_os("PATH").as_deref()),
    );

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}

#[cfg(target_os = "macos")]
fn macos_command_path(inherited: Option<&OsStr>) -> std::ffi::OsString {
    use std::{env, path::PathBuf};

    let mut paths: Vec<PathBuf> = inherited
        .map(|path| env::split_paths(path).collect())
        .unwrap_or_default();
    for directory in [
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
        "/usr/local/bin",
        "/usr/local/sbin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ] {
        let directory = PathBuf::from(directory);
        if !paths.contains(&directory) {
            paths.push(directory);
        }
    }
    env::join_paths(paths).expect("existing PATH and standard macOS directories are valid")
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::{env, path::PathBuf};

    #[test]
    fn finds_both_homebrew_installations_with_a_finder_path() {
        let path = macos_command_path(Some(OsStr::new("/usr/bin:/bin")));
        let directories: Vec<_> = env::split_paths(&path).collect();

        assert!(directories.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(directories.contains(&PathBuf::from("/usr/local/bin")));
        assert!(directories.contains(&PathBuf::from("/usr/sbin")));
    }

    #[test]
    fn preserves_custom_tool_precedence_without_duplicate_fallbacks() {
        let inherited = env::join_paths(["/custom tools/bin", "/usr/local/bin"]).unwrap();
        let path = macos_command_path(Some(&inherited));
        let directories: Vec<_> = env::split_paths(&path).collect();

        assert_eq!(directories[0], PathBuf::from("/custom tools/bin"));
        assert_eq!(directories[1], PathBuf::from("/usr/local/bin"));
        assert_eq!(
            directories
                .iter()
                .filter(|path| **path == PathBuf::from("/usr/local/bin"))
                .count(),
            1
        );
    }

    #[test]
    fn supplies_a_path_when_the_launcher_has_none() {
        let path = macos_command_path(None);
        let directories: Vec<_> = env::split_paths(&path).collect();

        assert!(directories.contains(&PathBuf::from("/opt/homebrew/bin")));
        assert!(directories.contains(&PathBuf::from("/usr/local/bin")));
        assert!(directories.contains(&PathBuf::from("/usr/bin")));
    }

    #[test]
    fn passes_the_tool_path_to_child_processes() {
        let output = hidden_command("/bin/sh")
            .args(["-c", "printf '%s' \"$PATH\""])
            .output()
            .unwrap();

        assert!(output.status.success());
        assert_eq!(
            output.stdout,
            macos_command_path(env::var_os("PATH").as_deref()).as_encoded_bytes()
        );
    }
}
