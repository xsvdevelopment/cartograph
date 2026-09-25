fn main() {
    // Declaring app commands generates `allow-<command>` permissions; pages
    // loaded from a remote URL (our dev server) need one granted explicitly.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["save_map", "save_rule"])),
    )
    .expect("failed to run tauri-build");
}
