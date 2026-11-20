/**
 * GET  /api/voice-memos      — list voice memos (newest first)
 * POST /api/voice-memos      — save a new voice memo
 *
 * Voice memo body: { audioBase64: string, durationSec?: number }
 *
 * The audio bytes are written to `./audio/<id>.webm` on disk and the path is
 * stored in `audioPath`. The base64 is decoded server-side so the client
 * doesn't need to upload a File object — JSON is enough.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { promises as fs } from 'fs'
import path from 'path'

export const runtime = 'nodejs'

async function ensureAudioDir(): Promise<string> {
  const audioDir = path.join(process.cwd(), 'audio')
  await fs.mkdir(audioDir, { recursive: true })
  return audioDir
}

function decodeBase64(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:audio\/[a-z0-9]+;base64,/, '')
  const binary = atob(cleaned)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function GET() {
  const memos = await db.voiceMemo.findMany({
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json({ memos })
}

export async function POST(req: NextRequest) {
  let body: { audioBase64?: string; durationSec?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const audioBase64 = body?.audioBase64
  if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
    return NextResponse.json({ error: 'audioBase64 is required' }, { status: 400 })
  }

  const durationSec = Number.isFinite(body?.durationSec) ? Math.max(0, Math.floor(body.durationSec as number)) : 0

  // Create the row first to get a stable id, then write the audio file.
  const memo = await db.voiceMemo.create({
    data: {
      audioPath: '', // placeholder, updated below
      durationSec,
    },
  })

  try {
    const audioDir = await ensureAudioDir()
    const filename = `${memo.id}.webm`
    const fullPath = path.join(audioDir, filename)
    const bytes = decodeBase64(audioBase64)
    await fs.writeFile(fullPath, bytes)

    const updated = await db.voiceMemo.update({
      where: { id: memo.id },
      data: { audioPath: `audio/${filename}` },
    })

    return NextResponse.json({ memo: updated }, { status: 201 })
  } catch (e) {
    // Best-effort cleanup of the placeholder row.
    try {
      await db.voiceMemo.delete({ where: { id: memo.id } })
    } catch {
      /* ignore */
    }
    console.error('[voice-memos] error:', e)
    return NextResponse.json(
      { error: `Failed to save audio: ${(e as Error).message}` },
      { status: 500 },
    )
  }
}
