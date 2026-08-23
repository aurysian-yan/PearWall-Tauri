use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use windows::core::{Error, RuntimeType, HRESULT};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::{DataReader, IRandomAccessStreamWithContentType};
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};
use windows_future::{AsyncStatus, IAsyncOperation};

use crate::{MediaArtwork, MediaArtworkState};

const MAX_ARTWORK_BYTES: u64 = 16 * 1024 * 1024;
const MEDIA_POLL_INTERVAL: Duration = Duration::from_secs(1);
const EMPTY_MEDIA_CONFIRMATIONS: u8 = 2;
const ASYNC_POLL_INTERVAL: Duration = Duration::from_millis(10);
const ASYNC_TIMEOUT: Duration = Duration::from_secs(2);

struct WinRtGuard;

impl WinRtGuard {
    fn new() -> windows::core::Result<Self> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
        Ok(Self)
    }
}

impl Drop for WinRtGuard {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

pub fn start(current: Arc<Mutex<MediaArtwork>>) {
    let _ = thread::Builder::new()
        .name("pearwall-media".to_string())
        .spawn(move || media_worker(current));
}

pub fn get_media_artwork(
    state: &MediaArtworkState,
    current_key: Option<&str>,
) -> Result<MediaArtwork, String> {
    let mut current = state
        .current
        .lock()
        .map_err(|_| "媒体封面状态不可用".to_string())?
        .clone();

    if current_key == Some(current.key.as_str()) {
        current.data_url = None;
    }
    Ok(current)
}

fn media_worker(current: Arc<Mutex<MediaArtwork>>) {
    let Ok(_winrt) = WinRtGuard::new() else {
        return;
    };
    let mut manager = None;
    let mut empty_media_count = 0u8;

    loop {
        if manager.is_none() {
            manager = request_manager().ok();
        }

        if let Some(active_manager) = manager.as_ref() {
            match read_current_media(active_manager) {
                Ok(mut media) => {
                    if let Ok(mut cached) = current.lock() {
                        if media.key.is_empty() {
                            empty_media_count = empty_media_count.saturating_add(1);
                            if empty_media_count >= EMPTY_MEDIA_CONFIRMATIONS {
                                *cached = media;
                            }
                        } else {
                            empty_media_count = 0;
                            retain_cached_artwork(&mut media, &cached);
                            *cached = media;
                        }
                    }
                }
                Err(_) => manager = None,
            }
        }

        thread::sleep(MEDIA_POLL_INTERVAL);
    }
}

fn retain_cached_artwork(media: &mut MediaArtwork, cached: &MediaArtwork) {
    if media.data_url.is_some()
        || cached.data_url.is_none()
        || media_identity(&media.key) != media_identity(&cached.key)
    {
        return;
    }

    media.key = cached.key.clone();
    media.data_url = cached.data_url.clone();
}

fn media_identity(key: &str) -> &str {
    key.rsplit_once('\u{1e}')
        .map_or(key, |(identity, _)| identity)
}

fn request_manager() -> windows::core::Result<GlobalSystemMediaTransportControlsSessionManager> {
    wait_for_operation(GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?)
}

fn read_current_media(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> windows::core::Result<MediaArtwork> {
    let Ok(session) = manager.GetCurrentSession() else {
        return Ok(MediaArtwork::default());
    };

    let properties = wait_for_operation(session.TryGetMediaPropertiesAsync()?)?;
    let title = properties.Title()?.to_string_lossy();
    let artist = properties.Artist()?.to_string_lossy();
    let album = properties.AlbumTitle()?.to_string_lossy();
    let source = session.SourceAppUserModelId()?.to_string_lossy();
    let status = session.GetPlaybackInfo()?.PlaybackStatus()?;
    let playing = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
    let data_url = properties
        .Thumbnail()
        .ok()
        .and_then(|thumbnail| read_thumbnail(&thumbnail).ok());
    let key = format!(
        "{}\u{1e}{}",
        [source, title, artist, album].join("\u{1f}"),
        data_url.is_some()
    );

    Ok(MediaArtwork {
        key,
        data_url,
        playing,
    })
}

fn read_thumbnail(
    reference: &windows::Storage::Streams::IRandomAccessStreamReference,
) -> windows::core::Result<String> {
    let stream = wait_for_operation(reference.OpenReadAsync()?)?;
    let size = stream.Size()?;
    if size == 0 || size > MAX_ARTWORK_BYTES {
        return Err(Error::new(
            HRESULT(0x80070057u32 as i32),
            "媒体封面尺寸无效",
        ));
    }

    let input = stream.GetInputStreamAt(0)?;
    let reader = DataReader::CreateDataReader(&input)?;
    let loaded = wait_for_operation(reader.LoadAsync(size as u32)?)?;
    if loaded == 0 {
        return Err(Error::new(
            HRESULT(0x80070057u32 as i32),
            "媒体封面内容为空",
        ));
    }
    let mut bytes = vec![0; loaded as usize];
    reader.ReadBytes(&mut bytes)?;
    let content_type = stream_content_type(&stream).unwrap_or_else(|| sniff_content_type(&bytes));
    let _ = reader.Close();
    let _ = stream.Close();

    Ok(format!(
        "data:{content_type};base64,{}",
        BASE64.encode(bytes)
    ))
}

fn wait_for_operation<T: RuntimeType>(operation: IAsyncOperation<T>) -> windows::core::Result<T> {
    let started = Instant::now();
    loop {
        let status = operation.Status()?;
        if status == AsyncStatus::Completed {
            let result = operation.GetResults();
            let _ = operation.Close();
            return result;
        }
        if status == AsyncStatus::Canceled || status == AsyncStatus::Error {
            let result = operation.GetResults();
            let _ = operation.Close();
            return result;
        }
        if started.elapsed() >= ASYNC_TIMEOUT {
            let _ = operation.Cancel();
            return Err(Error::new(
                HRESULT(0x800705B4u32 as i32),
                "Windows 媒体操作超时",
            ));
        }
        thread::sleep(ASYNC_POLL_INTERVAL);
    }
}

fn stream_content_type(stream: &IRandomAccessStreamWithContentType) -> Option<String> {
    let value = stream.ContentType().ok()?.to_string_lossy();
    let value = value.trim().to_ascii_lowercase();
    matches!(
        value.as_str(),
        "image/jpeg" | "image/png" | "image/webp" | "image/gif"
    )
    .then_some(value)
}

fn sniff_content_type(bytes: &[u8]) -> String {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png".to_string()
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg".to_string()
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp".to_string()
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif".to_string()
    } else {
        "image/png".to_string()
    }
}
