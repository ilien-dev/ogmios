use std::path::Path;

fn main() {
    place_parakeet();
    tauri_build::build();
}

/// Copy the speech recogniser beside the binary cargo builds, where
/// `stt::engine::library_beside` looks for it. A platform with no library here
/// simply has no voice input.
fn place_parakeet() {
    println!("cargo:rerun-if-changed=vendor/parakeet");
    let triple = std::env::var("TARGET").unwrap_or_default();
    let Ok(out) = std::env::var("OUT_DIR") else {
        return;
    };
    // OUT_DIR is target/<profile>/build/<crate>/out; the binary is three up.
    let Some(target) = Path::new(&out).ancestors().nth(3) else {
        return;
    };
    let from = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("vendor/parakeet")
        .join(triple);
    for entry in std::fs::read_dir(from).into_iter().flatten().flatten() {
        let path = entry.path();
        let shared = path
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| matches!(e, "dll" | "so" | "dylib"));
        if let (true, Some(name)) = (shared, path.file_name()) {
            for dir in [target.to_path_buf(), target.join("deps")] {
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::fs::copy(&path, dir.join(name));
            }
        }
    }
}
