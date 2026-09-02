use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GithubRepository {
    pub repository: String,
    pub visibility: GithubRepositoryVisibility,
    pub default_branch: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GithubRepositoryVisibility {
    Public,
    Private,
}

#[derive(Debug, Deserialize)]
struct ApiRepository {
    full_name: String,
    private: bool,
    default_branch: String,
    description: Option<String>,
    permissions: ApiPermissions,
}
#[derive(Debug, Deserialize)]
struct ApiPermissions {
    push: bool,
}

pub fn list_pushable() -> Result<Vec<GithubRepository>, GithubRepositoryError> {
    let output = Command::new("gh")
        .args([
            "api",
            "--paginate",
            "--slurp",
            "user/repos?affiliation=owner,collaborator,organization&per_page=100",
        ])
        .output()
        .map_err(|_| GithubRepositoryError::Unavailable)?;
    if !output.status.success() {
        return Err(GithubRepositoryError::Failed);
    }
    parse_pushable(&output.stdout)
}

fn parse_pushable(response: &[u8]) -> Result<Vec<GithubRepository>, GithubRepositoryError> {
    let pages: Vec<Vec<ApiRepository>> =
        serde_json::from_slice(response).map_err(|_| GithubRepositoryError::InvalidResponse)?;
    let mut repositories = pages
        .into_iter()
        .flatten()
        .into_iter()
        .filter(|repo| repo.permissions.push)
        .map(|repo| GithubRepository {
            repository: repo.full_name,
            visibility: if repo.private {
                GithubRepositoryVisibility::Private
            } else {
                GithubRepositoryVisibility::Public
            },
            default_branch: repo.default_branch,
            description: repo.description.filter(|value| !value.trim().is_empty()),
        })
        .collect::<Vec<_>>();
    repositories
        .sort_by(|left, right| sort_key(&left.repository).cmp(&sort_key(&right.repository)));
    Ok(repositories)
}

fn sort_key(repository: &str) -> (u8, String) {
    let name = repository
        .rsplit('/')
        .next()
        .unwrap_or(repository)
        .to_ascii_lowercase();
    let priority = if name.ends_with(".github.io") {
        0
    } else if name.contains("blog") {
        1
    } else {
        2
    };
    (priority, repository.to_ascii_lowercase())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GithubRepositoryError {
    Unavailable,
    Failed,
    InvalidResponse,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_likely_blogs_first() {
        assert!(sort_key("me/me.github.io") < sort_key("team/blog-site"));
        assert!(sort_key("team/blog-site") < sort_key("team/docs"));
    }

    #[test]
    fn parses_each_page_and_keeps_only_pushable_repositories() {
        let repositories = parse_pushable(
            br#"[
                [
                    {"full_name":"team/docs","private":false,"default_branch":"main","description":"Docs","permissions":{"push":false}},
                    {"full_name":"me/me.github.io","private":false,"default_branch":"main","description":" Personal blog ","permissions":{"push":true}}
                ],
                [
                    {"full_name":"team/blog-site","private":true,"default_branch":"trunk","description":"","permissions":{"push":true}}
                ]
            ]"#,
        )
        .unwrap();

        assert_eq!(repositories.len(), 2);
        assert_eq!(repositories[0].repository, "me/me.github.io");
        assert_eq!(
            repositories[0].visibility,
            GithubRepositoryVisibility::Public
        );
        assert_eq!(
            repositories[0].description.as_deref(),
            Some(" Personal blog ")
        );
        assert_eq!(repositories[1].repository, "team/blog-site");
        assert_eq!(
            repositories[1].visibility,
            GithubRepositoryVisibility::Private
        );
        assert_eq!(repositories[1].default_branch, "trunk");
        assert_eq!(repositories[1].description, None);
    }
}
