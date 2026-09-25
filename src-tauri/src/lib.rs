use tauri_plugin_dialog::DialogExt;

/// Webviews silently drop `<a download>` blob links, so the page calls this
/// instead when it runs inside the desktop app. Returns the
/// saved path, or `None` if the user cancelled the dialog.
#[tauri::command]
async fn save_map(
    app: tauri::AppHandle,
    file_name: String,
    contents: String,
) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Save the map in the root of the project you scanned")
        .set_file_name(&file_name)
        .add_filter("Markdown", &["md"])
        .blocking_save_file();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, contents).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Adds the agent rule to `<picked folder>/CLAUDE.md`. An existing file is
/// opened append-only, so nothing already in it can be overwritten; if the
/// rule's heading is already there, the file is left alone. Returns
/// `(path, "created" | "appended" | "already")`, or `None` if cancelled.
#[tauri::command]
async fn save_rule(
    app: tauri::AppHandle,
    rule: String,
) -> Result<Option<(String, &'static str)>, String> {
    let picked = app
        .dialog()
        .file()
        .set_title("Pick the project folder you scanned. The rule goes in its CLAUDE.md")
        .blocking_pick_folder();
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?.join("CLAUDE.md");
    let action = append_rule(&path, &rule)?;
    Ok(Some((path.display().to_string(), action)))
}

/// Create `path` with `rule`, or append it to the end of the existing file
/// (append-only handle, so earlier content can't be touched). Skips the write
/// when the rule's heading line is already present.
fn append_rule(path: &std::path::Path, rule: &str) -> Result<&'static str, String> {
    use std::io::Write;

    if !path.exists() {
        std::fs::write(path, rule).map_err(|e| e.to_string())?;
        return Ok("created");
    }

    let existing = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let heading = rule.lines().next().unwrap_or("").trim();
    if !heading.is_empty() && existing.lines().any(|l| l.trim() == heading) {
        return Ok("already");
    }

    // Match the file's line endings so the appended block doesn't mix them.
    let crlf = existing.contains("\r\n");
    let body = if crlf {
        rule.replace("\r\n", "\n").replace('\n', "\r\n")
    } else {
        rule.to_string()
    };
    let nl = if crlf { "\r\n" } else { "\n" };
    let sep = if existing.is_empty() {
        String::new()
    } else if existing.ends_with('\n') {
        nl.to_string()
    } else {
        format!("{nl}{nl}")
    };

    let mut f = std::fs::OpenOptions::new()
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    f.write_all(format!("{sep}{body}").as_bytes())
        .map_err(|e| e.to_string())?;
    Ok("appended")
}

#[cfg(test)]
mod tests {
    use super::append_rule;

    const RULE: &str = "# Project map: search example.cartograph.md first\n\nRead the map.\n";

    fn tmp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("cartograph-test-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("CLAUDE.md");
        let _ = std::fs::remove_file(&p);
        p
    }

    #[test]
    fn creates_when_missing() {
        let p = tmp("create");
        assert_eq!(append_rule(&p, RULE).unwrap(), "created");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), RULE);
    }

    #[test]
    fn appends_after_existing_content_untouched() {
        let p = tmp("append");
        let original = "# My project\r\n\r\nKeep this exactly.\r\n";
        std::fs::write(&p, original).unwrap();
        assert_eq!(append_rule(&p, RULE).unwrap(), "appended");
        let after = std::fs::read_to_string(&p).unwrap();
        assert!(after.starts_with(original), "original bytes must be a prefix");
        assert!(after.ends_with("Read the map.\r\n"), "CRLF file stays CRLF");
        assert!(!after.replace("\r\n", "").contains('\n'), "no bare LF mixed in");
    }

    #[test]
    fn adds_blank_line_when_file_lacks_trailing_newline() {
        let p = tmp("nonl");
        std::fs::write(&p, "notes").unwrap();
        append_rule(&p, RULE).unwrap();
        assert!(std::fs::read_to_string(&p).unwrap().starts_with("notes\n\n# Project map"));
    }

    #[test]
    fn second_run_is_a_no_op() {
        let p = tmp("twice");
        std::fs::write(&p, "intro\n").unwrap();
        append_rule(&p, RULE).unwrap();
        let once = std::fs::read_to_string(&p).unwrap();
        assert_eq!(append_rule(&p, RULE).unwrap(), "already");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), once);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_map, save_rule])
        .run(tauri::generate_context!())
        .expect("error while running Cartograph");
}
