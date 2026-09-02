pub fn validate_patterns(patterns: &[String]) -> bool {
    patterns.iter().all(|pattern| {
        !pattern.trim().is_empty()
            && !pattern.contains('\\')
            && !pattern.starts_with('/')
            && !pattern.split('/').any(|part| part == "..")
    })
}
