/**
 * GET /api/stats — corpus size summary (used by the sidebar header).
 *
 * Returns { tasks, voiceMemos, transcribed }.
 */

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  const tasks = await db.task.count()
  const voiceMemos = await db.voiceMemo.count()
  const transcribed = await db.voiceMemo.count({
    where: { NOT: { transcript: null } },
  })
  return NextResponse.json({ tasks, voiceMemos, transcribed })
}
