use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

use chrono::{SecondsFormat, Utc};

use crate::{
    changes::change::{Change, ChangeKind},
    content::normalize_local_markdown,
    providers::git::GitCommands,
    providers::local::reader::LocalReader,
    releases::{
        ArticleBinding, BindingOutput, BindingOutputKind, BindingRevision, BindingRevisionState,
        BindingState, BindingTransition, ContentHash, FileSet, PlannedFile, PlannedFileContents,
        ReleaseBatch, ReleaseOperation, ReleasePlan,
    },
    scopes::scope::Scope,
    shared::errors::{AppError, AppResult},
    sources::source::Source,
    storage::{
        changes::ChangeRepository,
        ledger::{LedgerBatch, LedgerOperation, LedgerRepository, PreviewRecord, SourceTransition},
        scopes::ScopeRepository,
        sources::SourceRepository,
    },
    targets::{Target, TargetState, Template},
    workspace::{Checkout, GitObjectStore},
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
    ledger: &LedgerRepository,
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
    let live_selected = selected
        .iter()
        .filter(|change| !matches!(change.kind, ChangeKind::Deleted))
        .cloned()
        .collect::<Vec<_>>();
    let mut files = build_file_set(&source.path, &input.target, &live_selected)?;
    let batch = ReleaseBatch {
        id: uuid::Uuid::new_v4().to_string(),
        scope_id: scope.id.clone(),
        target_id: input.target.id.clone(),
        change_ids: input.change_ids,
    };
    let snapshots = changes
        .list_snapshots(&scope.id)
        .map_err(|_| AppError::new("storage_error", "Snapshots could not be loaded"))?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let head = GitCommands::commit_sha(checkout.root()).map_err(|_| {
        AppError::new(
            "target_unavailable",
            "The target workspace has no publishable Git commit",
        )
    })?;
    let (target_sequence_before, target_head_before) = ledger
        .target_revision(&input.target.id, &head)
        .map_err(|_| AppError::new("storage_error", "Target release state could not be loaded"))?;
    let (target_sequence_before, _) = if target_head_before == head {
        (target_sequence_before, target_head_before)
    } else {
        ledger
            .observe_target_head(&input.target.id, &head)
            .map_err(|_| {
                AppError::new("storage_error", "Target release state could not be updated")
            })?
    };
    if let Some(active) = ledger
        .active_preview(&input.target.id)
        .map_err(|_| AppError::new("storage_error", "Target release state could not be loaded"))?
    {
        if active.scope_id == scope.id
            && active.change_ids == batch.change_ids
            && active.scope_revision == scope.revision
            && active.target_sequence_before == target_sequence_before
            && active.target_head_before == head
        {
            let operations = ledger.load_operations(&active.id).map_err(|_| {
                AppError::new("storage_error", "Release preview could not be validated")
            })?;
            if !operations.is_empty()
                && append_frozen_deletes(&mut files, &operations).is_ok()
                && validate_frozen_operations(checkout.root(), &files, &operations).is_ok()
            {
                return ReleasePlan::new(
                    active.id.clone(),
                    ReleaseBatch {
                        id: active.id,
                        scope_id: active.scope_id,
                        target_id: active.target_id,
                        change_ids: active.change_ids,
                    },
                    false,
                    &files,
                    checkout.root(),
                );
            }
        }
        return Err(AppError::new(
            "release_preview_conflict",
            "An existing release preview must be confirmed before creating another one",
        ));
    }
    let (bindings, revisions, operations, binding_transitions) = preview_ledger_records(
        ledger,
        &source.path,
        &input.target,
        &selected,
        checkout.root(),
        &head,
    )?;
    append_frozen_deletes(&mut files, &operations)?;
    let source_transitions = selected
        .iter()
        .map(|change| SourceTransition {
            source_identity: change.source_identity.clone(),
            before: snapshots
                .iter()
                .find(|snapshot| snapshot.source_identity == change.source_identity)
                .cloned(),
            after: change.snapshot.clone(),
        })
        .collect();
    ledger
        .create_preview(&PreviewRecord {
            batch: LedgerBatch {
                id: batch.id.clone(),
                scope_id: scope.id.clone(),
                target_id: input.target.id.clone(),
                change_ids: batch.change_ids.clone(),
                scope_revision: scope.revision,
                target_sequence_before,
                target_head_before: head,
                state: crate::releases::BatchState::Previewed,
                created_at: now.clone(),
                previewed_at: Some(now),
                commit_sha: None,
                published_at: None,
                rollback_commit_sha: None,
                rolled_back_at: None,
                failure_code: None,
            },
            bindings,
            revisions,
            operations,
            binding_transitions,
            source_transitions,
        })
        .map_err(|_| {
            AppError::new(
                "release_preview_conflict",
                "The target changed or already has a release preview",
            )
        })?;
    ReleasePlan::new(batch.id.clone(), batch, false, &files, checkout.root())
}

pub(crate) fn append_frozen_deletes(
    files: &mut FileSet,
    operations: &[LedgerOperation],
) -> AppResult<()> {
    for operation in operations {
        if operation.operation.after_hash.is_none() {
            files
                .insert(PlannedFile {
                    path: operation.operation.target_path.clone(),
                    contents: PlannedFileContents::Delete,
                })
                .map_err(|_| {
                    AppError::new(
                        "release_preview_invalidated",
                        "Frozen release operations overlap",
                    )
                })?;
        }
    }
    Ok(())
}

fn preview_ledger_records(
    ledger: &LedgerRepository,
    source_root: &str,
    target: &Target,
    selected: &[Change],
    root: &Path,
    head: &str,
) -> AppResult<(
    Vec<ArticleBinding>,
    Vec<BindingRevision>,
    Vec<LedgerOperation>,
    Vec<BindingTransition>,
)> {
    let objects = GitObjectStore::new(root, head);
    let mut bindings = Vec::new();
    let mut revisions = Vec::new();
    let mut operations = Vec::new();
    let mut transitions = Vec::new();
    for change in selected {
        let binding = ledger
            .binding_for_source(&target.id, &change.source_identity)
            .map_err(|_| AppError::new("storage_error", "Article binding could not be loaded"))?
            .unwrap_or_else(|| ArticleBinding {
                id: uuid::Uuid::new_v4().to_string(),
                target_id: target.id.clone(),
                scope_id: change.scope_id.clone(),
                source_identity: change.source_identity.clone(),
                state: BindingState::Active,
                current_revision: None,
            });
        if matches!(change.kind, ChangeKind::Deleted) && binding.current_revision.is_none() {
            return Err(AppError::new(
                "deleted_change_unpublished",
                "A deleted source has no published target outputs to remove",
            ));
        }
        let files = if matches!(change.kind, ChangeKind::Deleted) {
            FileSet::default()
        } else {
            build_file_set(source_root, target, std::slice::from_ref(change))?
        };
        let revision_id = uuid::Uuid::new_v4().to_string();
        let mut desired = BTreeMap::new();
        for file in files.files() {
            if matches!(file.contents, PlannedFileContents::Delete) {
                continue;
            }
            let after_hash = match &file.contents {
                PlannedFileContents::Text(contents) => ContentHash::from_bytes(contents.as_bytes()),
                PlannedFileContents::Binary(contents) => ContentHash::from_bytes(contents),
                PlannedFileContents::Delete => unreachable!(),
            };
            desired.insert(file.path.clone(), (after_hash, output_kind(&file.path)));
        }
        let previous = binding
            .current_revision
            .as_deref()
            .map(|revision| ledger.revision_outputs(revision))
            .transpose()
            .map_err(|_| AppError::new("storage_error", "Binding outputs could not be loaded"))?;
        let previous = previous.unwrap_or_default();
        if matches!(change.kind, ChangeKind::Deleted) && previous.is_empty() {
            return Err(AppError::new(
                "deleted_change_unpublished",
                "A deleted source has no published target outputs to remove",
            ));
        }
        let previous_by_path = previous
            .iter()
            .map(|output| (output.target_path.clone(), output))
            .collect::<BTreeMap<_, _>>();
        let mut outputs = desired
            .iter()
            .map(|(target_path, (content_hash, kind))| BindingOutput {
                target_path: target_path.clone(),
                content_hash: content_hash.clone(),
                git_blob_sha: None,
                kind: *kind,
            })
            .collect::<Vec<_>>();
        for (path, (after_hash, _)) in &desired {
            match ledger.output_owner(&target.id, path).map_err(|_| {
                AppError::new("storage_error", "Target ownership could not be loaded")
            })? {
                Some(owner) if owner != binding.id => {
                    return Err(AppError::new(
                        "target_path_conflict",
                        format!("Target path is owned by another source: {}", path.display()),
                    ))
                }
                None if objects
                    .blob_at_path(path)
                    .map_err(|_| {
                        AppError::new(
                            "target_file_unreadable",
                            "A target file could not be inspected",
                        )
                    })?
                    .is_some()
                    && !previous_by_path.contains_key(path) =>
                {
                    return Err(AppError::new(
                        "target_path_unowned",
                        format!("Target path is not owned by easyBlog: {}", path.display()),
                    ))
                }
                _ => {}
            }
            let before = objects.blob_at_path(path).map_err(|_| {
                AppError::new(
                    "target_file_unreadable",
                    "A target file could not be inspected",
                )
            })?;
            let before_hash = before
                .as_ref()
                .map(|blob| ContentHash::from_bytes(&blob.bytes));
            if let Some(previous) = previous_by_path.get(path) {
                if before_hash.as_ref() != Some(&previous.content_hash) {
                    return Err(AppError::new(
                        "target_external_change",
                        format!("Target file changed externally: {}", path.display()),
                    ));
                }
            }
            let operation = ReleaseOperation::write(
                path.clone(),
                before_hash,
                after_hash.clone(),
                before.map(|blob| blob.sha),
            );
            operations.push(LedgerOperation {
                id: uuid::Uuid::new_v4().to_string(),
                binding_id: binding.id.clone(),
                ordinal: operations.len() as i64,
                operation,
            });
        }
        for old in previous
            .iter()
            .filter(|old| !desired.contains_key(&old.target_path))
        {
            let before = objects
                .blob_at_path(&old.target_path)
                .map_err(|_| {
                    AppError::new(
                        "target_file_unreadable",
                        "A target file could not be inspected",
                    )
                })?
                .ok_or_else(|| {
                    AppError::new(
                        "target_external_change",
                        format!("Target file is missing: {}", old.target_path.display()),
                    )
                })?;
            let before_hash = ContentHash::from_bytes(&before.bytes);
            if before_hash != old.content_hash {
                return Err(AppError::new(
                    "target_external_change",
                    format!(
                        "Target file changed externally: {}",
                        old.target_path.display()
                    ),
                ));
            }
            operations.push(LedgerOperation {
                id: uuid::Uuid::new_v4().to_string(),
                binding_id: binding.id.clone(),
                ordinal: operations.len() as i64,
                operation: ReleaseOperation::delete(
                    old.target_path.clone(),
                    Some(before_hash),
                    Some(before.sha),
                )?,
            });
        }
        let state = if matches!(change.kind, ChangeKind::Deleted) {
            BindingRevisionState::Deleted
        } else {
            BindingRevisionState::Active
        };
        let revision_number = ledger
            .next_revision_number(&binding.id)
            .map_err(|_| AppError::new("storage_error", "Binding revision could not be created"))?;
        if matches!(state, BindingRevisionState::Deleted) {
            outputs.clear();
        }
        revisions.push(BindingRevision {
            id: revision_id.clone(),
            binding_id: binding.id.clone(),
            revision_number,
            state,
            outputs,
        });
        transitions.push(BindingTransition {
            binding_id: binding.id.clone(),
            before_revision_id: binding.current_revision.clone(),
            after_revision_id: Some(revision_id),
        });
        if binding.current_revision.is_none() {
            bindings.push(binding);
        }
    }
    Ok((bindings, revisions, operations, transitions))
}

fn output_kind(path: &Path) -> BindingOutputKind {
    if path.extension().is_some_and(|extension| extension == "md") {
        BindingOutputKind::Article
    } else {
        BindingOutputKind::Resource
    }
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

pub(crate) fn validate_frozen_operations(
    root: &Path,
    files: &FileSet,
    operations: &[LedgerOperation],
) -> AppResult<()> {
    if files.files().len() != operations.len() {
        return Err(AppError::new(
            "release_preview_invalidated",
            "The generated target files changed after preview",
        ));
    }
    for file in files.files() {
        let operation = operations
            .iter()
            .find(|operation| operation.operation.target_path == file.path)
            .ok_or_else(|| {
                AppError::new(
                    "release_preview_invalidated",
                    "The generated target files changed after preview",
                )
            })?;
        let expected_after = match &file.contents {
            PlannedFileContents::Text(contents) => {
                Some(ContentHash::from_bytes(contents.as_bytes()))
            }
            PlannedFileContents::Binary(contents) => Some(ContentHash::from_bytes(contents)),
            PlannedFileContents::Delete => None,
        };
        if operation.operation.after_hash != expected_after {
            return Err(AppError::new(
                "release_preview_invalidated",
                "The generated target files changed after preview",
            ));
        }
        let actual_before = ContentHash::read(&root.join(&file.path)).map_err(|_| {
            AppError::new(
                "target_file_unreadable",
                "A target file could not be inspected",
            )
        })?;
        if actual_before != operation.operation.before_hash {
            return Err(AppError::new(
                "target_external_change",
                format!("Target file changed externally: {}", file.path.display()),
            ));
        }
    }
    Ok(())
}

fn insert(files: &mut FileSet, file: PlannedFile) -> AppResult<()> {
    files.insert(file).map_err(|_| {
        AppError::new(
            "target_path_conflict",
            "Selected changes generate the same target file",
        )
    })
}
pub(crate) fn checkout_error(error: crate::workspace::CheckoutError) -> AppError {
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
        crate::workspace::CheckoutError::TimedOut => AppError::new(
            "git_timeout",
            "GitHub synchronization timed out. Check your network and try again.",
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
        storage::targets::{ConnectedTarget, TargetRepository},
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
        fs::write(target_root.join(".gitkeep"), "").unwrap();
        git(&target_root, &["add", "."]);
        git(
            &target_root,
            &[
                "-c",
                "user.name=easyBlog test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial",
            ],
        );

        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let ledger = crate::storage::ledger::LedgerRepository::open(&database).unwrap();
        let targets = TargetRepository::open(&database).unwrap();
        let target = Target {
            state: TargetState::Ready,
            adapter: Some(crate::targets::PublishingAdapter::GithubPages),
            ..Target::new("target", &target_root)
        };
        targets
            .insert(&ConnectedTarget {
                target: target.clone(),
                name: "Target".into(),
                created_at: "now".into(),
            })
            .unwrap();
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
            &ledger,
            PreviewReleaseInput {
                scope_id: "scope".into(),
                target,
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
        drop(ledger);
        drop(targets);
        drop(scopes);
        drop(sources);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn resumes_an_unchanged_active_preview() {
        let root = std::env::temp_dir().join(format!("easyblog-preview-{}", uuid::Uuid::new_v4()));
        let source_root = root.join("source");
        let target_root = root.join("target");
        fs::create_dir_all(&source_root).unwrap();
        fs::create_dir_all(target_root.join("_posts")).unwrap();
        fs::create_dir_all(target_root.join("assets/easyblog")).unwrap();
        fs::write(source_root.join("hello.md"), "# Hello\n").unwrap();
        git(&target_root, &["init"]);
        fs::write(target_root.join(".gitkeep"), "").unwrap();
        git(&target_root, &["add", "."]);
        git(
            &target_root,
            &[
                "-c",
                "user.name=easyBlog test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "Initial",
            ],
        );

        let database = root.join("easyblog.sqlite");
        let sources = SourceRepository::open(&database).unwrap();
        let scopes = ScopeRepository::open(&database).unwrap();
        let changes = ChangeRepository::open(&database).unwrap();
        let ledger = crate::storage::ledger::LedgerRepository::open(&database).unwrap();
        let targets = TargetRepository::open(&database).unwrap();
        let target = Target {
            state: TargetState::Ready,
            adapter: Some(crate::targets::PublishingAdapter::GithubPages),
            ..Target::new("target", &target_root)
        };
        targets
            .insert(&ConnectedTarget {
                target: target.clone(),
                name: "Target".into(),
                created_at: "now".into(),
            })
            .unwrap();
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

        let input = || PreviewReleaseInput {
            scope_id: "scope".into(),
            target: target.clone(),
            change_ids: vec!["change".into()],
        };
        let first = execute(&sources, &scopes, &changes, &ledger, input()).unwrap();
        let second = execute(&sources, &scopes, &changes, &ledger, input()).unwrap();

        assert_eq!(second.batch.id, first.batch.id);
        assert_eq!(second.diffs, first.diffs);

        drop(targets);
        drop(ledger);
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

    #[test]
    fn rejects_deleting_a_source_without_published_outputs() {
        let root = std::env::temp_dir().join(format!("easyblog-preview-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let database = root.join("easyblog.sqlite");
        let ledger = crate::storage::ledger::LedgerRepository::open(&database).unwrap();
        let target = Target {
            state: TargetState::Ready,
            adapter: Some(crate::targets::PublishingAdapter::GithubPages),
            ..Target::new("target", &root)
        };
        let change = Change {
            id: "change".into(),
            scope_id: "scope".into(),
            kind: ChangeKind::Deleted,
            source_identity: "deleted.md".into(),
            source_path: "deleted.md".into(),
            previous_path: None,
            title: Some("Deleted".into()),
            selected: true,
            blocked_reason: None,
            snapshot: None,
        };

        let error = preview_ledger_records(&ledger, "source", &target, &[change], &root, "head")
            .unwrap_err();

        assert_eq!(error.code, "deleted_change_unpublished");
        drop(ledger);
        fs::remove_dir_all(root).unwrap();
    }
}
