/**
 * Audio helpers — pure functions that work with browser Blob/File objects
 * and can be exercised in unit tests (Bun implements Blob and File globally).
 *
 * The actual `MediaRecorder` plumbing lives in the React component; this
 * module only handles the pure transforms after a Blob has been captured.
 */

export type AudioFormat = 'audio/webm' | 'audio/ogg' | 'audio/mp3' | 'audio/mpeg' | 'audio/wav'

const VALID_AUDIO_TYPES: AudioFormat[] = [
  'audio/webm',
  'audio/ogg',
  'audio/mp3',
  'audio/mpeg',
  'audio/wav',
]

/**
 * Returns true for any MIME type we accept for transcription. `audio/mp3` is
 * the canonical spec'd name; `audio/mpeg` is what real MP3 files report in
 * practice, so we accept both.
 */
export function validateAudioFormat(blob: Blob): boolean {
  if (!blob || !blob.type) return false
  return VALID_AUDIO_TYPES.includes(blob.type as AudioFormat)
}

/**
 * Wrap a Blob in a File with a filename derived from the format. Used when
 * uploading to multipart endpoints (the API also accepts base64, so this is
 * primarily for symmetry with `<input type="file">` consumers).
 */
export function audioBlobToFile(blob: Blob, filename: string): File {
  return new File([blob], filename, { type: blob.type })
}

/**
 * Base64-encode a Blob's bytes. In the browser this uses FileReader; in Bun /
 * Node (tests) it falls back to `Blob.arrayBuffer()` + `btoa`. Returns the
 * raw base64 string with no data-URL prefix — that's what `zai.audio.asr.create`
 * expects in its `file_base64` field.
 */
export function encodeAudioToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'undefined') {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = reader.result as string
        const base64 = result.includes(',') ? result.split(',')[1] : result
        resolve(base64)
      }
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
      return
    }
    // Bun / Node fallback — no FileReader available.
    blob
      .arrayBuffer()
      .then((buf) => {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        resolve(btoa(binary))
      })
      .catch(reject)
  })
}

/**
 * Compute a friendly duration string for the recording timer (mm:ss or h:mm:ss).
 * Pure / synchronous so it's trivially testable.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (hh > 0) return `${hh}:${pad(mm)}:${pad(ss)}`
  return `${pad(mm)}:${pad(ss)}`
}
