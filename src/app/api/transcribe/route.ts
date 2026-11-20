/**
 * POST /api/transcribe
 *
 * Accepts either:
 *   - multipart/form-data with a `file` field (the recorded Blob)
 *   - application/json: { audioBase64: string }
 *
 * Calls `getAsrProvider().transcribe({ file_base64 })` and returns the
 * transcript as plain text. The provider is pluggable — when
 * `VTT_DISABLE_ASR=1` is set, a MockAsrProvider returns a deterministic
 * transcript so the UI is demoable offline.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAsrProvider } from '@/lib/ai'
import { formatAsrRequest } from '@/lib/asr-builder'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    let audioBase64: string | null = null

    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const file = form.get('file')
      if (file instanceof Blob) {
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i])
        }
        audioBase64 = btoa(binary)
      }
    } else if (contentType.includes('application/json')) {
      const body = await req.json()
      audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64 : null
    } else {
      // Best-effort: try JSON anyway.
      try {
        const body = await req.json()
        audioBase64 = typeof body?.audioBase64 === 'string' ? body.audioBase64 : null
      } catch {
        audioBase64 = null
      }
    }

    if (!audioBase64) {
      return NextResponse.json(
        { error: 'Audio required — send multipart file= or JSON { audioBase64 }.' },
        { status: 400 },
      )
    }

    const request = formatAsrRequest(audioBase64)
    const provider = getAsrProvider()
    const transcript = await provider.transcribe(request)

    return NextResponse.json({ transcript })
  } catch (e) {
    console.error('[transcribe] error:', e)
    return NextResponse.json(
      { error: `Transcription failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
