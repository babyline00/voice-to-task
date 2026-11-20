/**
 * GET  /api/tasks       — list tasks (filters: ?project=&priority=&status=)
 * POST /api/tasks       — create a task
 *
 * Task body: { title, dueAt?, priority?, project?, contextTags?,
 *              recurrenceRule?, rawTranscript?, audioPath?, source? }
 *
 * `contextTags` is accepted as either an array or a JSON-stringified array;
 * it's stored in SQLite as a JSON string (the schema's only way to hold a
 * list).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

interface TaskCreateBody {
  title?: string
  dueAt?: string | null
  priority?: string
  project?: string | null
  contextTags?: string[] | string | null
  recurrenceRule?: string | null
  rawTranscript?: string | null
  audioPath?: string | null
  source?: string
  status?: string
}

function normalizeTags(input: string[] | string | null | undefined): string {
  if (!input) return '[]'
  if (typeof input === 'string') {
    // Already JSON-stringified (e.g. from DB roundtrip) or comma-separated.
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) return JSON.stringify(parsed)
    } catch {
      /* not JSON */
    }
    const arr = input
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean)
    return JSON.stringify(arr)
  }
  if (Array.isArray(input)) {
    return JSON.stringify(input.map((t) => t.toLowerCase()))
  }
  return '[]'
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const project = url.searchParams.get('project') ?? undefined
  const priority = url.searchParams.get('priority') ?? undefined
  const status = url.searchParams.get('status') ?? 'active'

  const where: { project?: string; priority?: string; status?: string } = {
    status: status || 'active',
  }
  if (project) where.project = project
  if (priority) where.priority = priority

  const tasks = await db.task.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 200,
  })

  // Hydrate `contextTags` from JSON string to string[] for the client.
  return NextResponse.json({
    tasks: tasks.map((t) => ({
      ...t,
      contextTags: safeParseTags(t.contextTags),
    })),
  })
}

function safeParseTags(s: string | null): string[] {
  if (!s) return []
  try {
    const parsed = JSON.parse(s)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function POST(req: NextRequest) {
  let body: TaskCreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const title = (body.title ?? '').trim()
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }

  const dueAt = body.dueAt ? new Date(body.dueAt) : null
  if (dueAt && isNaN(dueAt.getTime())) {
    return NextResponse.json({ error: 'dueAt is not a valid date' }, { status: 400 })
  }

  const priority = ['high', 'medium', 'low'].includes(body.priority ?? 'medium')
    ? (body.priority as string)
    : 'medium'

  const task = await db.task.create({
    data: {
      title,
      dueAt: dueAt ?? undefined,
      priority,
      project: body.project?.trim() || null,
      contextTags: normalizeTags(body.contextTags),
      recurrenceRule: body.recurrenceRule?.trim() || null,
      rawTranscript: body.rawTranscript ?? null,
      audioPath: body.audioPath ?? null,
      source: body.source ?? 'voice',
      status: body.status ?? 'active',
    },
  })

  return NextResponse.json({ task: { ...task, contextTags: safeParseTags(task.contextTags) } }, { status: 201 })
}
