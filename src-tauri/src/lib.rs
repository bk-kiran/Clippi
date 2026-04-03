use arboard::Clipboard;
use std::{
    sync::{Arc, atomic::{AtomicBool, Ordering}},
    thread,
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[tauri::command]
fn set_internal_write(flag: State<Arc<AtomicBool>>) {
    flag.store(true, Ordering::Relaxed);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Run as an accessory (overlay) app: no Dock icon, no Cmd+Tab entry.
            // This also stops macOS from fighting the app when it tries to activate
            // from a global shortcut fired while another app is in the foreground.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Register platform-specific global shortcut to show/hide the window
            #[cfg(target_os = "macos")]
            let shortcut = "Cmd+Shift+V";
            #[cfg(not(target_os = "macos"))]
            let shortcut = "Ctrl+Shift+V";

            app.global_shortcut()
                .on_shortcut(shortcut, |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let visible = window.is_visible().unwrap_or(false);
                            let focused = window.is_focused().unwrap_or(false);

                            // Only dismiss if the window is already in front and active.
                            // Any other state (hidden, visible-but-unfocused) should show it.
                            if visible && focused {
                                let _ = window.hide();
                            } else {
                                // app.show() activates the application process itself
                                // at the macOS level — required under accessory policy
                                // so the window actually comes forward interactively.
                                #[cfg(target_os = "macos")]
                                app.show().unwrap();
                                window.show().unwrap();
                                window.set_always_on_top(true).unwrap();
                                window.set_focus().unwrap();
                            }
                        }
                    }
                })?;

            // System tray with right-click menu
            let open = MenuItemBuilder::with_id("open", "Open Clippi").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(true)
                .build(app)?;

            // Shared flag: frontend sets this before writing to clipboard so the
            // polling thread knows to skip the next change (it was Clippi's own write).
            let internal_write = Arc::new(AtomicBool::new(false));
            app.manage(Arc::clone(&internal_write));

            // Clipboard polling thread — emits "clip-captured" on new text
            let clip_handle = app.handle().clone();
            thread::spawn(move || {
                let mut clipboard = match Clipboard::new() {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("clipboard init failed: {e}");
                        return;
                    }
                };
                let mut last = String::new();
                loop {
                    thread::sleep(Duration::from_millis(500));
                    match clipboard.get_text() {
                        Ok(text) if !text.is_empty() && text != last => {
                            last = text.clone();
                            // If the frontend just wrote this, clear the flag and skip.
                            if internal_write.swap(false, Ordering::Relaxed) {
                                continue;
                            }
                            let _ = clip_handle.emit("clip-captured", text);
                        }
                        _ => {}
                    }
                }
            });

            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let id = event.id().as_ref();
                if id == "open" {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                } else if id == "quit" {
                    handle.exit(0);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![set_internal_write])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
