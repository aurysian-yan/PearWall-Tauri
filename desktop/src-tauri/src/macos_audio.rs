use pearwall_core::SpectrumAnalyzer;
use std::ffi::{c_double, c_float, c_void};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use std::time::Instant;

type AudioCallback = unsafe extern "C" fn(*const c_float, u32, c_double, *mut c_void);

#[link(name = "pearwall_macos_audio_tap", kind = "static")]
unsafe extern "C" {
    fn pearwall_macos_audio_start(callback: AudioCallback, context: *mut c_void) -> i32;
    fn pearwall_macos_audio_stop();
}

struct CallbackContext {
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
    started_at: Instant,
}

struct AudioCapture {
    context: *const CallbackContext,
}

unsafe impl Send for AudioCapture {}
unsafe impl Sync for AudioCapture {}

impl AudioCapture {
    fn start(analyzer: Arc<Mutex<SpectrumAnalyzer>>, started_at: Instant) -> Result<Self, String> {
        let context = Arc::new(CallbackContext {
            analyzer,
            started_at,
        });
        let pointer = Arc::into_raw(context);
        let status =
            unsafe { pearwall_macos_audio_start(audio_callback, pointer.cast_mut().cast()) };
        if status != 0 {
            unsafe { drop(Arc::from_raw(pointer)) };
            return Err(format_audio_error(status));
        }
        Ok(Self { context: pointer })
    }
}

pub fn start(analyzer: Arc<Mutex<SpectrumAnalyzer>>, started_at: Instant) {
    let result = thread::Builder::new()
        .name("pearwall-macos-audio".to_string())
        .spawn(move || loop {
            match AudioCapture::start(analyzer.clone(), started_at) {
                Ok(_capture) => loop {
                    thread::park();
                },
                Err(error) => {
                    eprintln!("Pear Wall macOS 音频捕获失败：{error}");
                    if let Ok(mut analyzer) = analyzer.lock() {
                        analyzer.reset();
                    }
                    thread::sleep(Duration::from_secs(3));
                }
            }
        });
    if let Err(error) = result {
        eprintln!("Pear Wall macOS 音频线程启动失败：{error}");
    }
}

impl Drop for AudioCapture {
    fn drop(&mut self) {
        unsafe {
            pearwall_macos_audio_stop();
            drop(Arc::from_raw(self.context));
        }
    }
}

unsafe extern "C" fn audio_callback(
    samples: *const c_float,
    frame_count: u32,
    sample_rate_hz: c_double,
    context: *mut c_void,
) {
    if samples.is_null() || context.is_null() || frame_count < 64 {
        return;
    }
    let context = unsafe { &*context.cast::<CallbackContext>() };
    let samples = unsafe { std::slice::from_raw_parts(samples, frame_count as usize) };
    if let Ok(mut analyzer) = context.analyzer.lock() {
        analyzer.push_pcm(
            samples,
            sample_rate_hz as f32,
            context.started_at.elapsed().as_secs_f64(),
        );
    }
}

fn format_audio_error(status: i32) -> String {
    let bytes = status.to_be_bytes();
    if bytes
        .iter()
        .all(|value| value.is_ascii_graphic() || *value == b' ')
    {
        let code = String::from_utf8_lossy(&bytes);
        format!("无法启动系统音频采集：{code}")
    } else {
        format!("无法启动系统音频采集：OSStatus {status}")
    }
}
