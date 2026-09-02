use std::{
    io::Read,
    path::Path,
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

pub const MANAGED_GIT_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitOutput {
    pub stdout: Vec<u8>,
    pub stderr: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitCommandError {
    Unavailable,
    TimedOut,
    Failed {
        arguments: Vec<String>,
        stderr: String,
    },
}

pub struct GitCommands;

impl GitCommands {
    pub fn run(root: &Path, arguments: &[&str]) -> Result<GitOutput, GitCommandError> {
        let mut command = Command::new("git");
        command.args(arguments).current_dir(root);
        let output = run_with_timeout(&mut command, MANAGED_GIT_TIMEOUT)?;
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        if output.status.success() {
            Ok(GitOutput {
                stdout: output.stdout,
                stderr,
            })
        } else {
            Err(GitCommandError::Failed {
                arguments: arguments
                    .iter()
                    .map(|argument| (*argument).into())
                    .collect(),
                stderr,
            })
        }
    }

    pub fn run_output(root: &Path, arguments: &[&str]) -> Result<Output, GitCommandError> {
        let mut command = Command::new("git");
        command.args(arguments).current_dir(root);
        run_with_timeout(&mut command, MANAGED_GIT_TIMEOUT)
    }

    pub fn status_porcelain(root: &Path) -> Result<Vec<u8>, GitCommandError> {
        Ok(Self::run(root, &["status", "--porcelain=v1", "-z"])?.stdout)
    }

    pub fn commit_sha(root: &Path) -> Result<String, GitCommandError> {
        let output = Self::run(root, &["rev-parse", "HEAD"])?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }
}

pub fn run_with_timeout(
    command: &mut Command,
    timeout: Duration,
) -> Result<Output, GitCommandError> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    configure_process_tree(command);
    let mut child = command.spawn().map_err(|_| GitCommandError::Unavailable)?;
    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");
    let stdout_reader = thread::spawn(move || read_all(stdout));
    let stderr_reader = thread::spawn(move || read_all(stderr));
    let deadline = Instant::now() + timeout;

    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| GitCommandError::Unavailable)? {
            break status;
        }
        if Instant::now() >= deadline {
            terminate_process_tree(&mut child);
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err(GitCommandError::TimedOut);
        }
        thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| GitCommandError::Unavailable)?
        .map_err(|_| GitCommandError::Unavailable)?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| GitCommandError::Unavailable)?
        .map_err(|_| GitCommandError::Unavailable)?;
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

#[cfg(unix)]
fn configure_process_tree(command: &mut Command) {
    unsafe {
        command.pre_exec(|| {
            if libc::setpgid(0, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

#[cfg(not(unix))]
fn configure_process_tree(_: &mut Command) {}

#[cfg(unix)]
fn terminate_process_tree(child: &mut std::process::Child) {
    let process_group = -(child.id() as i32);
    unsafe {
        libc::kill(process_group, libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut std::process::Child) {
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(all(not(unix), not(windows)))]
fn terminate_process_tree(child: &mut std::process::Child) {
    let _ = child.kill();
}

fn read_all(mut stream: impl Read) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use std::{process::Command, time::Duration};

    use super::{run_with_timeout, GitCommandError};

    #[test]
    fn terminates_and_reaps_a_timed_out_child() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("powershell");
            command.args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 5"]);
            command
        };

        assert!(matches!(
            run_with_timeout(&mut command, Duration::from_millis(50)),
            Err(GitCommandError::TimedOut)
        ));
    }

    #[test]
    fn terminates_descendants_that_hold_the_output_pipe() {
        let mut command = if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args([
                "/C",
                "start \"\" /B powershell -NoProfile -Command \"Start-Sleep -Seconds 5\" & timeout /T 5 /NOBREAK",
            ]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 5 & wait"]);
            command
        };
        let started = std::time::Instant::now();

        assert!(matches!(
            run_with_timeout(&mut command, Duration::from_millis(50)),
            Err(GitCommandError::TimedOut)
        ));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
