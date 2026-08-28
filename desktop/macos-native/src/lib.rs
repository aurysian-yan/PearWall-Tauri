use pearwall_core::SpectrumAnalyzer;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(default)]
pub(crate) struct MediaArtwork {
    key: String,
    data_url: Option<String>,
    playing: bool,
    title: String,
    artist: String,
    album: String,
}

#[path = "../../src-tauri/src/macos_audio.rs"]
mod macos_audio;
#[path = "../../src-tauri/src/macos_now_playing.rs"]
mod macos_now_playing;
#[path = "../../src-tauri/src/macos_runtime_state.rs"]
mod macos_runtime_state;

static RUNTIME_STARTED: AtomicBool = AtomicBool::new(false);
static ANALYZER: OnceLock<Arc<Mutex<SpectrumAnalyzer>>> = OnceLock::new();

#[no_mangle]
pub extern "C" fn pearwall_runtime_start() -> i32 {
    if RUNTIME_STARTED.swap(true, Ordering::AcqRel) {
        return 0;
    }

    let analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::default()));
    let _ = ANALYZER.set(analyzer.clone());
    let started_at = Instant::now();
    if macos_runtime_state::start_publisher(analyzer.clone(), started_at).is_err() {
        RUNTIME_STARTED.store(false, Ordering::Release);
        return 1;
    }
    macos_audio::start(analyzer, started_at);
    if thread::Builder::new()
        .name("pearwall-media-artwork".to_string())
        .spawn(|| loop {
            let _ = macos_now_playing::get_media_artwork(None);
            thread::sleep(Duration::from_secs(1));
        })
        .is_err()
    {
        RUNTIME_STARTED.store(false, Ordering::Release);
        return 1;
    }
    0
}
