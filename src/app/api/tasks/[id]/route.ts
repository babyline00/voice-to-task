/**
 * PATCH /api/tasks/[id]   — partial update (title, dueAt, priority, project,
 *                            contextTags, recurrenceRule, status)
 * DELETE /api/tasks/[id]   — delete a task
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

interface PatchBody {
  title?: string
  dueAt?: string | null
  priority?: string
  project?: string | null
  contextTags?: string[] | string | null
  recurrenceRule?: string | null
  status?: string
}

function normalizeTags(input: string[] | string | null | undefined): string | undefined {
  if (input === undefined) return undefined
  if (input === null) return '[]'
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input)
      if (Array.isArray(parsed)) return JSON.stringify(parsed)
    } catch {
      /* not JSON */
    }
    const arr = input.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
    return JSON.stringify(arr)
  }
  if (Array.isArray(input)) {
    return JSON.stringify(input.map((t) => t.toLowerCase()))
  }
  return undefined
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const task = await db.task.findUnique({ where: { id } })
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  let tags: string[] = []
  try {
    const parsed = JSON.parse(task.contextTags)
    if (Array.isArray(parsed)) tags = parsed
  } catch {
    /* ignore */
  }
  return NextResponse.json({ task: { ...task, contextTags: tags } })
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const existing = await db.task.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

  const data: {
    title?: string
    dueAt?: Date | null
    priority?: string
    project?: string | null
    contextTags?: string
    recurrenceRule?: string | null
    status?: string
  } = {}

  if (body.title !== undefined) data.title = body.title.trim()
  if (body.dueAt !== undefined) {
    data.dueAt = body.dueAt ? new Date(body.dueAt) : null
    if (data.dueAt && isNaN(data.dueAt.getTime())) {
      return NextResponse.json({ error: 'dueAt is not a valid date' }, { status: 400 })
    }
  }
  if (body.priority !== undefined) {
    if (['high', 'medium', 'low'].includes(body.priority)) {
      data.priority = body.priority
    }
  }
  if (body.project !== undefined) data.project = body.project?.trim() || null
  if (body.recurrenceRule !== undefined) data.recurrenceRule = body.recurrenceRule?.trim() || null
  if (body.status !== undefined) {
    if (['active', 'done', 'archived'].includes(body.status)) {
      data.status = body.status
    }
  }
  const tags = normalizeTags(body.contextTags)
  if (tags !== undefined) data.contextTags = tags

  const updated = await db.task.update({ where: { id }, data })
  let parsedTags: string[] = []
  try {
    const p = JSON.parse(updated.contextTags)
    if (Array.isArray(p)) parsedTags = p
  } catch {
    /* ignore */
  }
  return NextResponse.json({ task: { ...updated, contextTags: parsedTags } })
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const existing = await db.task.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: 'Task not found' }, { status: 404 })
  await db.task.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
