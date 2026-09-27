//! The recogniser, reached through parakeet.cpp's flat C ABI.
//!
//! Loaded at run time rather than linked, so building Ogmios needs no `CMake` or
//! C++ toolchain; `vendor/parakeet/README.md` says how the library was built.
//! Voice input exists where the library sits beside the binary and nowhere else.
//!
//! This is the only module allowed `unsafe`, and every block is a call across
//! the boundary. The ABI's rules, kept here so nothing else has to know them:
//!
//! - a returned `char*` is malloc'd and ours to free with `free_string`;
//! - a NULL return means failure and `last_error` says why, in the context's own
//!   buffer, valid only until the next call on it;
//! - nothing throws: the C++ side promises no exception crosses.
#![allow(unsafe_code)]

use std::ffi::{c_char, c_float, c_int, c_void, CStr, CString};
use std::path::{Path, PathBuf};

use libloading::{Library, Symbol};

use super::audio::RATE;
use crate::error::{Error, Result};

/// The oldest ABI with the `_lang` entry points this uses.
const ABI_FLOOR: c_int = 3;

/// Decoder selection: 0 is "whichever head this model prefers".
const DECODER_DEFAULT: c_int = 0;

type FnAbiVersion = unsafe extern "C" fn() -> c_int;
type FnLoad = unsafe extern "C" fn(*const c_char) -> *mut c_void;
type FnFree = unsafe extern "C" fn(*mut c_void);
type FnLastError = unsafe extern "C" fn(*mut c_void) -> *const c_char;
type FnFreeString = unsafe extern "C" fn(*mut c_char);
type FnTranscribePcmLang = unsafe extern "C" fn(
    *mut c_void,
    *const c_float,
    c_int,
    c_int,
    c_int,
    *const c_char,
) -> *mut c_char;

/// Every symbol used, resolved once at load.
struct Api {
    free: FnFree,
    last_error: FnLastError,
    free_string: FnFreeString,
    transcribe_pcm_lang: FnTranscribePcmLang,
}

/// The library's file name on this platform.
const LIBRARY: &str = if cfg!(target_os = "windows") {
    "parakeet.dll"
} else if cfg!(target_os = "macos") {
    "libparakeet.dylib"
} else {
    "libparakeet.so"
};

/// Where the library sits beside the running binary, if it is there at all.
///
/// `build.rs` puts it there in development and the bundler in a release.
/// `None` is not an error: it is a platform without voice input yet.
pub fn library_beside(exe: &Path) -> Option<PathBuf> {
    let beside = exe.parent()?.join(LIBRARY);
    beside.is_file().then_some(beside)
}

/// A loaded model, and the library it came out of.
pub struct Engine {
    /// Kept alive because every function pointer in `api` lives inside it.
    _library: Library,
    api: Api,
    ctx: *mut c_void,
}

// SAFETY: the context is a plain pointer, so not `Send` by default. It is only
// ever used behind `&mut self`, and `Dictation` keeps the engine in a mutex, so
// one thread at a time touches it. Nothing hands the pointer out.
unsafe impl Send for Engine {}

impl Engine {
    /// Open `library` and load `gguf` with it.
    pub fn open(library: &Path, gguf: &Path) -> Result<Engine> {
        // SAFETY: loading a library runs its initialisers, which is why this is
        // unsafe. The path is beside our own binary, put there by the build.
        let lib = unsafe { Library::new(library) }
            .map_err(|e| Error::Stt(format!("the speech engine would not load: {e}")))?;

        // SAFETY: `Engine` owns `lib`, so the resolved pointers never outlive it.
        let api = unsafe { resolve(&lib) }?;

        // SAFETY: `abi_version` takes nothing and returns an int.
        let version = unsafe {
            let f: Symbol<FnAbiVersion> = lib
                .get(b"parakeet_capi_abi_version\0")
                .map_err(|e| Error::Stt(format!("the speech engine is incomplete: {e}")))?;
            f()
        };
        if version < ABI_FLOOR {
            return Err(Error::Stt(format!(
                "the speech engine is too old: ABI {version}, this needs {ABI_FLOOR}"
            )));
        }

        let path = CString::new(gguf.to_string_lossy().as_bytes())
            .map_err(|_| Error::Stt("that model's path cannot be used".into()))?;

        // SAFETY: `load` takes a NUL-terminated path and returns an owning
        // pointer or NULL. `path` outlives the call.
        let ctx = unsafe {
            let f: Symbol<FnLoad> = lib
                .get(b"parakeet_capi_load\0")
                .map_err(|e| Error::Stt(format!("the speech engine is incomplete: {e}")))?;
            f(path.as_ptr())
        };
        if ctx.is_null() {
            return Err(Error::Stt(
                "the speech model would not load; try downloading it again".into(),
            ));
        }

        Ok(Engine {
            _library: lib,
            api,
            ctx,
        })
    }

    /// Transcribe a whole 16 kHz mono recording at once.
    pub fn transcribe(&mut self, pcm: &[f32], language: &str) -> Result<String> {
        let lang = CString::new(language)
            .map_err(|_| Error::Stt("that language cannot be used".into()))?;

        // SAFETY: `pcm` and `lang` are live for the duration of the call, and the
        // length is clamped to an int so it can never wrap negative.
        let text = unsafe {
            (self.api.transcribe_pcm_lang)(
                self.ctx,
                pcm.as_ptr(),
                clamp_len(pcm.len()),
                c_int::try_from(RATE).unwrap_or(c_int::MAX),
                DECODER_DEFAULT,
                lang.as_ptr(),
            )
        };

        if text.is_null() {
            return Err(Error::Stt(self.why("the speech engine stopped")));
        }

        // SAFETY: a non-NULL return is a malloc'd NUL-terminated string that is
        // ours to free with the library's own `free_string`, once, here.
        let said = unsafe {
            let out = CStr::from_ptr(text).to_string_lossy().into_owned();
            (self.api.free_string)(text);
            out
        };
        Ok(said)
    }

    /// What the library said went wrong, or `fallback` where it said nothing.
    fn why(&self, fallback: &str) -> String {
        // SAFETY: the pointer is owned by the context and valid until the next
        // call on it; it is copied here before anything else touches it.
        let said = unsafe {
            let p = (self.api.last_error)(self.ctx);
            if p.is_null() {
                String::new()
            } else {
                CStr::from_ptr(p).to_string_lossy().into_owned()
            }
        };
        if said.is_empty() {
            fallback.to_string()
        } else {
            said
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: the context came from `load` and is freed once, here.
        unsafe { (self.api.free)(self.ctx) };
    }
}

/// A sample count as a C `int`, saturating rather than wrapping negative.
fn clamp_len(len: usize) -> c_int {
    c_int::try_from(len).unwrap_or(c_int::MAX)
}

/// Resolve every symbol, so a library missing one fails at load.
///
/// # Safety
///
/// The caller must keep `lib` alive while the returned pointers are used.
unsafe fn resolve(lib: &Library) -> Result<Api> {
    macro_rules! sym {
        ($name:literal, $ty:ty) => {{
            let found: Symbol<$ty> = lib.get($name).map_err(|e| {
                Error::Stt(format!(
                    "the speech engine is missing {}: {e}",
                    String::from_utf8_lossy(&$name[..$name.len() - 1])
                ))
            })?;
            *found
        }};
    }

    Ok(Api {
        free: sym!(b"parakeet_capi_free\0", FnFree),
        last_error: sym!(b"parakeet_capi_last_error\0", FnLastError),
        free_string: sym!(b"parakeet_capi_free_string\0", FnFreeString),
        transcribe_pcm_lang: sym!(b"parakeet_capi_transcribe_pcm_lang\0", FnTranscribePcmLang),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_library_means_no_voice_input() {
        let dir = tempfile::tempdir().unwrap();
        assert!(library_beside(&dir.path().join("ogmios")).is_none());
    }

    #[test]
    fn a_library_beside_the_binary_is_found() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(LIBRARY), b"not really a library").unwrap();
        assert_eq!(
            library_beside(&dir.path().join("ogmios")),
            Some(dir.path().join(LIBRARY))
        );
    }

    #[test]
    fn something_that_is_not_a_library_fails_with_a_sentence() {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join(LIBRARY);
        std::fs::write(&fake, b"not really a library").unwrap();
        let error = Engine::open(&fake, &dir.path().join("model.gguf"))
            .err()
            .unwrap();
        assert_eq!(error.kind(), "stt");
    }

    #[test]
    fn an_impossible_sample_count_saturates() {
        assert_eq!(clamp_len(8), 8);
        assert_eq!(clamp_len(usize::MAX), c_int::MAX);
    }
}
