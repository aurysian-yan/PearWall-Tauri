#[cfg(target_os = "macos")]
#[path = "../macos_audio.rs"]
mod macos_audio;
#[cfg(target_os = "macos")]
#[path = "../macos_now_playing.rs"]
mod macos_now_playing;
#[cfg(target_os = "macos")]
#[path = "../macos_runtime_state.rs"]
mod macos_runtime_state;

#[cfg(target_os = "macos")]
#[derive(Clone, Default, serde::Deserialize, serde::Serialize)]
struct MediaArtwork {
    key: String,
    data_url: Option<String>,
    playing: bool,
}

#[cfg(target_os = "macos")]
#[link(name = "pearwall_macos_agent_status_item", kind = "static")]
unsafe extern "C" {
    fn pearwall_agent_run_status_item() -> i32;
}

#[cfg(target_os = "macos")]
fn main() {
    if let Err(error) = run() {
        eprintln!("Pear Wall 后台运行时启动失败：{error}");
        std::process::exit(1);
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {}

#[cfg(target_os = "macos")]
fn run() -> Result<(), String> {
    use macos_runtime_state::{AgentInstance, RuntimeStateWriter};
    use pearwall_core::SpectrumAnalyzer;
    use std::sync::{Arc, Mutex};
    use std::time::Instant;

    let Some(_instance) = AgentInstance::acquire().map_err(|error| error.to_string())? else {
        return Ok(());
    };
    let started_at = Instant::now();
    let analyzer = Arc::new(Mutex::new(SpectrumAnalyzer::default()));
    macos_audio::start(analyzer.clone(), started_at);
    let state = RuntimeStateWriter::open().map_err(|error| error.to_string())?;
    let state_analyzer = analyzer;
    std::thread::Builder::new()
        .name("pearwall-agent-state".to_string())
        .spawn(move || publish_runtime_state(state, state_analyzer, started_at))
        .map_err(|error| format!("无法启动运行时状态线程：{error}"))?;
    std::thread::Builder::new()
        .name("pearwall-agent-artwork".to_string())
        .spawn(publish_media_artwork)
        .map_err(|error| format!("无法启动媒体封面线程：{error}"))?;
    let result = unsafe { pearwall_agent_run_status_item() };
    if result != 0 {
        return Err("无法创建菜单栏状态图标".to_string());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn publish_media_artwork() -> ! {
    loop {
        let _ = macos_now_playing::get_media_artwork(None);
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}

#[cfg(target_os = "macos")]
fn publish_runtime_state(
    mut state: macos_runtime_state::RuntimeStateWriter,
    analyzer: std::sync::Arc<std::sync::Mutex<pearwall_core::SpectrumAnalyzer>>,
    started_at: std::time::Instant,
) -> ! {
    use std::time::{Duration, Instant};

    let interval = Duration::from_millis(33);
    let mut next_frame = Instant::now();

    loop {
        next_frame += interval;
        let now = Instant::now();
        if next_frame > now {
            std::thread::sleep(next_frame - now);
        } else if now.duration_since(next_frame) > Duration::from_secs(1) {
            next_frame = now;
        }
        let timestamp = started_at.elapsed().as_secs_f64();
        let pulse = analyzer
            .lock()
            .map(|mut analyzer| analyzer.get_interpolated(timestamp))
            .unwrap_or(0.0);
        state.publish(pulse, true, 0);
    }
}
