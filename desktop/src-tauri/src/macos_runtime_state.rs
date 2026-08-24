#![allow(dead_code)]

use fs2::FileExt;
use memmap2::{Mmap, MmapMut};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::mem::size_of;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const RUNTIME_STATE_MAGIC: [u8; 8] = *b"PWRSTATE";
const RUNTIME_STATE_VERSION: u32 = 1;
const RUNTIME_STATE_FILE_NAME: &str = "runtime-state-v1.bin";
const AGENT_LOCK_FILE_NAME: &str = "agent-v1.lock";

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

pub struct AgentInstance {
    _file: File,
}

impl AgentInstance {
    pub fn acquire() -> io::Result<Option<Self>> {
        let directory = application_support_directory()?;
        fs::create_dir_all(&directory)?;
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
        let path = directory.join(AGENT_LOCK_FILE_NAME);
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        match file.try_lock_exclusive() {
            Ok(()) => Ok(Some(Self { _file: file })),
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error),
        }
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
