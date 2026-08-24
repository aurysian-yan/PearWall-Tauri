use pearwall_core::SpectrumAnalyzer;
use screencapturekit::cm::{AudioBuffer, CMSampleBuffer, CMSampleBufferExt};
use screencapturekit::prelude::*;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub fn start(analyzer: Arc<Mutex<SpectrumAnalyzer>>, started_at: Instant) {
    let result = std::thread::Builder::new()
        .name("pearwall-macos-audio".to_string())
        .spawn(move || loop {
            if let Err(error) = run(analyzer.clone(), started_at) {
                eprintln!("Pear Wall macOS 音频捕获失败：{error}");
                std::thread::sleep(Duration::from_secs(5));
            }
        });

    if let Err(error) = result {
        eprintln!("Pear Wall macOS 音频线程启动失败：{error}");
    }
}

fn run(analyzer: Arc<Mutex<SpectrumAnalyzer>>, started_at: Instant) -> Result<(), String> {
    let content =
        SCShareableContent::get().map_err(|error| format!("无法访问屏幕音频：{error}"))?;
    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or_else(|| "没有可用的显示器音频源".to_string())?;
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();
    let configuration = SCStreamConfiguration::new()
        .with_captures_audio(true)
        .with_excludes_current_process_audio(true)
        .with_sample_rate(48_000)
        .with_channel_count(2)
        .with_width(2)
        .with_height(2);
    let mut stream = SCStream::new(&filter, &configuration);
    let callback_analyzer = analyzer;

    stream
        .add_output_handler(
            move |sample: CMSampleBuffer, output_type: SCStreamOutputType| {
                if output_type != SCStreamOutputType::Audio {
                    return;
                }
                let Some(samples) = decode_audio(&sample) else {
                    return;
                };
                if let Ok(mut analyzer) = callback_analyzer.lock() {
                    analyzer.push_pcm(&samples, 48_000.0, started_at.elapsed().as_secs_f64());
                }
            },
            SCStreamOutputType::Audio,
        )
        .ok_or_else(|| "无法注册系统音频回调".to_string())?;
    stream
        .start_capture()
        .map_err(|error| format!("无法启动系统音频流：{error}"))?;

    loop {
        std::thread::park();
    }
}

fn decode_audio(sample: &CMSampleBuffer) -> Option<Vec<f32>> {
    sample.make_data_ready().ok()?;
    let buffers = sample.audio_buffer_list()?;
    let audio_buffers: Vec<&AudioBuffer> = buffers.iter().collect();
    if audio_buffers.is_empty() {
        return None;
    }

    if audio_buffers.len() == 1 && audio_buffers[0].number_channels > 1 {
        return interleaved_to_mono(audio_buffers[0]);
    }

    let channels: Vec<Vec<f32>> = audio_buffers
        .iter()
        .filter_map(|buffer| decode_buffer(buffer))
        .collect();
    if channels.is_empty() {
        return None;
    }

    let frame_count = channels.iter().map(Vec::len).min().unwrap_or(0);
    if frame_count == 0 {
        return None;
    }
    let mut mono = vec![0.0; frame_count];
    for channel in &channels {
        for (index, value) in channel.iter().take(frame_count).enumerate() {
            mono[index] += *value;
        }
    }
    let scale = 1.0 / channels.len() as f32;
    for value in &mut mono {
        *value *= scale;
    }
    Some(mono)
}

fn interleaved_to_mono(buffer: &AudioBuffer) -> Option<Vec<f32>> {
    let channels = buffer.number_channels as usize;
    let samples = decode_buffer(buffer)?;
    if channels == 0 || samples.len() < channels {
        return None;
    }
    let frame_count = samples.len() / channels;
    let mut mono = Vec::with_capacity(frame_count);
    for frame in samples.chunks_exact(channels) {
        mono.push(frame.iter().copied().sum::<f32>() / channels as f32);
    }
    Some(mono)
}

fn decode_buffer(buffer: &AudioBuffer) -> Option<Vec<f32>> {
    let bytes = buffer.data();
    if bytes.is_empty() {
        return None;
    }

    let float_samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_ne_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    if !float_samples.is_empty()
        && float_samples
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() <= 2.0)
    {
        return Some(float_samples);
    }

    let int_samples: Vec<f32> = bytes
        .chunks_exact(2)
        .map(|chunk| i16::from_ne_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32)
        .collect();
    (!int_samples.is_empty()).then_some(int_samples)
}
