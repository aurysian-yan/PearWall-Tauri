use super::MediaArtwork;
use crate::macos_runtime_state;
use std::ffi::{c_char, CStr};
use std::fs::{self, OpenOptions};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
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

#[derive(Default)]
struct MediaMetadataResolver {
    identity: String,
    artwork_key: String,
    first_title: String,
    latest_raw_title: String,
    title_is_volatile: bool,
}

impl MediaMetadataResolver {
    fn resolve(&mut self, mut media: MediaArtwork) -> MediaArtwork {
        media.raw_title = media.title.clone();
        media.raw_artist = media.artist.clone();
        let identity = media_identity(&media);
        if identity != self.identity {
            self.identity = identity;
            self.artwork_key.clear();
            self.first_title = media.title.clone();
            self.latest_raw_title = media.title.clone();
            self.title_is_volatile = false;
        } else if !media.title.trim().is_empty() && media.title != self.latest_raw_title {
            self.latest_raw_title = media.title.clone();
            self.title_is_volatile = true;
        }

        if source_uses_lyric_title(&media.source_bundle_id) {
            self.title_is_volatile = true;
        }
        if self.title_is_volatile {
            if let Some((title, artist)) = split_combined_artist(&media.artist) {
                media.title = title;
                media.artist = artist;
            } else if !self.first_title.trim().is_empty() {
                media.title = self.first_title.clone();
            }
        }
        if media
            .data_url
            .as_deref()
            .is_some_and(|source| !source.trim().is_empty())
        {
            self.artwork_key = media.key.clone();
        } else if !self.artwork_key.is_empty() {
            media.key = self.artwork_key.clone();
        }
        media.track_id = macos_runtime_state::stable_track_id(&media);
        media
    }
}

static MEDIA_METADATA_RESOLVER: OnceLock<Mutex<MediaMetadataResolver>> = OnceLock::new();

#[link(name = "pearwall_macos_now_playing", kind = "static")]
extern "C" {
    fn pearwall_copy_now_playing_json() -> *mut c_char;
    fn pearwall_free_c_string(value: *mut c_char);
    fn pearwall_copy_display_uuid(display_id: u32) -> *mut c_char;
}

pub fn display_uuid(display_id: u32) -> Option<String> {
    let pointer = unsafe { pearwall_copy_display_uuid(display_id) };
    if pointer.is_null() {
        return None;
    }
    let value = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe { pearwall_free_c_string(pointer) };
    (!value.is_empty()).then_some(value)
}

pub fn get_media_artwork(current_key: Option<&str>) -> Result<MediaArtwork, String> {
    let raw_media = get_media_artwork_via_system_host().or_else(|_| get_media_artwork_direct())?;
    let mut media = MEDIA_METADATA_RESOLVER
        .get_or_init(|| Mutex::new(MediaMetadataResolver::default()))
        .lock()
        .map(|mut resolver| resolver.resolve(raw_media.clone()))
        .unwrap_or(raw_media);
    if media.track_id == 0 {
        media.track_id = macos_runtime_state::stable_track_id(&media);
    }
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

fn media_identity(media: &MediaArtwork) -> String {
    if !media.identifier.trim().is_empty() {
        return format!(
            "{}\u{1f}{}",
            media.source_bundle_id.trim().to_lowercase(),
            media.identifier.trim()
        );
    }
    format!(
        "{}\u{1f}{}\u{1f}{}\u{1f}{}\u{1f}{}",
        media.source_bundle_id.trim().to_lowercase(),
        media.title.trim().to_lowercase(),
        media.artist.trim().to_lowercase(),
        media.album.trim().to_lowercase(),
        media.duration.round()
    )
}

fn split_combined_artist(value: &str) -> Option<(String, String)> {
    let (title, artist) = value.rsplit_once(" · ")?;
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() || artist.is_empty() {
        return None;
    }
    Some((title.to_string(), artist.to_string()))
}

fn source_uses_lyric_title(bundle_identifier: &str) -> bool {
    matches!(bundle_identifier.trim(), "azki.moye.MeloX.desktop")
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
        "identifier": &media.identifier,
        "source_bundle_id": &media.source_bundle_id,
        "raw_title": &media.raw_title,
        "raw_artist": &media.raw_artist,
        "track_id": media.track_id,
        "title": &media.title,
        "artist": &media.artist,
        "album": &media.album,
        "duration": media.duration,
        "elapsed": media.elapsed,
        "playback_rate": media.playback_rate,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn media(identifier: &str, title: &str, artist: &str, duration: f64) -> MediaArtwork {
        MediaArtwork {
            identifier: identifier.to_string(),
            source_bundle_id: "com.example.player".to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: "测试专辑".to_string(),
            duration,
            ..MediaArtwork::default()
        }
    }

    #[test]
    fn volatile_title_uses_combined_track_metadata() {
        let mut resolver = MediaMetadataResolver::default();
        let first = resolver.resolve(media("123", "第一句歌词", "真实歌名 · 歌手", 200.0));
        let second = resolver.resolve(media("123", "第二句歌词", "真实歌名 · 歌手", 200.0));
        assert_eq!(first.title, "第一句歌词");
        assert_eq!(second.title, "真实歌名");
        assert_eq!(second.artist, "歌手");
        assert_eq!(first.track_id, second.track_id);
    }

    #[test]
    fn melox_metadata_is_canonicalized_on_first_sample() {
        let mut resolver = MediaMetadataResolver::default();
        let mut sample = media("123", "当前歌词", "真实歌名 · 歌手", 200.0);
        sample.source_bundle_id = "azki.moye.MeloX.desktop".to_string();
        let resolved = resolver.resolve(sample);
        assert_eq!(resolved.title, "真实歌名");
        assert_eq!(resolved.artist, "歌手");
        assert_eq!(resolved.raw_title, "当前歌词");
    }

    #[test]
    fn missing_artwork_sample_keeps_the_current_artwork_key() {
        let mut resolver = MediaMetadataResolver::default();
        let mut available = media("123", "歌曲", "歌手", 200.0);
        available.key = "123|42".to_string();
        available.data_url = Some("data:image/jpeg;base64,AA==".to_string());
        let resolved = resolver.resolve(available);
        assert_eq!(resolved.key, "123|42");

        let mut missing = media("123", "歌曲", "歌手", 200.0);
        missing.key = "123|0".to_string();
        let resolved = resolver.resolve(missing);
        assert_eq!(resolved.key, "123|42");
        assert!(resolved.data_url.is_none());

        let mut next_track = media("456", "下一首", "歌手", 180.0);
        next_track.key = "456|0".to_string();
        let resolved = resolver.resolve(next_track);
        assert_eq!(resolved.key, "456|0");
    }
}
