/**
 * Bun-native unit tests for the audio handlers (pure functions over Blob/File).
 * Run: `bun test`
 */

import { test, expect, describe } from 'bun:test'
import {
  audioBlobToFile,
  validateAudioFormat,
  encodeAudioToBase64,
  formatDuration,
} from '../audio-handler'

describe('audioBlobToFile', () => {
  test('returns a File with the right name and type', () => {
    const blob = new Blob(['hello world'], { type: 'audio/webm' })
    const file = audioBlobToFile(blob, 'rec.webm')
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('rec.webm')
    expect(file.type).toBe('audio/webm')
  })

  test('preserves bytes', async () => {
    const blob = new Blob(['abc'], { type: 'audio/ogg' })
    const file = audioBlobToFile(blob, 'memo.ogg')
    const text = await file.text()
    expect(text).toBe('abc')
  })
})

describe('validateAudioFormat', () => {
  test('returns true for audio/webm', () => {
    expect(validateAudioFormat(new Blob([], { type: 'audio/webm' }))).toBe(true)
  })
  test('returns true for audio/ogg', () => {
    expect(validateAudioFormat(new Blob([], { type: 'audio/ogg' }))).toBe(true)
  })
  test('returns true for audio/mp3', () => {
    expect(validateAudioFormat(new Blob([], { type: 'audio/mp3' }))).toBe(true)
  })
  test('returns true for audio/mpeg (real MP3 reports this)', () => {
    expect(validateAudioFormat(new Blob([], { type: 'audio/mpeg' }))).toBe(true)
  })
  test('returns true for audio/wav', () => {
    expect(validateAudioFormat(new Blob([], { type: 'audio/wav' }))).toBe(true)
  })
  test('returns false for video/mp4', () => {
    expect(validateAudioFormat(new Blob([], { type: 'video/mp4' }))).toBe(false)
  })
  test('returns false for image/png', () => {
    expect(validateAudioFormat(new Blob([], { type: 'image/png' }))).toBe(false)
  })
  test('returns false for empty blob type', () => {
    expect(validateAudioFormat(new Blob([]))).toBe(false)
  })
  test('returns false for null/undefined', () => {
    expect(validateAudioFormat(null as unknown as Blob)).toBe(false)
    expect(validateAudioFormat(undefined as unknown as Blob)).toBe(false)
  })
})

describe('encodeAudioToBase64', () => {
  test('is a function (signature check)', () => {
    expect(typeof encodeAudioToBase64).toBe('function')
  })

  test('encodes a small blob to a base64 string that round-trips', async () => {
    const blob = new Blob(['hi'], { type: 'audio/webm' })
    const base64 = await encodeAudioToBase64(blob)
    expect(typeof base64).toBe('string')
    expect(base64.length).toBeGreaterThan(0)
    // Decode and verify round-trip — robust to either the FileReader or
    // arrayBuffer code path (Bun implements FileReader but the result of
    // readAsDataURL is a data URL with the raw base64 after the comma).
    const decoded = atob(base64)
    expect(decoded).toBe('hi')
  })

  test('does not include the data URL prefix', async () => {
    const blob = new Blob(['test'], { type: 'audio/webm' })
    const base64 = await encodeAudioToBase64(blob)
    expect(base64).not.toContain('data:')
    expect(base64).not.toContain('base64,')
  })
})

describe('formatDuration', () => {
  test('formats seconds as mm:ss', () => {
    expect(formatDuration(0)).toBe('00:00')
    expect(formatDuration(5)).toBe('00:05')
    expect(formatDuration(65)).toBe('01:05')
    expect(formatDuration(599)).toBe('09:59')
  })

  test('formats hours as h:mm:ss', () => {
    expect(formatDuration(3661)).toBe('1:01:01')
    expect(formatDuration(36000)).toBe('10:00:00')
  })

  test('clamps negative values to 00:00', () => {
    expect(formatDuration(-5)).toBe('00:00')
  })

  test('clamps NaN to 00:00', () => {
    expect(formatDuration(NaN)).toBe('00:00')
  })
})
