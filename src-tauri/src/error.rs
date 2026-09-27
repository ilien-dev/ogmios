//! The one error type every command returns. It reaches the webview as
//! `{ kind, message }`, matching `CommandError` in `shared/domain.ts`.

use serde::ser::SerializeStruct;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Provider(String),
    #[error("{0}")]
    Stt(String),
    #[error("database: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Internal(String),
}

impl Error {
    pub fn kind(&self) -> &'static str {
        match self {
            Error::Invalid(_) => "invalid",
            Error::NotFound(_) => "notFound",
            Error::Provider(_) => "provider",
            Error::Stt(_) => "stt",
            Error::Database(_) => "database",
            Error::Io(_) => "io",
            Error::Json(_) | Error::Internal(_) => "internal",
        }
    }
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        let mut s = serializer.serialize_struct("CommandError", 2)?;
        s.serialize_field("kind", self.kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_kind_and_message() {
        let json =
            serde_json::to_string(&Error::NotFound("no such session".into())).expect("serializes");
        assert_eq!(json, r#"{"kind":"notFound","message":"no such session"}"#);
    }
}
