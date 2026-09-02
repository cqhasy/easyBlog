#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConversionWarning {
    pub code: String,
    pub message: String,
    pub blocks_publication: bool,
}
