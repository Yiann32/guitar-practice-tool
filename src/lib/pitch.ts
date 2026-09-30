import type { PitchResult } from '../types'
import { frequencyToMidiFloat, midiToFullName } from './music'

const EMPTY_RESULT: PitchResult = {
  frequency: null,
  midi: null,
  note: null,
  octave: null,
  cents: 0,
  confidence: 0,
  rms: 0,
}

export function rmsOf(buffer: Float32Array): number {
  let sum = 0
  for (let index = 0; index < buffer.length; index += 1) {
    sum += buffer[index] * buffer[index]
  }
  return Math.sqrt(sum / buffer.length)
}

export function rmsToDb(rms: number): number {
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY
}

export function detectPitchYin(
  buffer: Float32Array,
  sampleRate: number,
  minHz = 70,
  maxHz = 1400,
  threshold = 0.18,
): PitchResult {
  const rms = rmsOf(buffer)
  if (rms < 0.006) return { ...EMPTY_RESULT, rms }

  const minTau = Math.max(2, Math.floor(sampleRate / maxHz))
  const maxTau = Math.min(Math.floor(sampleRate / minHz), Math.floor(buffer.length / 2))
  if (maxTau <= minTau) return { ...EMPTY_RESULT, rms }

  const difference = new Float32Array(maxTau + 1)
  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0
    for (let index = 0; index < buffer.length - tau; index += 1) {
      const delta = buffer[index] - buffer[index + tau]
      sum += delta * delta
    }
    difference[tau] = sum
  }

  const normalized = new Float32Array(maxTau + 1)
  let runningSum = 0
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau]
    normalized[tau] = runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum
  }

  let bestTau = -1
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (normalized[tau] < threshold) {
      while (tau + 1 <= maxTau && normalized[tau + 1] < normalized[tau]) {
        tau += 1
      }
      bestTau = tau
      break
    }
  }

  if (bestTau < 0) {
    let minValue = Number.POSITIVE_INFINITY
    for (let tau = minTau; tau <= maxTau; tau += 1) {
      if (normalized[tau] < minValue) {
        minValue = normalized[tau]
        bestTau = tau
      }
    }
    if (bestTau < 0 || minValue > 0.5) {
      return { ...EMPTY_RESULT, rms }
    }
  }

  let refinedTau = bestTau
  if (bestTau > minTau && bestTau < maxTau) {
    const left = normalized[bestTau - 1]
    const center = normalized[bestTau]
    const right = normalized[bestTau + 1]
    const denominator = 2 * (2 * center - left - right)
    if (denominator !== 0) {
      refinedTau += (right - left) / denominator
    }
  }

  const frequency = sampleRate / refinedTau
  if (!Number.isFinite(frequency) || frequency < minHz || frequency > maxHz) {
    return { ...EMPTY_RESULT, rms }
  }

  const midiFloat = frequencyToMidiFloat(frequency)
  const midi = Math.round(midiFloat)
  const cents = (midiFloat - midi) * 100
  const confidence = Math.max(0, Math.min(1, 1 - normalized[bestTau]))
  return {
    frequency,
    midi,
    note: midiToFullName(midi),
    octave: Math.floor(midi / 12) - 1,
    cents,
    confidence,
    rms,
  }
}
