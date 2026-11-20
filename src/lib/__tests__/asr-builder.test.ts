/**
 * Bun-native unit tests for the ASR request builder.
 * Run: `bun test`
 */

import { test, expect, describe } from 'bun:test'
import { formatAsrRequest } from '../asr-builder'

describe('formatAsrRequest', () => {
  test('returns an object with a file_base64 field', () => {
    const req = formatAsrRequest('aGk=')
    expect(req).toHaveProperty('file_base64')
  })

  test('preserves the audioBase64 value in file_base64', () => {
    const req = formatAsrRequest('aGk=')
    expect(req.file_base64).toBe('aGk=')
  })

  test('accepts a longer base64 string', () => {
    const long = 'A'.repeat(1024)
    const req = formatAsrRequest(long)
    expect(req.file_base64).toBe(long)
  })

  test('throws on empty string', () => {
    expect(() => formatAsrRequest('')).toThrow()
  })

  test('throws on non-string input', () => {
    expect(() => formatAsrRequest(null as unknown as string)).toThrow()
    expect(() => formatAsrRequest(undefined as unknown as string)).toThrow()
  })
})
