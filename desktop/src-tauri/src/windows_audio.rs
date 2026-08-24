use pearwall_core::SpectrumAnalyzer;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use windows::core::GUID;
use windows::Win32::Media::Audio::{
    eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK,
    WAVEFORMATEX, WAVEFORMATEXTENSIBLE, WAVE_FORMAT_PCM,
};
use windows::Win32::Media::KernelStreaming::WAVE_FORMAT_EXTENSIBLE;
use windows::Win32::Media::Multimedia::KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};

const KSDATAFORMAT_SUBTYPE_PCM: GUID = GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71);
const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
const CAPTURE_RETRY_INTERVAL: Duration = Duration::from_secs(1);
const CAPTURE_POLL_INTERVAL: Duration = Duration::from_millis(10);

#[derive(Clone, Copy)]
enum SampleKind {
    Float,
    Pcm,
}

#[derive(Clone, Copy)]
struct MixFormat {
    kind: SampleKind,
    channels: usize,
    sample_rate_hz: f32,
    block_align: usize,
    bytes_per_sample: usize,
    valid_bits: u16,
}

struct ComGuard;

impl ComGuard {
    fn new() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| format!("无法初始化 Windows 音频线程：{error}"))?;
        Ok(Self)
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

pub fn start(analyzer: Arc<Mutex<SpectrumAnalyzer>>) {
    let result = thread::Builder::new()
        .name("pearwall-windows-audio".to_string())
        .spawn(move || audio_worker(analyzer));
    if let Err(error) = result {
        eprintln!("Pear Wall Windows 音频线程启动失败：{error}");
    }
}

fn audio_worker(analyzer: Arc<Mutex<SpectrumAnalyzer>>) {
    let Ok(_com) = ComGuard::new() else {
        return;
    };
    let started_at = Instant::now();
    loop {
        if let Err(error) = capture_default_output(&analyzer, started_at) {
            eprintln!("Pear Wall Windows 音频捕获失败：{error}");
        }
        if let Ok(mut analyzer) = analyzer.lock() {
            analyzer.reset();
        }
        thread::sleep(CAPTURE_RETRY_INTERVAL);
    }
}

fn capture_default_output(
    analyzer: &Arc<Mutex<SpectrumAnalyzer>>,
    started_at: Instant,
) -> Result<(), String> {
    let enumerator: IMMDeviceEnumerator = unsafe {
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|error| format!("无法创建音频设备枚举器：{error}"))?
    };
    let endpoint = unsafe {
        enumerator
            .GetDefaultAudioEndpoint(eRender, eConsole)
            .map_err(|error| format!("无法读取默认输出设备：{error}"))?
    };
    let client: IAudioClient = unsafe {
        endpoint
            .Activate(CLSCTX_ALL, None)
            .map_err(|error| format!("无法打开默认输出设备：{error}"))?
    };
    let format_pointer = unsafe {
        client
            .GetMixFormat()
            .map_err(|error| format!("无法读取输出音频格式：{error}"))?
    };
    if format_pointer.is_null() {
        return Err("默认输出设备没有返回音频格式".to_string());
    }
    let format_result = unsafe { MixFormat::read(format_pointer) };
    let initialize_result = unsafe {
        client.Initialize(
            AUDCLNT_SHAREMODE_SHARED,
            AUDCLNT_STREAMFLAGS_LOOPBACK,
            0,
            0,
            format_pointer,
            None,
        )
    };
    unsafe { CoTaskMemFree(Some(format_pointer.cast())) };
    let format = format_result?;
    initialize_result.map_err(|error| format!("无法初始化系统输出回环：{error}"))?;

    let capture: IAudioCaptureClient = unsafe {
        client
            .GetService()
            .map_err(|error| format!("无法创建系统输出读取器：{error}"))?
    };
    unsafe { client.Start() }.map_err(|error| format!("无法启动系统输出回环：{error}"))?;

    let result = capture_packets(&capture, format, analyzer, started_at);
    let _ = unsafe { client.Stop() };
    result
}

fn capture_packets(
    capture: &IAudioCaptureClient,
    format: MixFormat,
    analyzer: &Arc<Mutex<SpectrumAnalyzer>>,
    started_at: Instant,
) -> Result<(), String> {
    loop {
        let mut packet_frames = unsafe { capture.GetNextPacketSize() }
            .map_err(|error| format!("无法读取系统输出缓冲区：{error}"))?;
        while packet_frames > 0 {
            let mut data = std::ptr::null_mut();
            let mut frame_count = 0_u32;
            let mut flags = 0_u32;
            unsafe {
                capture
                    .GetBuffer(&mut data, &mut frame_count, &mut flags, None, None)
                    .map_err(|error| format!("无法锁定系统输出缓冲区：{error}"))?;
            }

            let samples = if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
                vec![0.0; frame_count as usize]
            } else {
                unsafe { format.decode(data, frame_count as usize) }
            };
            if let Ok(mut analyzer) = analyzer.lock() {
                analyzer.push_pcm(
                    &samples,
                    format.sample_rate_hz,
                    started_at.elapsed().as_secs_f64(),
                );
            }
            unsafe { capture.ReleaseBuffer(frame_count) }
                .map_err(|error| format!("无法释放系统输出缓冲区：{error}"))?;
            packet_frames = unsafe { capture.GetNextPacketSize() }
                .map_err(|error| format!("无法继续读取系统输出缓冲区：{error}"))?;
        }
        thread::sleep(CAPTURE_POLL_INTERVAL);
    }
}

impl MixFormat {
    unsafe fn read(pointer: *const WAVEFORMATEX) -> Result<Self, String> {
        let wave = unsafe { pointer.read_unaligned() };
        let channels = wave.nChannels as usize;
        let block_align = wave.nBlockAlign as usize;
        if channels == 0 || block_align == 0 || block_align % channels != 0 {
            return Err("默认输出设备返回了无效的声道格式".to_string());
        }
        let bytes_per_sample = block_align / channels;
        let mut valid_bits = wave.wBitsPerSample;
        let format_tag = wave.wFormatTag;
        let kind = match format_tag {
            value if value == WAVE_FORMAT_IEEE_FLOAT => SampleKind::Float,
            value if value == WAVE_FORMAT_PCM as u16 => SampleKind::Pcm,
            value if value == WAVE_FORMAT_EXTENSIBLE as u16 => {
                let extensible =
                    unsafe { (pointer.cast::<WAVEFORMATEXTENSIBLE>()).read_unaligned() };
                valid_bits = unsafe { extensible.Samples.wValidBitsPerSample };
                let sub_format = extensible.SubFormat;
                if sub_format == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT {
                    SampleKind::Float
                } else if sub_format == KSDATAFORMAT_SUBTYPE_PCM {
                    SampleKind::Pcm
                } else {
                    return Err("默认输出设备使用了不支持的音频子格式".to_string());
                }
            }
            _ => return Err("默认输出设备使用了不支持的音频格式".to_string()),
        };
        if matches!(kind, SampleKind::Float) && bytes_per_sample != 4 {
            return Err("默认输出设备使用了不支持的浮点采样格式".to_string());
        }
        if matches!(kind, SampleKind::Pcm) && !matches!(bytes_per_sample, 1..=4) {
            return Err("默认输出设备使用了不支持的 PCM 采样格式".to_string());
        }
        if valid_bits == 0 || valid_bits as usize > bytes_per_sample * 8 {
            valid_bits = (bytes_per_sample * 8) as u16;
        }
        Ok(Self {
            kind,
            channels,
            sample_rate_hz: wave.nSamplesPerSec as f32,
            block_align,
            bytes_per_sample,
            valid_bits,
        })
    }

    unsafe fn decode(self, data: *const u8, frame_count: usize) -> Vec<f32> {
        let bytes = unsafe {
            std::slice::from_raw_parts(data, frame_count.saturating_mul(self.block_align))
        };
        let mut mono = Vec::with_capacity(frame_count);
        for frame in bytes.chunks_exact(self.block_align) {
            let mut total = 0.0;
            for channel in 0..self.channels {
                let offset = channel * self.bytes_per_sample;
                total += self.decode_sample(&frame[offset..offset + self.bytes_per_sample]);
            }
            mono.push((total / self.channels as f32).clamp(-1.0, 1.0));
        }
        mono
    }

    fn decode_sample(self, bytes: &[u8]) -> f32 {
        match self.kind {
            SampleKind::Float => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            SampleKind::Pcm if bytes.len() == 1 => (bytes[0] as f32 - 128.0) / 128.0,
            SampleKind::Pcm => {
                let raw = match bytes.len() {
                    2 => i16::from_le_bytes([bytes[0], bytes[1]]) as i32,
                    3 => {
                        let value = (bytes[0] as i32)
                            | ((bytes[1] as i32) << 8)
                            | ((bytes[2] as i32) << 16);
                        (value << 8) >> 8
                    }
                    4 => i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
                    _ => 0,
                };
                let container_bits = (bytes.len() * 8) as u16;
                let aligned = raw >> container_bits.saturating_sub(self.valid_bits);
                let scale = (1_i64 << self.valid_bits.saturating_sub(1)) as f32;
                aligned as f32 / scale
            }
        }
    }
}
