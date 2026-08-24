use biquad::{Biquad, Coefficients, DirectForm1, Hertz, Type, Q_BUTTERWORTH_F32};

const SILENCE_DB: f32 = -72.0;
const DEFAULT_REPORT_INTERVAL_SECONDS: f32 = 0.05;
const MIN_REPORT_INTERVAL_SECONDS: f32 = 0.001;
const MAX_REPORT_INTERVAL_SECONDS: f32 = 0.25;

type LowPass = DirectForm1<f32>;

fn low_pass(cutoff_hz: f32, sample_rate_hz: f32) -> LowPass {
    let safe_sample_rate = if sample_rate_hz.is_finite() {
        sample_rate_hz.clamp(2_000.0, 192_000.0)
    } else {
        48_000.0
    };
    let safe_cutoff = cutoff_hz.min(safe_sample_rate * 0.45).max(1.0);
    let coefficients = Coefficients::<f32>::from_params(
        Type::LowPass,
        Hertz::from_hz(safe_sample_rate).expect("采样率已限制在有效范围内"),
        Hertz::from_hz(safe_cutoff).expect("截止频率已限制在有效范围内"),
        Q_BUTTERWORTH_F32,
    )
    .expect("低通滤波器参数有效");
    DirectForm1::new(coefficients)
}

struct TransientDetector {
    sample_rate: f32,
    low: LowPass,
    bass_top: LowPass,
    reference_top: LowPass,
    bass_power: f64,
    reference_power: f64,
    previous_db: f32,
}

impl Default for TransientDetector {
    fn default() -> Self {
        Self {
            sample_rate: 0.0,
            low: low_pass(25.0, 48_000.0),
            bass_top: low_pass(190.0, 48_000.0),
            reference_top: low_pass(760.0, 48_000.0),
            bass_power: 0.0,
            reference_power: 0.0,
            previous_db: 0.0,
        }
    }
}

impl TransientDetector {
    fn process(&mut self, waveform: &[i8], sample_rate: f32) -> f32 {
        self.prepare(sample_rate);
        let mut strongest: f32 = 0.0;
        for raw in waveform {
            let sample = (*raw as f32 + 128.0) / 128.0 - 1.0;
            strongest = strongest.max(self.process_sample(sample));
        }
        strongest * 0.82
    }

    fn process_pcm(&mut self, samples: &[f32], sample_rate: f32) -> f32 {
        self.prepare(sample_rate);
        let mut strongest: f32 = 0.0;
        for sample in samples {
            strongest = strongest.max(self.process_sample(sample.clamp(-1.0, 1.0)));
        }
        strongest * 0.82
    }

    fn prepare(&mut self, sample_rate: f32) {
        if sample_rate == self.sample_rate {
            return;
        }
        self.sample_rate = sample_rate;
        self.low = low_pass(25.0, sample_rate);
        self.bass_top = low_pass(190.0, sample_rate);
        self.reference_top = low_pass(760.0, sample_rate);
        self.bass_power = 0.0;
        self.reference_power = 0.0;
    }

    fn process_sample(&mut self, sample: f32) -> f32 {
        let low = self.low.run(sample);
        let bass_top = self.bass_top.run(sample);
        let bass = bass_top - low;
        let reference = self.reference_top.run(sample) - bass_top;
        self.bass_power = envelope(
            self.bass_power,
            (bass * bass) as f64,
            0.006,
            0.045,
            self.sample_rate,
        );
        self.reference_power = envelope(
            self.reference_power,
            (reference * reference) as f64,
            0.006,
            0.045,
            self.sample_rate,
        );
        let bass_db = power_to_db(self.bass_power as f32);
        let reference_db = power_to_db(self.reference_power as f32);
        let rise = (bass_db - self.previous_db).max(0.0);
        self.previous_db = bass_db;
        let response = smooth_range(bass_db - reference_db, 0.0, 8.0);
        let attack = smooth_range(rise, 7.0, 14.0);
        response * attack
    }
}

pub struct AudioAnalyzer {
    recent: [f32; 4],
    recent_write: usize,
    target: f32,
    power: f32,
    bass_baseline_db: f32,
    reference_baseline_db: f32,
    previous_bass_db: f32,
    sharp_attack: f32,
    response_history: [f32; 3],
    history_write: usize,
    history_count: usize,
    initialized: bool,
    transient_detector: TransientDetector,
    transient_response: f32,
    previous_waveform_ns: i64,
    previous_fft_ns: i64,
}

const SPECTRUM_DB_FLOOR: f32 = -72.0;
const SPECTRUM_BASS_LEVEL_FLOOR: f32 = -50.0;
const SPECTRUM_BASS_LEVEL_CEILING: f32 = -18.0;
const SPECTRUM_REPORT_INTERVAL_SECONDS: f64 = 1.0 / 30.0;
const SPECTRUM_ATTACK_SECONDS: f64 = 0.03;
const SPECTRUM_RELEASE_SECONDS: f64 = 0.12;
const SPECTRUM_BIN_COUNT: usize = 64;
const SPECTRAL_FLUX_HISTORY_SIZE: usize = 30;
const SPECTRAL_FLUX_LOG_GAIN: f32 = 40.0;
const SPECTRAL_FLUX_THRESHOLD_MULTIPLIER: f32 = 1.35;
const SPECTRAL_FLUX_MINIMUM_LEVEL: f32 = 0.01;
const SPECTRAL_FLUX_FULL_LEVEL: f32 = 0.06;
const SPECTRUM_SUSTAINED_RESPONSE: f32 = 0.3;
const PCM_REPORT_INTERVAL_SECONDS: f64 = 0.05;
const PCM_WINDOW_SAMPLES: usize = 2048;

pub struct SpectrumAnalyzer {
    slow_bass_db: f32,
    slow_reference_db: f32,
    previous_bass_db: f32,
    sharp_attack: f32,
    initialized: bool,
    previous_timestamp: f64,
    current_report_timestamp: f64,
    previous_output_timestamp: f64,
    unprocessed_history: [f32; 3],
    history_write: usize,
    history_count: usize,
    recent_samples: [f32; 4],
    recent_write: usize,
    target_power: f32,
    power: f32,
    previous_spectrum: [f32; SPECTRUM_BIN_COUNT],
    spectrum_initialized: bool,
    spectral_flux_history: [f32; SPECTRAL_FLUX_HISTORY_SIZE],
    spectral_flux_write: usize,
    spectral_flux_count: usize,
    current_onset: f32,
    pcm_samples: Vec<f32>,
    pcm_sample_rate_hz: f32,
    pcm_pending_samples: usize,
    pcm_classic_analyzer: AudioAnalyzer,
    pcm_mode: bool,
    previous_report_power: f32,
    current_report_power: f32,
    previous_report_timestamp: f64,
    pcm_band_powers: [f32; 5],
    pcm_spectral_onset: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct PcmAnalysisSnapshot {
    pub pulse: f32,
    pub transient: f32,
    pub onset: f32,
    pub band_db: [f32; 5],
}

impl Default for SpectrumAnalyzer {
    fn default() -> Self {
        Self {
            slow_bass_db: SPECTRUM_DB_FLOOR,
            slow_reference_db: SPECTRUM_DB_FLOOR,
            previous_bass_db: SPECTRUM_DB_FLOOR,
            sharp_attack: 0.0,
            initialized: false,
            previous_timestamp: 0.0,
            current_report_timestamp: 0.0,
            previous_output_timestamp: 0.0,
            unprocessed_history: [0.0; 3],
            history_write: 0,
            history_count: 0,
            recent_samples: [0.0; 4],
            recent_write: 0,
            target_power: 0.0,
            power: 0.0,
            previous_spectrum: [0.0; SPECTRUM_BIN_COUNT],
            spectrum_initialized: false,
            spectral_flux_history: [0.0; SPECTRAL_FLUX_HISTORY_SIZE],
            spectral_flux_write: 0,
            spectral_flux_count: 0,
            current_onset: 0.0,
            pcm_samples: Vec::with_capacity(PCM_WINDOW_SAMPLES),
            pcm_sample_rate_hz: 0.0,
            pcm_pending_samples: 0,
            pcm_classic_analyzer: AudioAnalyzer::default(),
            pcm_mode: false,
            previous_report_power: 0.0,
            current_report_power: 0.0,
            previous_report_timestamp: 0.0,
            pcm_band_powers: [0.0; 5],
            pcm_spectral_onset: 0.0,
        }
    }
}

impl SpectrumAnalyzer {
    pub fn push(&mut self, audio: &[f32], timestamp_seconds: f64) {
        if audio.len() < 2 || !timestamp_seconds.is_finite() {
            return;
        }
        let half = audio.len() / 2;
        let powers = self.read_powers(audio, half);
        let spectrum = self.read_spectrum(audio, half);
        let onset = self.analyze_spectral_flux(&spectrum);
        self.push_powers(&powers, onset, timestamp_seconds);
    }

    pub fn push_pcm(&mut self, samples: &[f32], sample_rate_hz: f32, timestamp_seconds: f64) {
        if samples.len() < 64
            || !sample_rate_hz.is_finite()
            || !(2_000.0..=192_000.0).contains(&sample_rate_hz)
            || !timestamp_seconds.is_finite()
        {
            return;
        }

        if (sample_rate_hz - self.pcm_sample_rate_hz).abs() > f32::EPSILON {
            self.reset();
            self.pcm_sample_rate_hz = sample_rate_hz;
        }
        self.pcm_mode = true;
        let timestamp_ns = (timestamp_seconds * 1_000_000_000.0)
            .round()
            .clamp(0.0, i64::MAX as f64) as i64;
        self.pcm_classic_analyzer
            .process_pcm_waveform(samples, sample_rate_hz, timestamp_ns);

        let hop_samples = (sample_rate_hz * PCM_REPORT_INTERVAL_SECONDS as f32)
            .round()
            .max(1.0) as usize;
        self.pcm_samples
            .extend(samples.iter().map(|sample| sample.clamp(-1.0, 1.0)));
        if self.pcm_samples.len() > PCM_WINDOW_SAMPLES {
            let extra = self.pcm_samples.len() - PCM_WINDOW_SAMPLES;
            self.pcm_samples.drain(0..extra);
        }
        self.pcm_pending_samples = self.pcm_pending_samples.saturating_add(samples.len());
        if self.pcm_samples.len() < PCM_WINDOW_SAMPLES || self.pcm_pending_samples < hop_samples {
            return;
        }
        self.pcm_pending_samples %= hop_samples;

        let mut spectrum = [0.0; 128];
        let mut magnitudes = [0.0; SPECTRUM_BIN_COUNT];
        for index in 0..64 {
            let normalized = index as f32 / 63.0;
            let frequency = 30.0 * (20_000.0_f32 / 30.0).powf(normalized);
            let magnitude = pcm_frequency_magnitude(&self.pcm_samples, sample_rate_hz, frequency);
            magnitudes[index] = magnitude;
            spectrum[index] = magnitude;
            spectrum[index + 64] = magnitude;
        }
        let onset = self.analyze_spectral_flux(&magnitudes);
        let powers = self.read_powers(&spectrum, 64);
        self.pcm_band_powers = powers;
        self.pcm_spectral_onset = onset;
        let classic_power = self
            .pcm_classic_analyzer
            .process_spectrum_powers(&powers, timestamp_ns);
        let power = classic_power.max(onset);
        self.previous_report_power = self.current_report_power;
        self.current_report_power = power;
        self.previous_report_timestamp = self.current_report_timestamp;
        self.current_report_timestamp = timestamp_seconds;
    }

    fn push_powers(&mut self, powers: &[f32; 5], onset: f32, timestamp_seconds: f64) {
        let delta_seconds = if self.previous_timestamp > 0.0 {
            (timestamp_seconds - self.previous_timestamp).clamp(0.0, 0.25)
        } else {
            SPECTRUM_REPORT_INTERVAL_SECONDS
        };
        self.previous_timestamp = timestamp_seconds;
        let response = self.analyze(&powers, delta_seconds);
        let confirmed = self.confirm_response(response, response >= 0.72);
        self.recent_samples[self.recent_write] = confirmed * SPECTRUM_SUSTAINED_RESPONSE;
        self.recent_write = (self.recent_write + 1) % self.recent_samples.len();
        self.current_onset = onset;
        self.current_report_timestamp = timestamp_seconds;
    }

    pub fn get_interpolated(&mut self, timestamp_seconds: f64) -> f32 {
        if self.pcm_mode {
            return self.get_pcm_interpolated(timestamp_seconds);
        }
        let elapsed = if self.previous_output_timestamp > 0.0
            && timestamp_seconds > self.previous_output_timestamp
        {
            (timestamp_seconds - self.previous_output_timestamp).min(0.25)
        } else {
            SPECTRUM_REPORT_INTERVAL_SECONDS
        };
        self.previous_output_timestamp = timestamp_seconds;
        let report_is_current = self.current_report_timestamp != 0.0
            && timestamp_seconds - self.current_report_timestamp <= 0.25;
        let mut weighted_samples = 0.0;
        if report_is_current {
            let ramp = [0.1, 0.2, 0.3, 0.4];
            for (index, weight) in ramp.iter().enumerate() {
                let sample_index = (self.recent_write + index) % self.recent_samples.len();
                weighted_samples += self.recent_samples[sample_index] * weight;
            }
        }
        self.target_power = weighted_samples.max(if report_is_current {
            self.current_onset
        } else {
            0.0
        });
        let response_seconds = if self.target_power > self.power {
            SPECTRUM_ATTACK_SECONDS
        } else {
            SPECTRUM_RELEASE_SECONDS
        };
        let response = 1.0 - (-elapsed / response_seconds).exp() as f32;
        self.power += (self.target_power - self.power) * response;
        if self.power * self.power < 1e-8 {
            self.power = 0.0;
        }
        smooth_quintic(self.power)
    }

    fn get_pcm_interpolated(&self, timestamp_seconds: f64) -> f32 {
        if self.current_report_timestamp == 0.0
            || timestamp_seconds - self.current_report_timestamp > 0.25
        {
            return 0.0;
        }
        let report_seconds = self.current_report_timestamp - self.previous_report_timestamp;
        if self.previous_report_timestamp == 0.0 || report_seconds <= 0.0 {
            return self.current_report_power.clamp(0.0, 1.0);
        }
        let sample_timestamp = timestamp_seconds - report_seconds;
        let amount = ((sample_timestamp - self.previous_report_timestamp) / report_seconds)
            .clamp(0.0, 1.0) as f32;
        (self.previous_report_power
            + (self.current_report_power - self.previous_report_power) * amount)
            .clamp(0.0, 1.0)
    }

    pub fn pcm_analysis_snapshot(&self) -> Option<PcmAnalysisSnapshot> {
        if !self.pcm_mode || self.current_report_timestamp == 0.0 {
            return None;
        }
        Some(PcmAnalysisSnapshot {
            pulse: self.current_report_power.clamp(0.0, 1.0),
            transient: self.pcm_classic_analyzer.transient_response.clamp(0.0, 1.0),
            onset: self.pcm_spectral_onset.clamp(0.0, 1.0),
            band_db: self.pcm_band_powers.map(power_to_db),
        })
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    fn read_powers(&self, audio: &[f32], half: usize) -> [f32; 5] {
        let bands = [
            (30.0, 105.0),
            (75.0, 155.0),
            (145.0, 210.0),
            (155.0, 380.0),
            (380.0, 760.0),
        ];
        let mut result = [0.0; 5];
        for (index, (start_hz, end_hz)) in bands.iter().enumerate() {
            let left = self.average_band_power(audio, 0, half, *start_hz, *end_hz);
            let right = self.average_band_power(audio, half, audio.len(), *start_hz, *end_hz);
            result[index] = (left + right) * 0.5;
        }
        result
    }

    fn read_spectrum(&self, audio: &[f32], half: usize) -> [f32; SPECTRUM_BIN_COUNT] {
        let mut spectrum = [0.0; SPECTRUM_BIN_COUNT];
        if half == 0 {
            return spectrum;
        }
        for (index, value) in spectrum.iter_mut().enumerate() {
            let source_index = if half == 1 {
                0
            } else {
                index * (half - 1) / (SPECTRUM_BIN_COUNT - 1)
            };
            let left = audio
                .get(source_index)
                .copied()
                .unwrap_or_default()
                .max(0.0);
            let right = audio
                .get(half + source_index)
                .copied()
                .unwrap_or(left)
                .max(0.0);
            *value = (left + right) * 0.5;
        }
        spectrum
    }

    fn analyze_spectral_flux(&mut self, spectrum: &[f32; SPECTRUM_BIN_COUNT]) -> f32 {
        let mut current = [0.0; SPECTRUM_BIN_COUNT];
        let mut level = 0.0;
        for (index, value) in spectrum.iter().enumerate() {
            current[index] = (1.0 + SPECTRAL_FLUX_LOG_GAIN * value.max(0.0)).ln();
            level += current[index];
        }
        level /= SPECTRUM_BIN_COUNT as f32;

        if !self.spectrum_initialized {
            self.previous_spectrum = current;
            self.spectrum_initialized = true;
            return 0.0;
        }

        let bands = [(0, 20, 1.0), (20, 43, 0.85), (43, 64, 0.65)];
        let mut flux = 0.0_f32;
        for (start, end, weight) in bands {
            let mut positive_change = 0.0;
            let mut current_energy = 0.0;
            for index in start..end {
                positive_change += (current[index] - self.previous_spectrum[index]).max(0.0);
                current_energy += current[index];
            }
            let band_flux = positive_change / (current_energy + 1e-5);
            flux = flux.max(band_flux * weight);
        }
        self.previous_spectrum = current;

        let baseline = self.spectral_flux_median();
        self.spectral_flux_history[self.spectral_flux_write] = flux;
        self.spectral_flux_write =
            (self.spectral_flux_write + 1) % self.spectral_flux_history.len();
        self.spectral_flux_count =
            (self.spectral_flux_count + 1).min(self.spectral_flux_history.len());
        if self.spectral_flux_count < 4 || level <= SPECTRAL_FLUX_MINIMUM_LEVEL {
            return 0.0;
        }

        let threshold = (baseline * SPECTRAL_FLUX_THRESHOLD_MULTIPLIER).max(1e-4);
        let relative_flux = flux / threshold;
        let onset = smooth_range(relative_flux, 0.85, 2.0);
        onset * smooth_range(level, SPECTRAL_FLUX_MINIMUM_LEVEL, SPECTRAL_FLUX_FULL_LEVEL)
    }

    fn spectral_flux_median(&self) -> f32 {
        if self.spectral_flux_count == 0 {
            return 0.0;
        }
        let mut values = [0.0; SPECTRAL_FLUX_HISTORY_SIZE];
        values[..self.spectral_flux_count]
            .copy_from_slice(&self.spectral_flux_history[..self.spectral_flux_count]);
        values[..self.spectral_flux_count].sort_by(f32::total_cmp);
        let middle = self.spectral_flux_count / 2;
        if self.spectral_flux_count % 2 == 0 {
            (values[middle - 1] + values[middle]) * 0.5
        } else {
            values[middle]
        }
    }

    fn average_band_power(
        &self,
        audio: &[f32],
        offset: usize,
        end: usize,
        start_hz: f32,
        end_hz: f32,
    ) -> f32 {
        let start = offset.max(offset + self.frequency_to_index(start_hz));
        let finish = end.min(offset + self.frequency_to_index(end_hz) + 1);
        if finish <= start {
            return 0.0;
        }
        let mut total = 0.0;
        for value in &audio[start..finish] {
            total += *value * *value;
        }
        total / (finish - start) as f32
    }

    fn frequency_to_index(&self, frequency: f32) -> usize {
        let normalized = ((frequency / 30.0).ln() / (20_000.0_f32 / 30.0).ln()).clamp(0.0, 1.0);
        (normalized * 63.0).round() as usize
    }

    fn analyze(&mut self, powers: &[f32; 5], delta_seconds: f64) -> f32 {
        let core_bass_power = powers[0].max(powers[1] * 0.9);
        let supported_upper_bass_power = powers[2].min(core_bass_power * 1.35);
        let bass_power = core_bass_power + supported_upper_bass_power * 0.2;
        let reference_power = (powers[3] * 2.3).max(powers[4] * 1.6);
        let bass_decibels = power_to_db(bass_power);
        let reference_decibels = power_to_db(reference_power);

        if !self.initialized {
            self.slow_bass_db = SPECTRUM_DB_FLOOR.max(bass_decibels - 14.0);
            self.slow_reference_db = reference_decibels;
            self.previous_bass_db = bass_decibels;
            self.initialized = true;
        }

        let frame_bass_rise = (bass_decibels - self.previous_bass_db).max(0.0);
        self.previous_bass_db = bass_decibels;
        let bass_rise = (bass_decibels - self.slow_bass_db).max(0.0);
        let reference_rise = (reference_decibels - self.slow_reference_db).max(0.0);
        let dominance = smooth_range(bass_decibels - reference_decibels, 0.0, 8.0);
        let sharp_attack_target = if bass_decibels >= -45.0 {
            smooth_range(frame_bass_rise, 7.0, 14.0)
        } else {
            0.0
        };
        self.sharp_attack =
            sharp_attack_target.max(self.sharp_attack * (-delta_seconds / 0.09).exp() as f32);

        let harmonic_bass_confidence = smooth_range(dominance, 0.12, 0.3) * self.sharp_attack * 0.9;
        let bass_confidence = dominance.max(harmonic_bass_confidence);
        let reference_rise_rejection = 0.7 - dominance * 0.35;
        let bass_only_rise = bass_rise - reference_rise * reference_rise_rejection;

        self.slow_bass_db =
            smooth_feature_baseline(self.slow_bass_db, bass_decibels, delta_seconds as f32);
        self.slow_reference_db = smooth_feature_baseline(
            self.slow_reference_db,
            reference_decibels,
            delta_seconds as f32,
        );

        let level = smooth_range(
            bass_decibels,
            SPECTRUM_BASS_LEVEL_FLOOR,
            SPECTRUM_BASS_LEVEL_CEILING,
        );
        let transient = smooth_range(bass_only_rise, 1.2, 7.0);
        level * bass_confidence * (0.1 + 0.9 * transient)
    }

    fn confirm_response(&mut self, value: f32, allow_immediate_trigger: bool) -> f32 {
        self.unprocessed_history[self.history_write] = value;
        self.history_write = (self.history_write + 1) % self.unprocessed_history.len();
        self.history_count = (self.history_count + 1).min(self.unprocessed_history.len());
        if allow_immediate_trigger {
            return value;
        }
        if self.history_count == 1 {
            return 0.0;
        }
        if self.history_count == 2 {
            return self.unprocessed_history[0].min(self.unprocessed_history[1]);
        }
        let a = self.unprocessed_history[0];
        let b = self.unprocessed_history[1];
        let c = self.unprocessed_history[2];
        a + b + c - a.min(b).min(c) - a.max(b).max(c)
    }
}

impl Default for AudioAnalyzer {
    fn default() -> Self {
        Self {
            recent: [0.0; 4],
            recent_write: 0,
            target: 0.0,
            power: 0.0,
            bass_baseline_db: SILENCE_DB,
            reference_baseline_db: SILENCE_DB,
            previous_bass_db: SILENCE_DB,
            sharp_attack: 0.0,
            response_history: [0.0; 3],
            history_write: 0,
            history_count: 0,
            initialized: false,
            transient_detector: TransientDetector::default(),
            transient_response: 0.0,
            previous_waveform_ns: 0,
            previous_fft_ns: 0,
        }
    }
}

impl AudioAnalyzer {
    pub fn process_waveform(&mut self, waveform: &[i8], sample_rate_hz: f32, timestamp_ns: i64) {
        if waveform.is_empty()
            || !sample_rate_hz.is_finite()
            || !(2_000.0..=192_000.0).contains(&sample_rate_hz)
        {
            return;
        }
        let elapsed = elapsed_seconds(self.previous_waveform_ns, timestamp_ns);
        self.previous_waveform_ns = timestamp_ns;
        self.transient_response = self
            .transient_detector
            .process(waveform, sample_rate_hz)
            .max(self.transient_response * decay(elapsed, 0.063));
    }

    pub fn process_pcm_waveform(
        &mut self,
        samples: &[f32],
        sample_rate_hz: f32,
        timestamp_ns: i64,
    ) {
        if samples.is_empty()
            || !sample_rate_hz.is_finite()
            || !(2_000.0..=192_000.0).contains(&sample_rate_hz)
        {
            return;
        }
        let elapsed = elapsed_seconds(self.previous_waveform_ns, timestamp_ns);
        self.previous_waveform_ns = timestamp_ns;
        self.transient_response = self
            .transient_detector
            .process_pcm(samples, sample_rate_hz)
            .max(self.transient_response * decay(elapsed, 0.063));
    }

    pub fn process_fft(&mut self, fft: &[i8], sample_rate_hz: f32, timestamp_ns: i64) -> f32 {
        if fft.len() < 8
            || !sample_rate_hz.is_finite()
            || !(2_000.0..=192_000.0).contains(&sample_rate_hz)
        {
            return 0.0;
        }
        let powers = [
            band_power(fft, sample_rate_hz, 30.0, 105.0),
            band_power(fft, sample_rate_hz, 75.0, 155.0),
            band_power(fft, sample_rate_hz, 145.0, 210.0),
            band_power(fft, sample_rate_hz, 155.0, 380.0),
            band_power(fft, sample_rate_hz, 380.0, 760.0),
        ];
        self.process_spectrum_powers(&powers, timestamp_ns)
    }

    pub fn process_spectrum_powers(&mut self, powers: &[f32; 5], timestamp_ns: i64) -> f32 {
        let elapsed = elapsed_seconds(self.previous_fft_ns, timestamp_ns);
        self.previous_fft_ns = timestamp_ns;

        let low_bass = powers[0];
        let bass_note = powers[1];
        let upper_bass = powers[2];
        let low_mid = powers[3];
        let mid = powers[4];
        let core_bass = low_bass.max(bass_note * 0.9);
        let supported_upper = upper_bass.min(core_bass * 1.35);
        let bass_db = power_to_db(core_bass + supported_upper * 0.2);
        let reference_db = power_to_db((low_mid * 2.3).max(mid * 1.6));

        if !self.initialized {
            self.bass_baseline_db = SILENCE_DB.max(bass_db - 7.0);
            self.reference_baseline_db = reference_db;
            self.previous_bass_db = bass_db;
            self.initialized = true;
            return 0.0;
        }

        let frame_rise = (bass_db - self.previous_bass_db).max(0.0);
        self.previous_bass_db = bass_db;
        let rise = (bass_db - self.bass_baseline_db).max(0.0);
        let reference_rise = (reference_db - self.reference_baseline_db).max(0.0);
        let dominance = smooth_range(bass_db - reference_db, 0.0, 8.0);
        let sharp_target = if bass_db >= -45.0 {
            smooth_range(frame_rise, 7.0, 14.0)
        } else {
            0.0
        };
        self.sharp_attack = sharp_target.max(self.sharp_attack * decay(elapsed, 0.09));

        let harmonic_confidence = smooth_range(dominance, 0.12, 0.3) * self.sharp_attack * 0.9;
        let bass_confidence = dominance.max(harmonic_confidence);
        let rejection = 0.7 - dominance * 0.35;
        let bass_only_rise = rise - reference_rise * rejection;

        self.bass_baseline_db = follow_baseline(self.bass_baseline_db, bass_db, 1.1, 0.16, elapsed);
        self.reference_baseline_db =
            follow_baseline(self.reference_baseline_db, reference_db, 1.1, 0.16, elapsed);

        let level = smooth_range(bass_db, -50.0, -18.0);
        let transient = smooth_range(bass_only_rise, 1.2, 7.0);
        let unprocessed = level * bass_confidence * (0.1 + 0.9 * transient);
        let immediate = self.sharp_attack >= 0.72 && transient >= 0.32;
        let confirmed = self.confirm_response(unprocessed, immediate);

        self.recent[self.recent_write] = confirmed;
        self.recent_write = (self.recent_write + 1) % self.recent.len();
        let ramp = [0.1, 0.2, 0.3, 0.4];
        let weighted: f32 = (0..4)
            .map(|i| self.recent[(self.recent_write + i) % 4] * ramp[i])
            .sum();
        self.target = weighted.max(self.target * decay(elapsed, 1.0));
        self.power += (self.target - self.power) * (1.0 - decay(elapsed, 0.07));
        self.power
            .max(self.transient_response * level)
            .clamp(0.0, 1.0)
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    fn confirm_response(&mut self, value: f32, immediate: bool) -> f32 {
        self.response_history[self.history_write] = value;
        self.history_write = (self.history_write + 1) % 3;
        self.history_count = (self.history_count + 1).min(3);
        if immediate {
            return value;
        }
        if self.history_count == 1 {
            return 0.0;
        }
        if self.history_count == 2 {
            return self.response_history[0].min(self.response_history[1]);
        }
        let a = self.response_history[0];
        let b = self.response_history[1];
        let c = self.response_history[2];
        a + b + c - a.min(b).min(c) - a.max(b).max(c)
    }
}

fn band_power(fft: &[i8], sample_rate_hz: f32, minimum: f32, maximum: f32) -> f32 {
    let first = 1.max((minimum * fft.len() as f32 / sample_rate_hz).ceil() as usize);
    let last =
        (fft.len() / 2 - 1).min((maximum * fft.len() as f32 / sample_rate_hz).floor() as usize);
    if last < first {
        return 0.0;
    }
    let mut power = 0.0;
    for bin in first..=last {
        let real = fft[bin * 2] as f32 / 128.0;
        let imaginary = fft[bin * 2 + 1] as f32 / 128.0;
        power += real * real + imaginary * imaginary;
    }
    power / (last - first + 1) as f32
}

fn follow_baseline(current: f32, target: f32, attack: f32, release: f32, elapsed: f32) -> f32 {
    let time_constant = if target > current { attack } else { release };
    (current + (target - current) * (1.0 - decay(elapsed, time_constant))).max(SILENCE_DB)
}

fn elapsed_seconds(previous: i64, current: i64) -> f32 {
    let Some(delta) = current.checked_sub(previous) else {
        return DEFAULT_REPORT_INTERVAL_SECONDS;
    };
    if previous <= 0 || delta <= 0 {
        return DEFAULT_REPORT_INTERVAL_SECONDS;
    }
    (delta as f32 / 1_000_000_000.0).clamp(MIN_REPORT_INTERVAL_SECONDS, MAX_REPORT_INTERVAL_SECONDS)
}

fn decay(elapsed: f32, time_constant: f32) -> f32 {
    (-elapsed / time_constant).exp()
}

fn envelope(current: f64, target: f64, attack: f64, release: f64, sample_rate: f32) -> f64 {
    let seconds = if target > current { attack } else { release };
    let mix = 1.0 - (-1.0 / (sample_rate as f64 * seconds)).exp();
    current + (target - current) * mix
}

fn power_to_db(power: f32) -> f32 {
    10.0 * power.max(1e-12).log10()
}

fn smooth_range(value: f32, floor: f32, ceiling: f32) -> f32 {
    let x = ((value - floor) / (ceiling - floor)).clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

fn smooth_feature_baseline(current: f32, target: f32, elapsed: f32) -> f32 {
    let time_constant = if target > current { 1.1 } else { 0.16 };
    (current + (target - current) * (1.0 - (-elapsed / time_constant).exp())).max(SPECTRUM_DB_FLOOR)
}

fn smooth_quintic(value: f32) -> f32 {
    let x = value.clamp(0.0, 1.0);
    x * x * x * (x * (x * 6.0 - 15.0) + 10.0)
}

fn pcm_frequency_magnitude(samples: &[f32], sample_rate_hz: f32, frequency_hz: f32) -> f32 {
    let coefficient = (2.0 * std::f32::consts::PI * frequency_hz / sample_rate_hz).cos() * 2.0;
    let mut previous = 0.0;
    let mut previous_previous = 0.0;
    let denominator = (samples.len() * samples.len()) as f32;

    for (index, sample) in samples.iter().enumerate() {
        let position = index as f32 / (samples.len() - 1) as f32;
        let window = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * position).cos();
        let current = sample.clamp(-1.0, 1.0) * window + coefficient * previous - previous_previous;
        previous_previous = previous;
        previous = current;
    }

    let power = (previous * previous + previous_previous * previous_previous
        - coefficient * previous * previous_previous)
        .max(0.0)
        / denominator;
    (power.sqrt() * 2.0).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 空输入不会产生脉冲() {
        let mut analyzer = AudioAnalyzer::default();
        analyzer.process_waveform(&[], 48_000.0, 1);
        assert_eq!(analyzer.process_fft(&[], 48_000.0, 2), 0.0);
    }

    #[test]
    fn 无效输入不会改变分析器状态() {
        let mut analyzer = AudioAnalyzer::default();
        analyzer.process_waveform(&[0, 1, 2], 0.0, 1);
        assert_eq!(analyzer.process_fft(&[0; 8], f32::NAN, 2), 0.0);
    }

    #[test]
    fn 衰减与时间常数相关() {
        assert!(decay(0.1, 0.1) < 0.4);
    }

    #[test]
    fn 频谱分析器的静音输入保持静音() {
        let mut analyzer = SpectrumAnalyzer::default();
        analyzer.push(&[0.0; 128], 1.0);
        assert_eq!(analyzer.get_interpolated(1.0), 0.0);
    }

    #[test]
    fn 频谱分析器可以重置() {
        let mut analyzer = SpectrumAnalyzer::default();
        analyzer.push(&[1.0; 128], 1.0);
        analyzer.reset();
        assert_eq!(analyzer.get_interpolated(1.0), 0.0);
    }

    #[test]
    fn 频谱分析器可以接收波形输入() {
        let mut analyzer = SpectrumAnalyzer::default();
        analyzer.push_pcm(&[0.0; 512], 48_000.0, 1.0);
        assert_eq!(analyzer.get_interpolated(1.0), 0.0);
    }

    #[test]
    fn 频谱鼓点后会及时回落() {
        let mut analyzer = SpectrumAnalyzer::default();
        let mut timestamp = 1.0;
        let silence = [0.0; 5];
        let kick = [1.0, 1.0, 0.2, 0.0001, 0.0001];

        for _ in 0..4 {
            timestamp += SPECTRUM_REPORT_INTERVAL_SECONDS;
            analyzer.push_powers(&silence, 0.0, timestamp);
            analyzer.get_interpolated(timestamp);
        }

        let mut peak = 0.0_f32;
        for _ in 0..4 {
            timestamp += SPECTRUM_REPORT_INTERVAL_SECONDS;
            analyzer.push_powers(&kick, 1.0, timestamp);
            peak = peak.max(analyzer.get_interpolated(timestamp));
        }

        let mut released = peak;
        for _ in 0..12 {
            timestamp += SPECTRUM_REPORT_INTERVAL_SECONDS;
            analyzer.push_powers(&silence, 0.0, timestamp);
            released = analyzer.get_interpolated(timestamp);
        }

        let mut second_peak = released;
        for _ in 0..4 {
            timestamp += SPECTRUM_REPORT_INTERVAL_SECONDS;
            analyzer.push_powers(&kick, 1.0, timestamp);
            second_peak = second_peak.max(analyzer.get_interpolated(timestamp));
        }

        assert!(peak > 0.5, "鼓点峰值过低：{peak}");
        assert!(released < 0.2, "鼓点释放过慢：{released}");
        assert!(
            second_peak > released + 0.5,
            "连续鼓点没有形成明显峰谷：{released} -> {second_peak}"
        );
    }

    #[test]
    fn 高频打击乐也会触发脉冲() {
        let mut analyzer = SpectrumAnalyzer::default();
        let mut timestamp = 1.0;
        let base = [0.08; 128];

        for _ in 0..5 {
            timestamp += SPECTRUM_REPORT_INTERVAL_SECONDS;
            analyzer.push(&base, timestamp);
            analyzer.get_interpolated(timestamp);
        }

        let mut clap = base;
        for index in 43..64 {
            clap[index] = 0.9;
            clap[index + 64] = 0.9;
        }
        timestamp += SPECTRUM_REPORT_INTERVAL_SECONDS;
        analyzer.push(&clap, timestamp);
        let peak = analyzer.get_interpolated(timestamp);

        assert!(peak > 0.5, "高频打击乐脉冲过低：{peak}");
    }

    #[test]
    fn pcm低频瞬态使用安卓经典响应() {
        let mut analyzer = SpectrumAnalyzer::default();
        let sample_rate = 48_000.0_f32;
        let mut sample_index = 0_usize;
        let mut peak = 0.0_f32;
        let mut released = 0.0_f32;

        for _ in 0..300 {
            let mut frame = [0.0_f32; 512];
            for sample in &mut frame {
                let seconds = sample_index as f32 / sample_rate;
                if (1.0..1.12).contains(&seconds) {
                    *sample = (seconds * 80.0 * std::f32::consts::TAU).sin() * 0.9;
                }
                sample_index += 1;
            }
            let timestamp = sample_index as f64 / sample_rate as f64;
            analyzer.push_pcm(&frame, sample_rate, timestamp);
            let pulse = analyzer.get_interpolated(timestamp);
            if timestamp >= 1.0 {
                peak = peak.max(pulse);
            }
            if timestamp >= 3.0 {
                released = pulse;
            }
        }

        assert!(peak > 0.5, "PCM 低频瞬态峰值过低：{peak}");
        assert!(released < 0.2, "PCM 低频瞬态释放过慢：{released}");
    }

    #[test]
    fn pcm重复鼓点会持续重新触发() {
        let mut analyzer = SpectrumAnalyzer::default();
        let sample_rate = 48_000.0_f32;
        let mut sample_index = 0_usize;
        let mut late_onset = 0.0_f32;

        for _ in 0..480 {
            let mut frame = [0.0_f32; 512];
            for sample in &mut frame {
                let seconds = sample_index as f32 / sample_rate;
                let beat_phase = seconds % 0.5;
                if beat_phase < 0.08 {
                    let envelope = 1.0 - beat_phase / 0.08;
                    *sample = (seconds * 82.0 * std::f32::consts::TAU).sin() * envelope * 0.85
                        + (seconds * 2_200.0 * std::f32::consts::TAU).sin() * envelope * 0.12;
                }
                sample_index += 1;
            }
            let timestamp = sample_index as f64 / sample_rate as f64;
            analyzer.push_pcm(&frame, sample_rate, timestamp);
            analyzer.get_interpolated(timestamp);
            if timestamp >= 3.0 {
                late_onset = late_onset.max(analyzer.pcm_spectral_onset);
            }
        }

        assert!(late_onset > 0.5, "后续鼓点没有重新触发：{late_onset}");
    }
}
