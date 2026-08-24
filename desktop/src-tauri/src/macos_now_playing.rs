use super::MediaArtwork;
use std::ffi::{c_char, CStr};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PERL_LOADER: &str = r#"
use strict;
use warnings;
use DynaLoader;
my $library = shift @ARGV or die "missing library";
my $symbol_name = shift @ARGV or die "missing symbol";
my $handle = DynaLoader::dl_load_file($library, 0) or die DynaLoader::dl_error();
my $symbol = DynaLoader::dl_find_symbol($handle, $symbol_name) or die "missing symbol";
my $function = DynaLoader::dl_install_xsub("main::$symbol_name", $symbol);
&$function();
"#;

#[link(name = "pearwall_macos_now_playing", kind = "static")]
extern "C" {
    fn pearwall_copy_now_playing_json() -> *mut c_char;
    fn pearwall_free_c_string(value: *mut c_char);
}

pub fn get_media_artwork(current_key: Option<&str>) -> Result<MediaArtwork, String> {
    let media = get_media_artwork_via_system_host().or_else(|_| get_media_artwork_direct())?;
    write_shared_cache(&media);
    Ok(without_repeated_data(media, current_key))
}

fn get_media_artwork_direct() -> Result<MediaArtwork, String> {
    let pointer = unsafe { pearwall_copy_now_playing_json() };
    if pointer.is_null() {
        return Err("无法读取系统正在播放信息".to_string());
    }
    let json = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { pearwall_free_c_string(pointer) };
    serde_json::from_str(&json).map_err(|_| "系统媒体信息格式无效".to_string())
}

fn get_media_artwork_via_system_host() -> Result<MediaArtwork, String> {
    let library = media_remote_library().ok_or_else(|| "找不到系统媒体适配器".to_string())?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let output_path = std::env::temp_dir().join(format!(
        "pearwall-media-{}-{nonce}.json",
        std::process::id()
    ));
    let result = (|| {
        let output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&output_path)
            .map_err(|_| "无法创建系统媒体输出文件".to_string())?;
        let mut child = Command::new("/usr/bin/perl")
            .args(["-e", PERL_LOADER])
            .arg(library)
            .arg("pearwall_print_now_playing_json")
            .stdout(Stdio::from(output))
            .stderr(Stdio::null())
            .spawn()
            .map_err(|_| "无法启动系统媒体适配器".to_string())?;
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut successful = false;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    successful = status.success();
                    break;
                }
                Ok(None) if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
            }
        }
        let data = fs::read(&output_path).map_err(|_| "无法读取系统媒体输出".to_string())?;
        if data.is_empty() {
            return Err("系统媒体适配器没有返回数据".to_string());
        }
        let media =
            serde_json::from_slice(&data).map_err(|_| "系统媒体信息格式无效".to_string())?;
        if !successful && data == b"null\n" {
            return Err("系统媒体适配器执行失败".to_string());
        }
        Ok(media)
    })();
    let _ = fs::remove_file(output_path);
    result
}

fn media_remote_library() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(contents) = executable.parent().and_then(|path| path.parent()) {
            candidates.push(
                contents
                    .join("Resources")
                    .join("mediaremote")
                    .join("PearWallMediaRemote.dylib"),
            );
        }
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("mediaremote")
            .join("PearWallMediaRemote.dylib"),
    );
    candidates.into_iter().find(|path| path.is_file())
}

fn without_repeated_data(mut media: MediaArtwork, current_key: Option<&str>) -> MediaArtwork {
    if current_key == Some(media.key.as_str()) {
        media.data_url = None;
    }
    media
}

fn write_shared_cache(media: &MediaArtwork) {
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let directory = PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("PearWall");
    if fs::create_dir_all(&directory).is_err() {
        return;
    }
    let value = serde_json::json!({
        "key": &media.key,
        "data_url": &media.data_url,
        "playing": media.playing,
        "updated_at_milliseconds": SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    });
    let Ok(data) = serde_json::to_vec(&value) else {
        return;
    };
    let path = directory.join("media-artwork.json");
    let temporary = directory.join(format!(".media-artwork-{}.tmp", std::process::id()));
    if fs::write(&temporary, data).is_err() {
        return;
    }
    let _ = fs::set_permissions(&temporary, fs::Permissions::from_mode(0o600));
    let _ = fs::rename(temporary, path);
}
