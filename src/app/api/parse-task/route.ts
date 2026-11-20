/**
 * POST /api/parse-task
 *
 * Body: { transcript: string }
 *
 * Runs the heuristic parser (`nl-parser.parseTask`) first. If the heuristic's
 * `confidence` is below `LLM_FALLBACK_THRESHOLD` and a non-mock LLM provider
 * is available, falls back to `task-parser-llm.parseTaskWithLlm` which asks
 * the model for strict JSON.
 *
 * Returns the parsed task with a `source` field indicating which path ran
 * ("heuristic" | "llm").
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseTask, LLM_FALLBACK_THRESHOLD, type ParsedTask } from '@/lib/nl-parser'
import { parseTaskWithLlm } from '@/lib/task-parser-llm'
import { getChatProvider } from '@/lib/ai'

export const runtime = 'nodejs'

interface ParseResponse {
  task: ParsedTask
  source: 'heuristic' | 'llm'
}

export async function POST(req: NextRequest) {
  let body: { transcript?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const transcript = (body?.transcript ?? '').trim()
  if (!transcript) {
    return NextResponse.json({ error: 'transcript is required' }, { status: 400 })
  }

  // 1. Heuristic pass — fast, deterministic, offline.
  const heuristic = parseTask(transcript)

  // 2. If confidence is high enough, return the heuristic result.
  if (heuristic.confidence >= LLM_FALLBACK_THRESHOLD) {
    const res: ParseResponse = { task: heuristic, source: 'heuristic' }
    return NextResponse.json(res)
  }

  // 3. Low confidence — try the LLM fallback (only if not explicitly disabled).
  if (process.env.VTT_DISABLE_LLM === '1') {
    const res: ParseResponse = { task: heuristic, source: 'heuristic' }
    return NextResponse.json(res)
  }

  try {
    const provider = getChatProvider()
    const llmTask = await parseTaskWithLlm(transcript, (prompt) =>
      provider.complete({
        systemPrompt: prompt,
        messages: [{ role: 'user', content: transcript }],
      }),
    )
    const res: ParseResponse = { task: llmTask, source: 'llm' }
    return NextResponse.json(res)
  } catch (e) {
    console.warn('[parse-task] LLM fallback failed, returning heuristic:', (e as Error).message)
    // Fall through to heuristic on LLM error.
    const res: ParseResponse = { task: heuristic, source: 'heuristic' }
    return NextResponse.json(res)
  }
}
