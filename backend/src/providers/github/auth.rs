use std::{
    io,
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubAuthStatus {
    Ready { login: Option<String> },
    MissingCli,
    Unauthenticated,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubAuthError {
    MissingCli,
    LoginFailed,
    GitCredentialSetupFailed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GithubLoginStatus {
    Pending,
    Ready,
    Failed,
}

const DEVICE_CODE_WAIT_TIMEOUT: Duration = Duration::from_secs(15);
const GITHUB_DEVICE_AUTHORIZATION_URL: &str = "https://github.com/login/device";
const GITHUB_LOGIN_ARGUMENTS: [&str; 8] = [
    "auth",
    "login",
    "--hostname",
    "github.com",
    "--web",
    "--clipboard",
    "--git-protocol",
    "https",
];

trait GithubLoginLauncher {
    fn launch(&self, arguments: &[&str]) -> io::Result<String>;
}

struct SystemGithubLoginLauncher {
    attempt_id: u64,
}

impl GithubLoginLauncher for SystemGithubLoginLauncher {
    fn launch(&self, arguments: &[&str]) -> io::Result<String> {
        let mut child = Command::new("gh")
            .args(arguments)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("GH_FORCE_TTY", "120")
            .env("NO_COLOR", "1")
            .spawn()?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("GitHub CLI standard output is unavailable"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| io::Error::other("GitHub CLI standard error is unavailable"))?;
        let device_code = read_device_code(stdout, stderr)?;
        monitor_login_completion(child, self.attempt_id);
        Ok(device_code)
    }
}

trait GithubBrowserLauncher {
    fn open(&self, url: &str) -> io::Result<()>;
}

struct SystemGithubBrowserLauncher;

impl GithubBrowserLauncher for SystemGithubBrowserLauncher {
    fn open(&self, url: &str) -> io::Result<()> {
        #[cfg(target_os = "windows")]
        {
            return open_with_windows_shell(url);
        }

        #[cfg(target_os = "macos")]
        {
            return Command::new("open").arg(url).spawn().map(|_child| ());
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        {
            return Command::new("xdg-open").arg(url).spawn().map(|_child| ());
        }

        #[cfg(not(any(target_os = "windows", unix)))]
        {
            let _ = url;
            Err(io::Error::other(
                "Opening a browser is not supported on this platform",
            ))
        }
    }
}

#[cfg(target_os = "windows")]
fn open_with_windows_shell(url: &str) -> io::Result<()> {
    use std::{
        ffi::{c_void, OsStr},
        os::windows::ffi::OsStrExt,
        ptr,
    };

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show_command: i32,
        ) -> isize;
    }

    fn to_wide_null(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect()
    }

    let operation = to_wide_null("open");
    let target = to_wide_null(url);
    let result = unsafe {
        ShellExecuteW(
            ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            ptr::null(),
            ptr::null(),
            1,
        )
    };

    if result > 32 {
        Ok(())
    } else {
        Err(io::Error::other(format!(
            "Windows could not open the default browser (ShellExecuteW returned {result})"
        )))
    }
}

pub struct GithubAuth;

impl GithubAuth {
    pub fn status() -> GithubAuthStatus {
        let output = match Command::new("gh")
            .args(["auth", "status", "--hostname", "github.com"])
            .output()
        {
            Ok(output) => output,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return GithubAuthStatus::MissingCli;
            }
            Err(_) => return GithubAuthStatus::Unavailable,
        };
        if output.status.success() {
            GithubAuthStatus::Ready {
                login: parse_login(&String::from_utf8_lossy(&output.stdout)),
            }
        } else {
            GithubAuthStatus::Unauthenticated
        }
    }

    pub fn start_login() -> Result<String, GithubAuthError> {
        let attempt_id = login_tracker()
            .lock()
            .expect("GitHub login tracker lock should not be poisoned")
            .start();
        let launcher = SystemGithubLoginLauncher { attempt_id };
        let result = start_login_with(&launcher, &SystemGithubBrowserLauncher);
        if result.is_err() {
            complete_login_attempt(attempt_id, GithubLoginAttemptOutcome::Failed);
        }
        result
    }

    pub fn login_status() -> GithubLoginStatus {
        login_tracker()
            .lock()
            .expect("GitHub login tracker lock should not be poisoned")
            .status()
    }

    pub fn setup_git_credentials() -> Result<(), GithubAuthError> {
        let status = Command::new("gh")
            .args(["auth", "setup-git", "--hostname", "github.com"])
            .status()
            .map_err(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    GithubAuthError::MissingCli
                } else {
                    GithubAuthError::GitCredentialSetupFailed
                }
            })?;
        if status.success() {
            Ok(())
        } else {
            Err(GithubAuthError::GitCredentialSetupFailed)
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum GithubLoginAttemptOutcome {
    Ready,
    Failed,
}

#[derive(Debug)]
struct GithubLoginAttempt {
    id: u64,
    status: GithubLoginStatus,
}

#[derive(Default)]
struct GithubLoginTracker {
    next_attempt_id: u64,
    active_attempt: Option<GithubLoginAttempt>,
}

impl GithubLoginTracker {
    fn start(&mut self) -> u64 {
        self.next_attempt_id += 1;
        self.active_attempt = Some(GithubLoginAttempt {
            id: self.next_attempt_id,
            status: GithubLoginStatus::Pending,
        });
        self.next_attempt_id
    }

    fn complete(&mut self, attempt_id: u64, outcome: GithubLoginAttemptOutcome) {
        if let Some(attempt) = &mut self.active_attempt {
            if attempt.id == attempt_id {
                attempt.status = match outcome {
                    GithubLoginAttemptOutcome::Ready => GithubLoginStatus::Ready,
                    GithubLoginAttemptOutcome::Failed => GithubLoginStatus::Failed,
                };
            }
        }
    }

    fn status(&self) -> GithubLoginStatus {
        self.active_attempt
            .as_ref()
            .map(|attempt| attempt.status.clone())
            .unwrap_or(GithubLoginStatus::Failed)
    }
}

fn login_tracker() -> &'static Mutex<GithubLoginTracker> {
    static TRACKER: OnceLock<Mutex<GithubLoginTracker>> = OnceLock::new();
    TRACKER.get_or_init(|| Mutex::new(GithubLoginTracker::default()))
}

fn monitor_login_completion(mut child: Child, attempt_id: u64) {
    thread::spawn(move || {
        let outcome = match child.wait() {
            Ok(status) if status.success() => GithubLoginAttemptOutcome::Ready,
            Ok(_) | Err(_) => GithubLoginAttemptOutcome::Failed,
        };
        complete_login_attempt(attempt_id, outcome);
    });
}

fn complete_login_attempt(attempt_id: u64, outcome: GithubLoginAttemptOutcome) {
    login_tracker()
        .lock()
        .expect("GitHub login tracker lock should not be poisoned")
        .complete(attempt_id, outcome);
}

fn start_login_with(
    login_launcher: &impl GithubLoginLauncher,
    browser_launcher: &impl GithubBrowserLauncher,
) -> Result<String, GithubAuthError> {
    let device_code = login_launcher
        .launch(&GITHUB_LOGIN_ARGUMENTS)
        .map_err(|error| {
            if error.kind() == io::ErrorKind::NotFound {
                GithubAuthError::MissingCli
            } else {
                GithubAuthError::LoginFailed
            }
        })?;
    let _ = browser_launcher.open(GITHUB_DEVICE_AUTHORIZATION_URL);
    Ok(device_code)
}

fn read_device_code(
    stdout: impl io::Read + Send + 'static,
    stderr: impl io::Read + Send + 'static,
) -> io::Result<String> {
    let (sender, receiver) = mpsc::channel();
    forward_output(stdout, sender.clone());
    forward_output(stderr, sender);
    let mut output = String::new();

    loop {
        let chunk =
            receiver
                .recv_timeout(DEVICE_CODE_WAIT_TIMEOUT)
                .map_err(|error| match error {
                    mpsc::RecvTimeoutError::Timeout => io::Error::new(
                        io::ErrorKind::TimedOut,
                        "GitHub device code was not provided",
                    ),
                    mpsc::RecvTimeoutError::Disconnected => {
                        io::Error::other("GitHub CLI stopped before providing a device code")
                    }
                })?;
        output.push_str(&chunk);
        if output.len() > 8_192 {
            let retained = output.split_off(output.len() - 4_096);
            output = retained;
        }
        if let Some(device_code) = parse_device_code(&output) {
            return Ok(device_code);
        }
    }
}

fn forward_output(mut reader: impl io::Read + Send + 'static, sender: mpsc::Sender<String>) {
    thread::spawn(move || {
        let mut buffer = [0; 1_024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(bytes_read) => {
                    let output = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
                    if sender.send(output).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

fn parse_device_code(output: &str) -> Option<String> {
    let code = ["one-time code:", "One-time code ("]
        .iter()
        .find_map(|marker| {
            output.find(marker).and_then(|start| {
                output[start + marker.len()..]
                    .trim_start()
                    .split(|character: char| character == ')' || character.is_whitespace())
                    .next()
            })
        })?;
    if code.len() == 9
        && code.as_bytes().get(4) == Some(&b'-')
        && code
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 4 || byte.is_ascii_uppercase() || byte.is_ascii_digit())
    {
        Some(code.to_owned())
    } else {
        None
    }
}

fn parse_login(status: &str) -> Option<String> {
    let marker = "account ";
    let start = status.find(marker)? + marker.len();
    status[start..]
        .split_whitespace()
        .next()
        .map(|login| {
            login
                .trim_matches(|character| character == '(' || character == ')')
                .to_owned()
        })
        .filter(|login| !login.is_empty())
}

#[cfg(test)]
mod tests {
    use std::{cell::RefCell, io};

    use super::{
        parse_device_code, parse_login, start_login_with, GithubAuthError, GithubBrowserLauncher,
        GithubLoginAttemptOutcome, GithubLoginLauncher, GithubLoginStatus, GithubLoginTracker,
        GITHUB_DEVICE_AUTHORIZATION_URL,
    };

    struct FakeGithubLoginLauncher {
        launches: RefCell<Vec<Vec<String>>>,
        failure: Option<io::ErrorKind>,
        device_code: String,
    }

    impl Default for FakeGithubLoginLauncher {
        fn default() -> Self {
            Self {
                launches: RefCell::default(),
                failure: None,
                device_code: "534D-B889".into(),
            }
        }
    }

    impl FakeGithubLoginLauncher {
        fn with_failure(failure: io::ErrorKind) -> Self {
            Self {
                launches: RefCell::default(),
                failure: Some(failure),
                device_code: "534D-B889".into(),
            }
        }
    }

    impl GithubLoginLauncher for FakeGithubLoginLauncher {
        fn launch(&self, arguments: &[&str]) -> io::Result<String> {
            self.launches.borrow_mut().push(
                arguments
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>(),
            );
            match self.failure {
                Some(kind) => Err(io::Error::from(kind)),
                None => Ok(self.device_code.clone()),
            }
        }
    }

    #[derive(Default)]
    struct FakeGithubBrowserLauncher {
        opened_urls: RefCell<Vec<String>>,
    }

    impl GithubBrowserLauncher for FakeGithubBrowserLauncher {
        fn open(&self, url: &str) -> io::Result<()> {
            self.opened_urls.borrow_mut().push(url.to_owned());
            Ok(())
        }
    }

    #[test]
    fn extracts_the_cli_reported_account_from_standard_output() {
        assert_eq!(
            parse_login("github.com\n  ✓ Logged in to github.com account octocat (keyring)\n"),
            Some("octocat".into())
        );
        assert_eq!(parse_login("not logged in"), None);
    }

    #[test]
    fn extracts_the_one_time_device_code_from_github_cli_output() {
        assert_eq!(
            parse_device_code("! First copy your one-time code: 534D-B889"),
            Some("534D-B889".into())
        );
        assert_eq!(
            parse_device_code("! One-time code (DD3B-5D0D) copied to clipboard"),
            Some("DD3B-5D0D".into())
        );
        assert_eq!(
            parse_device_code("First copy your one-time code: ignored"),
            None
        );
        assert_eq!(parse_device_code("GitHub CLI output"), None);
    }

    #[test]
    fn starts_github_authorization_and_returns_the_device_code() {
        let launcher = FakeGithubLoginLauncher::default();
        let browser = FakeGithubBrowserLauncher::default();

        assert_eq!(
            start_login_with(&launcher, &browser),
            Ok("534D-B889".into())
        );
        assert_eq!(
            *launcher.launches.borrow(),
            vec![vec![
                "auth".to_owned(),
                "login".to_owned(),
                "--hostname".to_owned(),
                "github.com".to_owned(),
                "--web".to_owned(),
                "--clipboard".to_owned(),
                "--git-protocol".to_owned(),
                "https".to_owned(),
            ]]
        );
        assert_eq!(
            *browser.opened_urls.borrow(),
            vec![GITHUB_DEVICE_AUTHORIZATION_URL.to_owned()]
        );
    }

    #[test]
    fn reports_a_missing_github_cli_when_login_cannot_start() {
        let launcher = FakeGithubLoginLauncher::with_failure(io::ErrorKind::NotFound);
        let browser = FakeGithubBrowserLauncher::default();

        assert_eq!(
            start_login_with(&launcher, &browser),
            Err(GithubAuthError::MissingCli)
        );
    }

    #[test]
    fn ignores_completion_from_an_older_github_login_attempt() {
        let mut tracker = GithubLoginTracker::default();
        let first_attempt = tracker.start();
        let current_attempt = tracker.start();

        tracker.complete(first_attempt, GithubLoginAttemptOutcome::Ready);

        assert_eq!(tracker.status(), GithubLoginStatus::Pending);
        tracker.complete(current_attempt, GithubLoginAttemptOutcome::Ready);
        assert_eq!(tracker.status(), GithubLoginStatus::Ready);
    }
}
