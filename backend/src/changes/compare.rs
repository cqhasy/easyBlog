use std::collections::{BTreeMap, BTreeSet};

use crate::changes::change::{Change, ChangeKind};
use crate::tracking::snapshot::Snapshot;

pub fn compare(scope_id: &str, previous: &[Snapshot], current: &[Snapshot]) -> Vec<Change> {
    let previous_by_identity = previous
        .iter()
        .map(|snapshot| (snapshot.source_identity.as_str(), snapshot))
        .collect::<BTreeMap<_, _>>();
    let current_by_identity = current
        .iter()
        .map(|snapshot| (snapshot.source_identity.as_str(), snapshot))
        .collect::<BTreeMap<_, _>>();
    let mut handled_previous = BTreeSet::new();
    let mut changes = Vec::new();

    for snapshot in current {
        if let Some(previous) = previous_by_identity.get(snapshot.source_identity.as_str()) {
            handled_previous.insert(previous.source_identity.as_str());
            if previous.fingerprint != snapshot.fingerprint {
                changes.push(change(scope_id, ChangeKind::Updated, snapshot, None, true));
            }
            continue;
        }
        if let Some(previous) = previous.iter().find(|previous| {
            !handled_previous.contains(previous.source_identity.as_str())
                && previous.fingerprint == snapshot.fingerprint
        }) {
            handled_previous.insert(previous.source_identity.as_str());
            changes.push(change(
                scope_id,
                ChangeKind::Moved,
                snapshot,
                Some(previous.source_path.clone()),
                true,
            ));
        } else {
            changes.push(change(scope_id, ChangeKind::Added, snapshot, None, true));
        }
    }

    for snapshot in previous {
        if !current_by_identity.contains_key(snapshot.source_identity.as_str())
            && !handled_previous.contains(snapshot.source_identity.as_str())
        {
            changes.push(change(scope_id, ChangeKind::Deleted, snapshot, None, false));
        }
    }
    changes.sort_by(|left, right| left.source_path.cmp(&right.source_path));
    changes
}

fn change(
    scope_id: &str,
    kind: ChangeKind,
    snapshot: &Snapshot,
    previous_path: Option<String>,
    selected: bool,
) -> Change {
    Change {
        id: format!(
            "{}:{}:{}",
            scope_id, snapshot.source_identity, snapshot.fingerprint
        ),
        scope_id: scope_id.to_owned(),
        kind,
        source_identity: snapshot.source_identity.clone(),
        source_path: snapshot.source_path.clone(),
        previous_path,
        title: snapshot.title.clone(),
        selected,
        blocked_reason: None,
        snapshot: Some(snapshot.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(identity: &str, path: &str, fingerprint: &str) -> Snapshot {
        Snapshot {
            scope_id: "scope".into(),
            source_identity: identity.into(),
            source_path: path.into(),
            title: None,
            fingerprint: fingerprint.into(),
            observed_at: "now".into(),
        }
    }

    #[test]
    fn identifies_add_update_move_and_delete_without_unchanged_entries() {
        let previous = vec![
            snapshot("same.md", "same.md", "one"),
            snapshot("old.md", "old.md", "move"),
            snapshot("gone.md", "gone.md", "gone"),
        ];
        let current = vec![
            snapshot("same.md", "same.md", "two"),
            snapshot("new.md", "new.md", "move"),
            snapshot("fresh.md", "fresh.md", "fresh"),
        ];
        let changes = compare("scope", &previous, &current);
        assert!(changes
            .iter()
            .any(|change| change.kind == ChangeKind::Added));
        assert!(changes
            .iter()
            .any(|change| change.kind == ChangeKind::Updated));
        assert!(changes.iter().any(|change| change.kind == ChangeKind::Moved
            && change.previous_path.as_deref() == Some("old.md")));
        assert!(changes
            .iter()
            .any(|change| change.kind == ChangeKind::Deleted && !change.selected));
    }
}
