/**
 * POST /api/voice-memos/[id]/transcribe
 *
 * Reads the audio file at `audioPath`, base64-encodes it, and runs it through
 * `getAsrProvider().transcribe`. Sets `transcript` on the VoiceMemo row.
 *
 * Used by the sidebar "Transcribe" button on memos that haven't been
 * transcribed yet (or that need re-transcription).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAsrProvider } from '@/lib/ai'
import { formatAsrRequest } from '@/lib/asr-builder'
import { promises as fs } from 'fs'
import path from 'path'

export const runtime = 'nodejs'

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const memo = await db.voiceMemo.findUnique({ where: { id } })
  if (!memo) {
    return NextResponse.json({ error: 'Voice memo not found' }, { status: 404 })
  }
  if (!memo.audioPath) {
    return NextResponse.json({ error: 'Voice memo has no audio file' }, { status: 400 })
  }

  const fullPath = path.isAbsolute(memo.audioPath)
    ? memo.audioPath
    : path.join(process.cwd(), memo.audioPath)

  let bytes: Uint8Array
  try {
    const buf = await fs.readFile(fullPath)
    bytes = new Uint8Array(buf)
  } catch (e) {
    console.error('[transcribe-memo] file read error:', e)
    return NextResponse.json({ error: `Audio file not readable: ${(e as Error).message}` }, { status: 500 })
  }

  const audioBase64 = encodeBase64(bytes)
  const provider = getAsrProvider()

  try {
    const request = formatAsrRequest(audioBase64)
    const transcript = await provider.transcribe(request)
    const updated = await db.voiceMemo.update({
      where: { id },
      data: { transcript },
    })
    return NextResponse.json({ memo: updated })
  } catch (e) {
    console.error('[transcribe-memo] ASR error:', e)
    return NextResponse.json(
      { error: `Transcription failed: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
