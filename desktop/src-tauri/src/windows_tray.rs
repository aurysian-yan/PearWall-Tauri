use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

const OPEN_ITEM_ID: &str = "pearwall-open";
const QUIT_ITEM_ID: &str = "pearwall-quit";

pub fn install(app: &AppHandle) -> Result<(), String> {
    let open_item = MenuItem::with_id(app, OPEN_ITEM_ID, "打开 Pear Wall", true, None::<&str>)
        .map_err(|error| format!("无法创建 Windows 托盘菜单：{error}"))?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| format!("无法创建 Windows 托盘菜单：{error}"))?;
    let quit_item = MenuItem::with_id(app, QUIT_ITEM_ID, "退出 Pear Wall", true, None::<&str>)
        .map_err(|error| format!("无法创建 Windows 托盘菜单：{error}"))?;
    let menu = Menu::with_items(app, &[&open_item, &separator, &quit_item])
        .map_err(|error| format!("无法创建 Windows 托盘菜单：{error}"))?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "无法读取 Windows 托盘图标".to_string())?;

    TrayIconBuilder::with_id("pearwall-main")
        .icon(icon)
        .tooltip("Pear Wall 正在后台运行")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            OPEN_ITEM_ID => show_main_window(app),
            QUIT_ITEM_ID => {
                let _ = pearwall_wallpaper::stop_wallpaper(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        })
        .build(app)
        .map(|_| ())
        .map_err(|error| format!("无法创建 Windows 托盘图标：{error}"))
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}
