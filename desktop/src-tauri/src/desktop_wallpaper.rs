use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_WALLPAPER_BYTES: u64 = 64 * 1024 * 1024;

pub fn data_url() -> Result<String, String> {
    let path = wallpaper_path()?;
    let metadata = fs::metadata(&path).map_err(|error| format!("无法读取桌面壁纸信息：{error}"))?;
    if metadata.len() == 0 || metadata.len() > MAX_WALLPAPER_BYTES {
        return Err("桌面壁纸文件尺寸无效".to_string());
    }
    let bytes = fs::read(&path).map_err(|error| format!("无法读取桌面壁纸：{error}"))?;
    let mime_type =
        image_mime_type(&bytes, &path).ok_or_else(|| "不支持当前桌面壁纸格式".to_string())?;
    Ok(format!("data:{mime_type};base64,{}", BASE64.encode(bytes)))
}

#[cfg(windows)]
fn wallpaper_path() -> Result<PathBuf, String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
    };

    let mut buffer = vec![0u16; 32_768];
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buffer.len() as u32,
            Some(buffer.as_mut_ptr().cast()),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .map_err(|error| format!("无法获取桌面壁纸：{error}"))?;
    }
    let length = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    if length == 0 {
        return Err("未找到桌面壁纸".to_string());
    }
    Ok(PathBuf::from(String::from_utf16_lossy(&buffer[..length])))
}

#[cfg(target_os = "macos")]
fn wallpaper_path() -> Result<PathBuf, String> {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSScreen, NSWorkspace};

    let mtm = MainThreadMarker::new().ok_or_else(|| "桌面壁纸只能在主线程读取".to_string())?;
    let screen = NSScreen::mainScreen(mtm).ok_or_else(|| "未找到主显示器".to_string())?;
    let url = NSWorkspace::sharedWorkspace()
        .desktopImageURLForScreen(&screen)
        .ok_or_else(|| "未找到桌面壁纸".to_string())?;
    let path = url.path().ok_or_else(|| "桌面壁纸路径无效".to_string())?;
    Ok(PathBuf::from(path.to_string()))
}

#[cfg(not(any(windows, target_os = "macos")))]
fn wallpaper_path() -> Result<PathBuf, String> {
    Err("当前系统暂不支持提取桌面壁纸".to_string())
}

fn image_mime_type(bytes: &[u8], path: &Path) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("image/png");
    }
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        return Some("image/jpeg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("image/gif");
    }
    if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        return Some("image/webp");
    }
    if bytes.starts_with(b"BM") {
        return Some("image/bmp");
    }
    if bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*") {
        return Some("image/tiff");
    }
    if bytes.get(4..8) == Some(b"ftyp") {
        return match bytes.get(8..12) {
            Some(b"avif") | Some(b"avis") => Some("image/avif"),
            Some(b"heic") | Some(b"heix") | Some(b"hevc") | Some(b"hevx") | Some(b"mif1")
            | Some(b"msf1") => Some("image/heic"),
            _ => None,
        };
    }

    match path
        .extension()?
        .to_string_lossy()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "tif" | "tiff" => Some("image/tiff"),
        "avif" => Some("image/avif"),
        "heic" | "heif" => Some("image/heic"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}
