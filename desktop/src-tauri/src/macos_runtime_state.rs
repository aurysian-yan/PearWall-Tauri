#![allow(dead_code)]

use memmap2::{Mmap, MmapMut};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::mem::size_of;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use pearwall_core::{PcmAnalysisSnapshot, SpectrumAnalyzer};

const RUNTIME_STATE_MAGIC: [u8; 8] = *b"PWRSTATE";
const RUNTIME_STATE_VERSION: u32 = 1;
const RUNTIME_STATE_FILE_NAME: &str = "runtime-state-v1.bin";

#[repr(C, align(64))]
struct SharedRuntimeState {
    magic: [u8; 8],
    version: u32,
    size: u32,
    sequence: AtomicU32,
    pulse_bits: AtomicU32,
    playing: AtomicU32,
    reserved_value: u32,
    updated_at_milliseconds: AtomicU64,
    settings_revision: AtomicU64,
    reserved: [u8; 16],
}

const _: [(); 64] = [(); size_of::<SharedRuntimeState>()];

#[derive(Clone, Copy, Debug, Default)]
pub struct RuntimeSnapshot {
    pub pulse: f32,
    pub playing: bool,
    pub updated_at_milliseconds: u64,
    pub settings_revision: u64,
}

pub struct RuntimeStateWriter {
    mapping: MmapMut,
}

struct AudioBeatLogger {
    beat_count: u64,
    previous_pulse: f32,
    valley_pulse: f32,
    peak_pulse: f32,
    peak_snapshot: Option<PcmAnalysisSnapshot>,
    peak_has_risen: bool,
    last_log_at: Option<Instant>,
}

impl Default for AudioBeatLogger {
    fn default() -> Self {
        Self {
            beat_count: 0,
            previous_pulse: 0.0,
            valley_pulse: 1.0,
            peak_pulse: 0.0,
            peak_snapshot: None,
            peak_has_risen: false,
            last_log_at: None,
        }
    }
}

impl AudioBeatLogger {
    fn update(&mut self, pulse: f32, snapshot: Option<PcmAnalysisSnapshot>) {
        let pulse = pulse.clamp(0.0, 1.0);
        self.valley_pulse = self.valley_pulse.min(pulse);
        if pulse >= self.peak_pulse {
            if pulse > self.previous_pulse {
                self.peak_has_risen = true;
            }
            self.peak_pulse = pulse;
            self.peak_snapshot = snapshot;
        }

        let now = Instant::now();
        let cooldown_finished = self.last_log_at.is_none_or(|last_log_at| {
            now.duration_since(last_log_at) >= Duration::from_millis(160)
        });
        let peak_finished = self.peak_has_risen
            && pulse < self.previous_pulse
            && self.peak_pulse - pulse >= 0.04
            && self.peak_pulse - self.valley_pulse >= 0.08;
        if cooldown_finished && peak_finished && self.peak_pulse >= 0.15 {
            self.beat_count += 1;
            let peak = self.peak_pulse;
            let scale_1x = 1.0 + 0.33 * peak * peak;
            let scale_3x = 1.0 + 0.99 * peak * peak;
            if let Some(snapshot) = self.peak_snapshot {
                eprintln!(
                    "[Pear Wall 音频] 鼓点 #{} pulse={:.3} analyzer={:.3} transient={:.3} onset={:.3} bands_db=[低频:{:.1}, 鼓组:{:.1}, 上低频:{:.1}, 低中频:{:.1}, 中频:{:.1}] scale_1x={:.3} scale_3x={:.3}",
                    self.beat_count,
                    peak,
                    snapshot.pulse,
                    snapshot.transient,
                    snapshot.onset,
                    snapshot.band_db[0],
                    snapshot.band_db[1],
                    snapshot.band_db[2],
                    snapshot.band_db[3],
                    snapshot.band_db[4],
                    scale_1x,
                    scale_3x,
                );
            } else {
                eprintln!(
                    "[Pear Wall 音频] 鼓点 #{} pulse={:.3} scale_1x={:.3} scale_3x={:.3}",
                    self.beat_count, peak, scale_1x, scale_3x,
                );
            }
            self.last_log_at = Some(now);
            self.valley_pulse = pulse;
            self.peak_pulse = pulse;
            self.peak_snapshot = snapshot;
            self.peak_has_risen = false;
        }
        self.previous_pulse = pulse;
    }
}

impl RuntimeStateWriter {
    pub fn open() -> io::Result<Self> {
        let directory = application_support_directory()?;
        fs::create_dir_all(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        let path = directory.join(RUNTIME_STATE_FILE_NAME);
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        file.set_len(size_of::<SharedRuntimeState>() as u64)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        let mut mapping = unsafe { MmapMut::map_mut(&file)? };
        if !valid_state(mapping.as_ptr()) {
            mapping.fill(0);
            let state = mapping.as_mut_ptr().cast::<SharedRuntimeState>();
            unsafe {
                state.write(SharedRuntimeState {
                    magic: RUNTIME_STATE_MAGIC,
                    version: RUNTIME_STATE_VERSION,
                    size: size_of::<SharedRuntimeState>() as u32,
                    sequence: AtomicU32::new(0),
                    pulse_bits: AtomicU32::new(0),
                    playing: AtomicU32::new(0),
                    reserved_value: 0,
                    updated_at_milliseconds: AtomicU64::new(0),
                    settings_revision: AtomicU64::new(0),
                    reserved: [0; 16],
                });
            }
            mapping.flush()?;
        }
        Ok(Self { mapping })
    }

    pub fn publish(&mut self, pulse: f32, playing: bool, settings_revision: u64) {
        let state = unsafe { &*self.mapping.as_ptr().cast::<SharedRuntimeState>() };
        state.sequence.fetch_add(1, Ordering::AcqRel);
        state
            .pulse_bits
            .store(pulse.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        state.playing.store(u32::from(playing), Ordering::Relaxed);
        state
            .updated_at_milliseconds
            .store(unix_time_milliseconds(), Ordering::Relaxed);
        state
            .settings_revision
            .store(settings_revision, Ordering::Relaxed);
        state.sequence.fetch_add(1, Ordering::Release);
    }
}

pub fn start_publisher(
    analyzer: Arc<Mutex<SpectrumAnalyzer>>,
    started_at: Instant,
) -> Result<(), String> {
    let mut state = RuntimeStateWriter::open().map_err(|error| error.to_string())?;
    std::thread::Builder::new()
        .name("pearwall-runtime-state".to_string())
        .spawn(move || {
            let interval = Duration::from_millis(33);
            let mut next_frame = Instant::now();
            let mut beat_logger = AudioBeatLogger::default();
            loop {
                next_frame += interval;
                let now = Instant::now();
                if next_frame > now {
                    std::thread::sleep(next_frame - now);
                } else if now.duration_since(next_frame) > Duration::from_secs(1) {
                    next_frame = now;
                }
                let timestamp = started_at.elapsed().as_secs_f64();
                let (pulse, snapshot) = analyzer
                    .lock()
                    .map(|mut analyzer| {
                        let pulse = analyzer.get_interpolated(timestamp);
                        (pulse, analyzer.pcm_analysis_snapshot())
                    })
                    .unwrap_or((0.0, None));
                beat_logger.update(pulse, snapshot);
                state.publish(pulse, true, 0);
            }
        })
        .map(|_| ())
        .map_err(|error| format!("无法启动运行时状态线程：{error}"))
}

pub struct RuntimeStateReader {
    mapping: Mmap,
}

impl RuntimeStateReader {
    pub fn open() -> io::Result<Self> {
        let path = application_support_directory()?.join(RUNTIME_STATE_FILE_NAME);
        let file = File::open(path)?;
        let mapping = unsafe { Mmap::map(&file)? };
        if mapping.len() < size_of::<SharedRuntimeState>() || !valid_state(mapping.as_ptr()) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Pear Wall 运行时状态格式无效",
            ));
        }
        Ok(Self { mapping })
    }

    pub fn snapshot(&self) -> Option<RuntimeSnapshot> {
        let state = unsafe { &*self.mapping.as_ptr().cast::<SharedRuntimeState>() };
        for _ in 0..8 {
            let first = state.sequence.load(Ordering::Acquire);
            if first & 1 != 0 {
                continue;
            }
            let snapshot = RuntimeSnapshot {
                pulse: f32::from_bits(state.pulse_bits.load(Ordering::Relaxed)),
                playing: state.playing.load(Ordering::Relaxed) != 0,
                updated_at_milliseconds: state.updated_at_milliseconds.load(Ordering::Relaxed),
                settings_revision: state.settings_revision.load(Ordering::Relaxed),
            };
            let second = state.sequence.load(Ordering::Acquire);
            if first == second && second & 1 == 0 && snapshot.pulse.is_finite() {
                return Some(snapshot);
            }
        }
        None
    }

    pub fn current_pulse(&self, maximum_age: Duration) -> Option<f32> {
        let snapshot = self.snapshot()?;
        let age = unix_time_milliseconds().checked_sub(snapshot.updated_at_milliseconds)?;
        (age <= maximum_age.as_millis() as u64).then_some(snapshot.pulse.clamp(0.0, 1.0))
    }
}

pub fn application_support_directory() -> io::Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "无法定位用户目录"))?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("PearWall"))
}

fn valid_state(pointer: *const u8) -> bool {
    let state = unsafe { &*pointer.cast::<SharedRuntimeState>() };
    state.magic == RUNTIME_STATE_MAGIC
        && state.version == RUNTIME_STATE_VERSION
        && state.size as usize == size_of::<SharedRuntimeState>()
}

fn unix_time_milliseconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
