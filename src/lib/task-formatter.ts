/**
 * Pure display formatter — turns a ParsedTask (or a Task from the DB) into
 * human-friendly strings for the editable preview chips in the UI.
 *
 * Kept separate from `nl-parser.ts` so the formatter can be unit-tested in
 * isolation and re-used by both the live parsed preview and the saved-task
 * sidebar.
 */

import type { Priority } from './nl-parser'

export interface FormattedTask {
  title: string
  dueAtDisplay: string
  priorityDisplay: string
  projectDisplay: string
  tagsDisplay: string
  recurrenceDisplay: string
}

export interface FormatInput {
  title: string
  dueAt?: Date | string | null
  priority?: string
  project?: string | null
  contextTags?: string[] | null
  recurrenceRule?: string | null
}

function toDate(v: Date | string | null | undefined): Date | undefined {
  if (!v) return undefined
  if (v instanceof Date) return v
  const d = new Date(v)
  return isNaN(d.getTime()) ? undefined : d
}

function formatTime(d: Date): string {
  let h = d.getHours()
  const m = d.getMinutes()
  const meridian = h < 12 ? 'AM' : 'PM'
  if (h === 0) h = 12
  else if (h > 12) h -= 12
  const mm = m.toString().padStart(2, '0')
  return `${h}:${mm} ${meridian}`
}

function formatDueAt(dueAt: Date | undefined, now: Date): string {
  if (!dueAt) return '—'
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const target = new Date(dueAt)
  target.setHours(0, 0, 0, 0)

  const time = formatTime(dueAt)
  if (target.getTime() === today.getTime()) return `Today ${time}`
  if (target.getTime() === tomorrow.getTime()) return `Tomorrow ${time}`
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${dueAt.toLocaleDateString('en-US', opts)} ${time}`
}

function formatPriority(p: string | undefined): string {
  if (!p) return 'Medium'
  return p.charAt(0).toUpperCase() + p.slice(1)
}

function formatRecurrence(rule: string | undefined | null): string {
  if (!rule) return '—'
  if (rule === 'daily') return 'every day'
  if (rule.startsWith('weekly:')) {
    const day = rule.split(':')[1]
    const cap = day.charAt(0).toUpperCase() + day.slice(1)
    return `weekly on ${cap}`
  }
  if (rule.startsWith('interval:')) {
    const parts = rule.split(':')
    const n = parseInt(parts[1], 10)
    const unit = parts[2]
    return `every ${n} ${unit}${n === 1 ? '' : 's'}`
  }
  return rule
}

function formatTags(tags: string[] | null | undefined): string {
  if (!tags || !tags.length) return '—'
  return tags.join(', ')
}

export function formatTaskForUi(
  parsed: FormatInput,
  now: Date = new Date(),
): FormattedTask {
  const dueAt = toDate(parsed.dueAt)
  return {
    title: parsed.title,
    dueAtDisplay: formatDueAt(dueAt, now),
    priorityDisplay: formatPriority(parsed.priority),
    projectDisplay: parsed.project ?? '—',
    tagsDisplay: formatTags(parsed.contextTags),
    recurrenceDisplay: formatRecurrence(parsed.recurrenceRule),
  }
}

/** Helper for the priority chip color in the UI. */
export function priorityVariant(p: string | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (p) {
    case 'high': return 'destructive'
    case 'medium': return 'default'
    case 'low': return 'secondary'
    default: return 'outline'
  }
}

export type { Priority }
