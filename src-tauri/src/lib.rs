use arboard::Clipboard;
use std::{thread, time::Duration};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // Register platform-specific global shortcut to show/hide the window
            #[cfg(target_os = "macos")]
            let shortcut = "Cmd+Shift+V";
            #[cfg(not(target_os = "macos"))]
            let shortcut = "Ctrl+Shift+V";

            app.global_shortcut()
                .on_shortcut(shortcut, |app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                                #[cfg(target_os = "macos")]
                                unsafe {
                                    use objc::{class, msg_send, sel, sel_impl, runtime::Object};
                                    let cls = class!(NSApplication);
                                    let ns_app: *mut Object = msg_send![cls, sharedApplication];
                                    let _: () = msg_send![ns_app, activateIgnoringOtherApps: objc::runtime::YES];
                                }
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
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
