(function () {
  const DB_FLOOR = -72;
  const BASS_LEVEL_FLOOR = -50;
  const BASS_LEVEL_CEILING = -18;
  const BASS_DOMINANCE_FLOOR = 0;
  const BASS_DOMINANCE_CEILING = 8;
  const BASS_RISE_FLOOR = 1.2;
  const BASS_RISE_CEILING = 7;
  const SHARP_ATTACK_LEVEL_FLOOR = -45;
  const SHARP_ATTACK_RISE_FLOOR = 7;
  const SHARP_ATTACK_RISE_CEILING = 14;
  const SHARP_ATTACK_RESPONSE = 0.72;
  const HARMONIC_CONFIDENCE_FLOOR = 0.12;
  const HARMONIC_CONFIDENCE_CEILING = 0.3;
  const HARMONIC_BASS_ATTACK_BOOST = 0.9;
  const SUSTAINED_BASS_RESPONSE = 0.1;
  const SPECTRUM_SAMPLE_RAMP = [0.1, 0.2, 0.3, 0.4];
  const TARGET_RELEASE_SECONDS = 1;
  const POWER_FOLLOW_SECONDS = 0.07;
  const LOW_BASS_START = 30;
  const LOW_BASS_END = 105;
  const BASS_NOTE_START = 75;
  const BASS_NOTE_END = 155;
  const UPPER_BASS_START = 145;
  const UPPER_BASS_END = 210;
  const LOW_MID_START = 155;
  const LOW_MID_END = 380;
  const MID_START = 380;
  const MID_END = 760;
  const BASELINE_ATTACK_SECONDS = 1.1;
  const BASELINE_RELEASE_SECONDS = 0.16;
  const CONFIRMATION_WINDOW_SECONDS = 0.09;
  const REPORT_INTERVAL_SECONDS = 1 / 30;
  const SPECTRUM_BIN_COUNT = 64;
  const SPECTRAL_FLUX_HISTORY_SIZE = 30;
  const SPECTRAL_FLUX_LOG_GAIN = 40;
  const SPECTRAL_FLUX_THRESHOLD_MULTIPLIER = 1.35;
  const SPECTRAL_FLUX_MINIMUM_LEVEL = 0.01;
  const SPECTRAL_FLUX_FULL_LEVEL = 0.06;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lerp(from, to, amount) {
    return from + (to - from) * amount;
  }

  function smoothstep(value) {
    const x = clamp(value, 0, 1);
    return x * x * (3 - 2 * x);
  }

  function smoothRange(value, floor, ceiling) {
    return smoothstep((value - floor) / (ceiling - floor));
  }

  function db(power) {
    return 10 * Math.log10(Math.max(power, 1e-12));
  }

  function responseToEnergy(response) {
    return response * response;
  }

  class AppleMusicSpectrumAnalysis {
    constructor() {
      this.reset();
    }

    reset() {
      this.featureState = {
        slowBassDb: DB_FLOOR,
        slowReferenceDb: DB_FLOOR,
        previousBassDb: DB_FLOOR,
        sharpAttack: 0,
        initialized: false,
      };
      this.previousTimestamp = 0;
      this.currentReportTimestamp = 0;
      this.previousReportTimestamp = 0;
      this.previousReportPower = 0;
      this.currentReportPower = 0;
      this.unprocessedHistory = [0, 0, 0];
      this.historyWriteIndex = 0;
      this.historyCount = 0;
      this.recentSpectrumSamples = [0, 0, 0, 0];
      this.recentSpectrumWriteIndex = 0;
      this.targetPower = 0;
      this.power = 0;
      this.previousSpectrum = new Array(SPECTRUM_BIN_COUNT).fill(0);
      this.spectrumInitialized = false;
      this.spectralFluxHistory = [];
      this.currentOnset = 0;
    }

    push(audio, timestamp) {
      if (!audio || audio.length < 2) return;
      const half = Math.floor(audio.length / 2);
      const powers = this.readPowers(audio, half);
      const onset = this.analyzeSpectralFlux(this.readSpectrum(audio, half));
      const deltaSeconds = this.previousTimestamp > 0
        ? clamp(timestamp - this.previousTimestamp, 0, 0.25)
        : REPORT_INTERVAL_SECONDS;
      this.previousTimestamp = timestamp;
      const response = this.analyze(powers, deltaSeconds);
      const confirmed = this.confirmResponse(response, response >= SHARP_ATTACK_RESPONSE);
      this.recentSpectrumSamples[this.recentSpectrumWriteIndex] = confirmed;
      this.recentSpectrumWriteIndex = (this.recentSpectrumWriteIndex + 1) % this.recentSpectrumSamples.length;
      this.currentOnset = onset;
      let weighted = 0;
      for (let index = 0; index < this.recentSpectrumSamples.length; index += 1) {
        const sampleIndex = (this.recentSpectrumWriteIndex + index) % this.recentSpectrumSamples.length;
        weighted += this.recentSpectrumSamples[sampleIndex] * SPECTRUM_SAMPLE_RAMP[index];
      }
      this.targetPower = Math.max(
        weighted,
        this.targetPower * Math.exp(-deltaSeconds / TARGET_RELEASE_SECONDS),
      );
      this.power += (this.targetPower - this.power)
        * (1 - Math.exp(-deltaSeconds / POWER_FOLLOW_SECONDS));
      this.previousReportPower = this.currentReportPower;
      this.currentReportPower = Math.max(this.power, onset);
      this.previousReportTimestamp = this.currentReportTimestamp;
      this.currentReportTimestamp = timestamp;
    }

    readPowers(audio, half) {
      const bands = [
        [LOW_BASS_START, LOW_BASS_END],
        [BASS_NOTE_START, BASS_NOTE_END],
        [UPPER_BASS_START, UPPER_BASS_END],
        [LOW_MID_START, LOW_MID_END],
        [MID_START, MID_END],
      ];
      const result = [];
      for (const [startHz, endHz] of bands) {
        const left = this.averageBandPower(audio, 0, half, startHz, endHz);
        const right = this.averageBandPower(audio, half, audio.length, startHz, endHz);
        result.push((left + right) * 0.5);
      }
      return result;
    }

    readSpectrum(audio, half) {
      const spectrum = new Array(SPECTRUM_BIN_COUNT).fill(0);
      if (half <= 0) return spectrum;
      for (let index = 0; index < spectrum.length; index += 1) {
        const sourceIndex = half === 1
          ? 0
          : Math.floor(index * (half - 1) / (SPECTRUM_BIN_COUNT - 1));
        const left = Math.max(0, Number(audio[sourceIndex]) || 0);
        const rightValue = Number(audio[half + sourceIndex]);
        const right = Number.isFinite(rightValue) ? Math.max(0, rightValue) : left;
        spectrum[index] = (left + right) * 0.5;
      }
      return spectrum;
    }

    analyzeSpectralFlux(spectrum) {
      const current = spectrum.map((value) => Math.log1p(SPECTRAL_FLUX_LOG_GAIN * Math.max(0, value)));
      const level = current.reduce((total, value) => total + value, 0) / current.length;
      if (!this.spectrumInitialized) {
        this.previousSpectrum = current;
        this.spectrumInitialized = true;
        return 0;
      }

      const bands = [
        [0, 20, 1],
        [20, 43, 0.85],
        [43, 64, 0.65],
      ];
      let flux = 0;
      for (const [start, end, weight] of bands) {
        let positiveChange = 0;
        let currentEnergy = 0;
        for (let index = start; index < end; index += 1) {
          positiveChange += Math.max(0, current[index] - this.previousSpectrum[index]);
          currentEnergy += current[index];
        }
        flux = Math.max(flux, weight * positiveChange / (currentEnergy + 1e-5));
      }
      this.previousSpectrum = current;

      const baseline = this.spectralFluxMedian();
      this.spectralFluxHistory.push(flux);
      if (this.spectralFluxHistory.length > SPECTRAL_FLUX_HISTORY_SIZE) {
        this.spectralFluxHistory.shift();
      }
      if (this.spectralFluxHistory.length < 4 || level <= SPECTRAL_FLUX_MINIMUM_LEVEL) return 0;

      const threshold = Math.max(1e-4, baseline * SPECTRAL_FLUX_THRESHOLD_MULTIPLIER);
      const onset = smoothRange(flux / threshold, 0.85, 2);
      return onset * smoothRange(
        level,
        SPECTRAL_FLUX_MINIMUM_LEVEL,
        SPECTRAL_FLUX_FULL_LEVEL,
      );
    }

    spectralFluxMedian() {
      if (!this.spectralFluxHistory.length) return 0;
      const values = [...this.spectralFluxHistory].sort((left, right) => left - right);
      const middle = Math.floor(values.length / 2);
      return values.length % 2
        ? values[middle]
        : (values[middle - 1] + values[middle]) * 0.5;
    }

    averageBandPower(audio, offset, end, startHz, endHz) {
      const start = Math.max(offset, offset + this.frequencyToIndex(startHz));
      const finish = Math.min(end, offset + this.frequencyToIndex(endHz) + 1);
      if (finish <= start) return 0;
      let total = 0;
      for (let index = start; index < finish; index += 1) {
        const value = Number(audio[index]) || 0;
        total += value * value;
      }
      return total / (finish - start);
    }

    frequencyToIndex(frequency) {
      const nyquist = 20000;
      const normalized = clamp(Math.log(frequency / 30) / Math.log(nyquist / 30), 0, 1);
      return Math.round(normalized * 63);
    }

    analyze(powers, deltaSeconds) {
      const coreBassPower = Math.max(powers[0], powers[1] * 0.9);
      const supportedUpperBassPower = Math.min(powers[2], coreBassPower * 1.35);
      const bassPower = coreBassPower + supportedUpperBassPower * 0.2;
      const referencePower = Math.max(powers[3] * 2.3, powers[4] * 1.6);
      const bassDecibels = db(bassPower);
      const referenceDecibels = db(referencePower);
      const state = this.featureState;

      if (!state.initialized) {
        state.slowBassDb = Math.max(DB_FLOOR, bassDecibels - BASS_RISE_CEILING);
        state.slowReferenceDb = referenceDecibels;
        state.previousBassDb = bassDecibels;
        state.initialized = true;
        return 0;
      }

      const frameBassRise = Math.max(0, bassDecibels - state.previousBassDb);
      state.previousBassDb = bassDecibels;
      const bassRise = Math.max(0, bassDecibels - state.slowBassDb);
      const referenceRise = Math.max(0, referenceDecibels - state.slowReferenceDb);
      const dominance = smoothRange(
        bassDecibels - referenceDecibels,
        BASS_DOMINANCE_FLOOR,
        BASS_DOMINANCE_CEILING,
      );
      const sharpAttackTarget = bassDecibels >= SHARP_ATTACK_LEVEL_FLOOR
        ? smoothRange(frameBassRise, SHARP_ATTACK_RISE_FLOOR, SHARP_ATTACK_RISE_CEILING)
        : 0;
      const sharpAttackDecay = Math.exp(-deltaSeconds / CONFIRMATION_WINDOW_SECONDS);
      state.sharpAttack = Math.max(sharpAttackTarget, state.sharpAttack * sharpAttackDecay);
      const harmonicBassConfidence = smoothRange(
        dominance,
        HARMONIC_CONFIDENCE_FLOOR,
        HARMONIC_CONFIDENCE_CEILING,
      ) * state.sharpAttack * HARMONIC_BASS_ATTACK_BOOST;
      const bassConfidence = Math.max(dominance, harmonicBassConfidence);
      const referenceRiseRejection = 0.7 - dominance * 0.35;
      const bassOnlyRise = bassRise - referenceRise * referenceRiseRejection;
      state.slowBassDb = this.smoothFeatureBaseline(state.slowBassDb, bassDecibels, deltaSeconds);
      state.slowReferenceDb = this.smoothFeatureBaseline(state.slowReferenceDb, referenceDecibels, deltaSeconds);
      const level = smoothRange(bassDecibels, BASS_LEVEL_FLOOR, BASS_LEVEL_CEILING);
      const transient = smoothRange(bassOnlyRise, BASS_RISE_FLOOR, BASS_RISE_CEILING);
      return clamp(level * bassConfidence * (
        SUSTAINED_BASS_RESPONSE + (1 - SUSTAINED_BASS_RESPONSE) * transient
      ), 0, 1);
    }

    smoothFeatureBaseline(current, target, seconds) {
      const timeConstant = target > current ? BASELINE_ATTACK_SECONDS : BASELINE_RELEASE_SECONDS;
      const amount = 1 - Math.exp(-seconds / timeConstant);
      return Math.max(DB_FLOOR, lerp(current, target, amount));
    }

    confirmResponse(response, allowImmediateTrigger) {
      this.unprocessedHistory[this.historyWriteIndex] = response;
      this.historyWriteIndex = (this.historyWriteIndex + 1) % this.unprocessedHistory.length;
      this.historyCount = Math.min(this.historyCount + 1, this.unprocessedHistory.length);
      if (allowImmediateTrigger) return response;
      if (this.historyCount === 2) return Math.min(this.unprocessedHistory[0], this.unprocessedHistory[1]);
      if (this.historyCount >= 3) {
        const [first, second, third] = this.unprocessedHistory;
        return first + second + third - Math.min(first, second, third) - Math.max(first, second, third);
      }
      return 0;
    }

    getInterpolated(timestamp) {
      if (!this.currentReportTimestamp || timestamp - this.currentReportTimestamp > 0.25) return 0;
      const reportSeconds = this.currentReportTimestamp - this.previousReportTimestamp;
      if (!this.previousReportTimestamp || reportSeconds <= 0) {
        return clamp(this.currentReportPower, 0, 1);
      }
      const sampleTimestamp = timestamp - reportSeconds;
      const amount = clamp(
        (sampleTimestamp - this.previousReportTimestamp) / reportSeconds,
        0,
        1,
      );
      return clamp(lerp(this.previousReportPower, this.currentReportPower, amount), 0, 1);
    }

    getScale(timestamp) {
      const power = this.getInterpolated(timestamp);
      return 1 + 0.33 * responseToEnergy(power);
    }
  }

  window.PearWallAudio = { AppleMusicSpectrumAnalysis };
}());
