/**
 * Build the request body for `zai.audio.asr.create`. Kept as a pure function
 * so the request shape is unit-testable without touching the SDK.
 *
 * The SDK's `audio.asr.create` accepts `{ file_base64: string }` and returns
 * either a string or an object with a `text` field — the AsrProvider in
 * `ai.ts` normalizes both to a string.
 */

export interface AsrRequest {
  file_base64: string
}

export function formatAsrRequest(audioBase64: string): AsrRequest {
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    throw new Error('formatAsrRequest: audioBase64 must be a non-empty string')
  }
  return { file_base64: audioBase64 }
}
