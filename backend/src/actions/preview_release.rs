use std::{collections::BTreeSet, path::Path};

use crate::{
    changes::change::{Change, ChangeKind},
    content::normalize_local_markdown,
    providers::local::reader::LocalReader,
    releases::{FileSet, PlannedFile, PlannedFileContents, ReleaseBatch, ReleasePlan},
    scopes::scope::Scope,
    shared::errors::{AppError, AppResult},
    sources::source::Source,
    storage::{changes::ChangeRepository, scopes::ScopeRepository, sources::SourceRepository},
    targets::{Target, TargetState, Template},
    workspace::Checkout,
};

pub struct PreviewReleaseInput {
    pub scope_id: String,
    pub target: Target,
    pub change_ids: Vec<String>,
}

pub fn execute(
    sources: &SourceRepository,
    scopes: &ScopeRepository,
    changes: &ChangeRepository,
    input: PreviewReleaseInput,
) -> AppResult<ReleasePlan> {
    let scope = scopes
        .get(&input.scope_id)
        .map_err(|_| AppError::new("storage_error", "Scope could not be loaded"))?
        .ok_or_else(|| AppError::new("scope_not_found", "Scope no longer exists"))?;
    validate_scope_target(&scope, &input.target)?;
    if input.target.state != TargetState::Ready || input.target.adapter.is_none() {
        return Err(AppError::new(
            "target_needs_configuration",
            "Configure this publishing target before previewing a release",
        ));
    }
    let available = changes
        .list(&scope.id)
        .map_err(|_| AppError::new("storage_error", "Changes could not be loaded"))?;
    let selected = select_pending_changes(&available, &input.change_ids)?;
    let source = sources
        .get(&scope.source_id)
        .map_err(|_| AppError::new("storage_error", "Source could not be loaded"))?
        .ok_or_else(|| AppError::new("source_not_found", "Source no longer exists"))?;
    validate_publishable_source(&source)?;
    let checkout = Checkout::acquire(&input.target).map_err(checkout_error)?;
    let files = build_file_set(&source.path, &input.target, &selected)?;
    let batch = ReleaseBatch {
        id: uuid::Uuid::new_v4().to_string(),
        scope_id: scope.id,
        target_id: input.target.id.clone(),
        change_ids: input.change_ids,
    };
    ReleasePlan::new(batch.id.clone(), batch, false, &files, checkout.root())
}

pub(crate) fn validate_scope_target(scope: &Scope, target: &Target) -> AppResult<()> {
    let target_id = scope.target_id.as_deref().ok_or_else(|| {
        AppError::new("scope_needs_target", "This scope needs a publishing target")
    })?;
    if target_id != target.id {
        return Err(AppError::new(
            "target_mismatch",
            "The selected target does not match this scope",
        ));
    }
    Ok(())
}

pub(crate) fn validate_publishable_source(source: &Source) -> AppResult<()> {
    if source.r#type == "local_directory" {
        Ok(())
    } else {
        Err(AppError::new(
            "unsupported_source",
            "This source type cannot be published yet",
        ))
    }
}

fn requested_changes(change_ids: &[String]) -> AppResult<BTreeSet<String>> {
    if change_ids.is_empty() {
        return Err(AppError::new(
            "empty_release_batch",
            "Choose at least one change before previewing",
        ));
    }
    let requested = BTreeSet::from_iter(change_ids.iter().cloned());
    if requested.len() != change_ids.len() {
        return Err(AppError::new(
            "duplicate_change_selection",
            "Choose each change at most once before previewing",
        ));
    }
    Ok(requested)
}

pub(crate) fn select_pending_changes(
    available: &[Change],
    change_ids: &[String],
) -> AppResult<Vec<Change>> {
    let requested = requested_changes(change_ids)?;
    let selected = available
        .iter()
        .filter(|change| requested.contains(&change.id))
        .cloned()
        .collect::<Vec<_>>();
    if selected.len() != requested.len() {
        return Err(AppError::new(
            "change_not_found",
            "A selected change is no longer pending",
        ));
    }
    if selected
        .iter()
        .any(|change| matches!(change.kind, ChangeKind::Blocked))
    {
        return Err(AppError::new(
            "blocked_change",
            "Blocked changes cannot be published",
        ));
    }
    Ok(selected)
}

pub(crate) fn build_file_set(
    source_root: &str,
    target: &Target,
    changes: &[Change],
) -> AppResult<FileSet> {
    let reader = LocalReader::new(source_root)
        .map_err(|_| AppError::new("not_readable", "Source directory cannot be read"))?;
    let template = Template::new(
        target.adapter.clone().ok_or_else(|| {
            AppError::new(
                "target_needs_configuration",
                "Configure this publishing target before previewing a release",
            )
        })?,
        target.layout.clone(),
    );
    let mut files = FileSet::default();
    for change in changes {
        if matches!(change.kind, ChangeKind::Deleted) {
            let title = change.title.as_deref().ok_or_else(|| {
                AppError::new("missing_title", "A deleted article has no known title")
            })?;
            let slug = crate::targets::slug(title).ok_or_else(|| {
                AppError::new(
                    "invalid_slug",
                    "An article title cannot become a target filename",
                )
            })?;
            insert(
                &mut files,
                PlannedFile {
                    path: target.layout.article_path(&slug),
                    contents: PlannedFileContents::Delete,
                },
            )?;
            continue;
        }
        let local = reader
            .read_file(Path::new(&change.source_path))
            .map_err(|_| AppError::new("not_readable", "Selected source content cannot be read"))?;
        let article = normalize_local_markdown(change.source_identity.clone(), &local.content)
            .map_err(|_| {
                AppError::new(
                    "invalid_content",
                    "Selected source content cannot be normalized",
                )
            })?;
        let rendered = template.render_article(&article).map_err(|_| {
            AppError::new(
                "invalid_article",
                "Selected article cannot be rendered for this target",
            )
        })?;
        insert(
            &mut files,
            PlannedFile {
                path: rendered.path,
                contents: PlannedFileContents::Text(rendered.markdown),
            },
        )?;
        for resource in template
            .render_resources(&rendered.slug, &article.resources)
            .map_err(|_| {
                AppError::new(
                    "invalid_resource",
                    "A referenced resource cannot be rendered",
                )
            })?
        {
            let contents = reader
                .read_bytes(Path::new(&resource.source_path))
                .map_err(|_| {
                    AppError::new("not_readable", "A referenced resource cannot be read")
                })?;
            insert(
                &mut files,
                PlannedFile {
                    path: resource.target_path,
                    contents: PlannedFileContents::Binary(contents),
                },
            )?;
        }
    }
    Ok(files)
}

fn insert(files: &mut FileSet, file: PlannedFile) -> AppResult<()> {
    files.insert(file).map_err(|_| {
        AppError::new(
            "target_path_conflict",
            "Selected changes generate the same target file",
        )
    })
}
fn checkout_error(error: crate::workspace::CheckoutError) -> AppError {
    match error {
        crate::workspace::CheckoutError::WorkingTree(
            crate::workspace::WorkingTreeError::Dirty { .. },
        ) => AppError::new("workspace_dirty", "The target workspace has external edits"),
        crate::workspace::CheckoutError::Lock(_) => AppError::new(
            "workspace_busy",
            "Another target operation is already running",
        ),
        crate::workspace::CheckoutError::Synchronization => AppError::new(
            "workspace_needs_recovery",
            "The GitHub repository changed in a way easyBlog cannot update safely",
        ),
        _ => AppError::new("target_unavailable", "The publishing target is not ready"),
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, process::Command};

    use crate::{
        changes::change::{Change, ChangeKind},
        scopes::scope::{Scope, ScopeLifecycle},
        sources::source::Source,
    };

    use super::*;

    fn git(root: &Path, arguments: &[&str]) {
        let output = Command::new("git")
            .args(arguments)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn previews_configured_articles_and_resources_without_writing() {
        let root = std::env::temp_dir().join(format!("easyblog-preview-{}", uuid::Uuid::new_v4()));
        let source_root = root.join("source");
        let target_root = root.join("target");
        fs::create_dir_all(source_root.join("media")).unwrap();
        fs::create_dir_all(target_root.join("_posts")).unwrap();
        fs::create_dir_all(target_root.join("assets/easyblog")).unwrap();
        fs::write(
            source_root.join("hello.md"),
            "# Hello\n![cover](media/cover.png)\n",
        )
        .unwrap();
        fs::write(source_root.join("media/cover.png"), [1_u8, 2, 3]).unwrap();
        git(&target_root, &["init"]);

        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        sources
            .insert(&Source {
                id: "source".into(),
                path: source_root.to_string_lossy().into_owned(),
                name: "Content".into(),
                r#type: "local_directory".into(),
                created_at: "now".into(),
            })
            .unwrap();
        scopes
            .save(
                &Scope {
                    id: "scope".into(),
                    source_id: "source".into(),
                    target_id: Some("target".into()),
                    name: "Posts".into(),
                    lifecycle: ScopeLifecycle::Active,
                    revision: 1,
                    selections: vec![],
                    include_patterns: vec![],
                    exclude_patterns: vec![],
                    created_at: "now".into(),
                    updated_at: "now".into(),
                },
                None,
            )
            .unwrap();
        changes
            .replace(
                "scope",
                "now",
                &[Change {
                    id: "change".into(),
                    scope_id: "scope".into(),
                    kind: ChangeKind::Added,
                    source_identity: "hello.md".into(),
                    source_path: "hello.md".into(),
                    previous_path: None,
                    title: Some("Hello".into()),
                    selected: true,
                    blocked_reason: None,
                    snapshot: None,
                }],
            )
            .unwrap();

        let plan = execute(
            &sources,
            &scopes,
            &changes,
            PreviewReleaseInput {
                scope_id: "scope".into(),
                target: Target {
                    state: TargetState::Ready,
                    adapter: Some(crate::targets::PublishingAdapter::GithubPages),
                    ..Target::new("target", &target_root)
                },
                change_ids: vec!["change".into()],
            },
        )
        .unwrap();

        assert_eq!(
            plan.status,
            crate::releases::ReleasePreviewStatus::AwaitingConfirmation
        );
        assert!(!plan.needs_configuration);
        assert_eq!(
            plan.diffs
                .iter()
                .map(|diff| diff.path.to_string_lossy().replace('\\', "/"))
                .collect::<Vec<_>>(),
            vec!["_posts/hello.md", "assets/easyblog/hello/cover.png"]
        );
        assert!(plan
            .diffs
            .iter()
            .any(|diff| diff.patch.contains("title: \"Hello\"")));
        assert!(plan
            .diffs
            .iter()
            .any(|diff| diff.patch == "Binary file (3 bytes)\n"));
        assert!(!target_root.join("_posts/hello.md").exists());
        assert!(crate::workspace::WorkingTree::require_clean(&target_root).is_ok());

        drop(changes);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn distinguishes_empty_and_duplicate_change_selections() {
        let empty = requested_changes(&[]).unwrap_err();
        assert_eq!(empty.code, "empty_release_batch");
        assert_eq!(
            empty.message,
            "Choose at least one change before previewing"
        );

        let duplicate = requested_changes(&["change".into(), "change".into()]).unwrap_err();
        assert_eq!(duplicate.code, "duplicate_change_selection");
        assert_eq!(
            duplicate.message,
            "Choose each change at most once before previewing"
        );
    }
}
