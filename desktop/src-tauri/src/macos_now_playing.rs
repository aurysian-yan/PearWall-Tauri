use super::MediaArtwork;
use std::ffi::{c_char, CStr};
use std::path::PathBuf;
use std::process::Command;

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

extern "C" {
    fn pearwall_copy_now_playing_json() -> *mut c_char;
    fn pearwall_free_c_string(value: *mut c_char);
}

pub fn get_media_artwork(current_key: Option<&str>) -> Result<MediaArtwork, String> {
    if let Ok(media) = get_media_artwork_via_system_host() {
        return Ok(without_repeated_data(media, current_key));
    }

    let pointer = unsafe { pearwall_copy_now_playing_json() };
    if pointer.is_null() {
        return Err("无法读取系统正在播放信息".to_string());
    }
    let json = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { pearwall_free_c_string(pointer) };
    let media: MediaArtwork =
        serde_json::from_str(&json).map_err(|_| "系统媒体信息格式无效".to_string())?;
    Ok(without_repeated_data(media, current_key))
}

fn get_media_artwork_via_system_host() -> Result<MediaArtwork, String> {
    let library = media_remote_library().ok_or_else(|| "找不到系统媒体适配器".to_string())?;
    let output = Command::new("/usr/bin/perl")
        .args(["-e", PERL_LOADER])
        .arg(library)
        .arg("pearwall_print_now_playing_json")
        .output()
        .map_err(|_| "无法启动系统媒体适配器".to_string())?;
    if !output.status.success() {
        return Err("系统媒体适配器执行失败".to_string());
    }
    serde_json::from_slice(&output.stdout).map_err(|_| "系统媒体信息格式无效".to_string())
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
