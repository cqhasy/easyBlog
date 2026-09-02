pub mod layout;
pub mod target;
pub mod target_check;
pub mod template;

pub use layout::{LayoutError, PagesLayout};
pub use target::Target;
pub use target_check::{check, TargetCheck, TargetCheckError};
pub use template::{slug, RenderedArticle, RenderedResource, Template, TemplateError};
