//! Fetching a model and proving it arrived intact.
//!
//! Addresses come only from the compiled-in catalogue. Each file streams to
//! `<name>.part`, hashed on the way, and takes its real name only once the
//! length and SHA-256 match — so a file under the real name is always whole,
//! and "downloaded" can be a size check.
//!
//! [`receive`] takes any `Read`, which lets the checksum and progress logic be
//! tested against a `Cursor` with no network.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::catalogue::{File, Model};
use crate::error::{Error, Result};

/// Read size between progress reports.
const CHUNK: usize = 256 * 1024;

/// At most this often a progress event goes to the window.
const REPORT_EVERY: Duration = Duration::from_millis(100);

/// `<data_dir>/models/<id>/<file>`.
pub fn path_of(data_dir: &Path, model: &Model, file: &File) -> PathBuf {
    data_dir.join("models").join(&model.id).join(&file.name)
}

/// Every file on disk at the promised size. Size, not checksum: the checksum
/// was verified when the file was written, and re-hashing 700 MB to draw a list
/// would take seconds.
pub fn is_downloaded(data_dir: &Path, model: &Model) -> bool {
    model.files.iter().all(|file| {
        std::fs::metadata(path_of(data_dir, model, file)).is_ok_and(|m| m.len() == file.bytes)
    })
}

/// Fetch every file of `model` that is not already here, calling `on_progress`
/// with (received, total) bytes across the whole model.
pub fn download(
    data_dir: &Path,
    model: &Model,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<()> {
    let total = model.bytes();
    let mut done = 0u64;
    let mut last = Instant::now();
    on_progress(0, total);

    for file in &model.files {
        let path = path_of(data_dir, model, file);
        if std::fs::metadata(&path).is_ok_and(|m| m.len() == file.bytes) {
            done += file.bytes;
            continue;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let part = path.with_extension("part");

        let received = open(&file.url).and_then(|mut body| {
            receive(&mut body, &part, file, |bytes| {
                if last.elapsed() >= REPORT_EVERY {
                    last = Instant::now();
                    on_progress(done + bytes, total);
                }
            })
        });
        if let Err(error) = received {
            let _ = std::fs::remove_file(&part);
            return Err(error);
        }
        std::fs::rename(&part, &path)?;
        done += file.bytes;
    }

    on_progress(total, total);
    Ok(())
}

/// Stream `file` out of `reader` into `part`, hashing as it goes, and refuse
/// it if the bytes are not the ones the catalogue named. `on_progress` gets the
/// running total for this file.
pub fn receive(
    reader: &mut impl Read,
    part: &Path,
    file: &File,
    mut on_progress: impl FnMut(u64),
) -> Result<()> {
    let mut sink = std::fs::File::create(part)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; CHUNK];
    let mut written = 0u64;

    loop {
        let read = reader.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
        sink.write_all(&buffer[..read])?;
        written += read as u64;
        on_progress(written);
    }
    sink.flush()?;

    // Length first: a short body is worth a retry, and saying so helps.
    if written != file.bytes {
        return Err(Error::Stt(format!(
            "the download was cut short ({written} of {} bytes); try again",
            file.bytes
        )));
    }
    if format!("{:x}", digest.finalize()) != file.sha256 {
        return Err(Error::Stt(format!(
            "{} did not arrive intact and was discarded",
            file.name
        )));
    }
    Ok(())
}

fn open(url: &str) -> Result<impl Read> {
    let response = agent()
        .get(url)
        .call()
        .map_err(|e| Error::Stt(format!("could not reach the model server: {e}")))?;
    Ok(response.into_body().into_reader())
}

/// One client, told explicitly to trust the OS certificate store. Enabling
/// ureq's `platform-verifier` feature alone is not enough: with no roots
/// configured it panics on the first handshake.
fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        // Losing this race means someone else installed a provider, which is fine.
        let _ = rustls::crypto::ring::default_provider().install_default();
        ureq::Agent::config_builder()
            .tls_config(
                ureq::tls::TlsConfig::builder()
                    .provider(ureq::tls::TlsProvider::Rustls)
                    .root_certs(ureq::tls::RootCerts::PlatformVerifier)
                    .build(),
            )
            .build()
            .new_agent()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// sha256 of `b"hello"`.
    const HELLO: &str = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";

    fn a_file(bytes: u64, sha256: &str) -> File {
        File {
            name: "model.gguf".into(),
            url: "https://example.invalid/model.gguf".into(),
            sha256: sha256.into(),
            bytes,
        }
    }

    #[test]
    fn a_whole_file_with_the_right_checksum_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("model.part");
        receive(&mut Cursor::new(b"hello"), &part, &a_file(5, HELLO), |_| {}).unwrap();
        assert_eq!(std::fs::read(part).unwrap(), b"hello");
    }

    #[test]
    fn a_wrong_checksum_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let error = receive(
            &mut Cursor::new(b"hello"),
            &dir.path().join("model.part"),
            &a_file(5, &"ab".repeat(32)),
            |_| {},
        )
        .unwrap_err();
        assert_eq!(error.kind(), "stt");
        assert!(
            error.to_string().contains("did not arrive intact"),
            "{error}"
        );
    }

    #[test]
    fn a_short_body_says_so_rather_than_blaming_the_checksum() {
        let dir = tempfile::tempdir().unwrap();
        let error = receive(
            &mut Cursor::new(b"hello"),
            &dir.path().join("model.part"),
            &a_file(500, HELLO),
            |_| {},
        )
        .unwrap_err();
        assert!(error.to_string().contains("cut short"), "{error}");
    }

    #[test]
    fn progress_reaches_the_whole_file() {
        let dir = tempfile::tempdir().unwrap();
        let size = CHUNK * 2 + 7;
        let mut seen = Vec::new();
        let _ = receive(
            &mut Cursor::new(vec![7u8; size]),
            &dir.path().join("model.part"),
            &a_file(size as u64, &"ef".repeat(32)),
            |bytes| seen.push(bytes),
        );
        assert_eq!(seen, vec![CHUNK as u64, (CHUNK * 2) as u64, size as u64]);
    }

    #[test]
    fn downloaded_means_every_file_at_its_promised_size() {
        let dir = tempfile::tempdir().unwrap();
        let model = Model {
            id: "tiny".into(),
            name: "Tiny".into(),
            languages: vec!["en".into()],
            hint: "en".into(),
            files: vec![a_file(5, HELLO)],
        };
        assert!(!is_downloaded(dir.path(), &model));

        let path = path_of(dir.path(), &model, &model.files[0]);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"hel").unwrap();
        assert!(
            !is_downloaded(dir.path(), &model),
            "a short file is not downloaded"
        );

        std::fs::write(&path, b"hello").unwrap();
        assert!(is_downloaded(dir.path(), &model));
        // Already here: nothing is fetched, and progress still completes.
        let mut last = (0, 0);
        download(dir.path(), &model, |r, t| last = (r, t)).unwrap();
        assert_eq!(last, (5, 5));
    }
}
