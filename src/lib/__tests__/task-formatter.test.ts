/**
 * Bun-native unit tests for the task display formatter.
 * Run: `bun test`
 */

import { test, expect, describe } from 'bun:test'
import { formatTaskForUi, priorityVariant } from '../task-formatter'

const NOW = new Date('2025-01-15T08:00:00') // Wednesday 8am local

describe('formatTaskForUi — dueAt display', () => {
  test('dueAt tomorrow at 10am formats as "Tomorrow 10:00 AM"', () => {
    const dueAt = new Date('2025-01-16T10:00:00') // local time
    const out = formatTaskForUi({ title: 'x', dueAt, priority: 'medium' }, NOW)
    expect(out.dueAtDisplay).toBe('Tomorrow 10:00 AM')
  })

  test('dueAt today at 3pm formats as "Today 3:00 PM"', () => {
    const dueAt = new Date('2025-01-15T15:00:00')
    const out = formatTaskForUi({ title: 'x', dueAt, priority: 'medium' }, NOW)
    expect(out.dueAtDisplay).toBe('Today 3:00 PM')
  })

  test('dueAt tomorrow at 9am formats as "Tomorrow 9:00 AM"', () => {
    const dueAt = new Date('2025-01-16T09:00:00')
    const out = formatTaskForUi({ title: 'x', dueAt, priority: 'medium' }, NOW)
    expect(out.dueAtDisplay).toBe('Tomorrow 9:00 AM')
  })

  test('dueAt in the past relative to now still formats with a date', () => {
    const dueAt = new Date('2024-12-25T12:00:00')
    const out = formatTaskForUi({ title: 'x', dueAt, priority: 'medium' }, NOW)
    expect(out.dueAtDisplay).toContain('12:00 PM')
    expect(out.dueAtDisplay).toContain('Dec')
  })

  test('no dueAt formats as "—"', () => {
    const out = formatTaskForUi({ title: 'x', priority: 'medium' }, NOW)
    expect(out.dueAtDisplay).toBe('—')
  })

  test('accepts ISO date string for dueAt', () => {
    const out = formatTaskForUi(
      { title: 'x', priority: 'medium', dueAt: '2025-01-16T10:00:00' },
      NOW,
    )
    expect(out.dueAtDisplay).toBe('Tomorrow 10:00 AM')
  })

  test('null dueAt formats as "—"', () => {
    const out = formatTaskForUi({ title: 'x', priority: 'medium', dueAt: null }, NOW)
    expect(out.dueAtDisplay).toBe('—')
  })
})

describe('formatTaskForUi — recurrence display', () => {
  test('weekly:Sunday formats as "weekly on Sunday"', () => {
    const out = formatTaskForUi({
      title: 'x',
      priority: 'medium',
      recurrenceRule: 'weekly:Sunday',
    })
    expect(out.recurrenceDisplay).toBe('weekly on Sunday')
  })

  test('weekly:sunday (lowercase from parser) also formats as "weekly on Sunday"', () => {
    const out = formatTaskForUi({
      title: 'x',
      priority: 'medium',
      recurrenceRule: 'weekly:sunday',
    })
    expect(out.recurrenceDisplay).toBe('weekly on Sunday')
  })

  test('daily formats as "every day"', () => {
    const out = formatTaskForUi({
      title: 'x',
      priority: 'medium',
      recurrenceRule: 'daily',
    })
    expect(out.recurrenceDisplay).toBe('every day')
  })

  test('interval:3:week formats as "every 3 weeks"', () => {
    const out = formatTaskForUi({
      title: 'x',
      priority: 'medium',
      recurrenceRule: 'interval:3:week',
    })
    expect(out.recurrenceDisplay).toBe('every 3 weeks')
  })

  test('interval:1:month formats as "every 1 month" (no pluralization for n=1)', () => {
    const out = formatTaskForUi({
      title: 'x',
      priority: 'medium',
      recurrenceRule: 'interval:1:month',
    })
    expect(out.recurrenceDisplay).toBe('every 1 month')
  })

  test('no recurrence formats as "—"', () => {
    const out = formatTaskForUi({ title: 'x', priority: 'medium' })
    expect(out.recurrenceDisplay).toBe('—')
  })
})

describe('formatTaskForUi — priority / project / tags display', () => {
  test('priority high → "High"', () => {
    expect(formatTaskForUi({ title: 'x', priority: 'high' }).priorityDisplay).toBe('High')
  })
  test('priority low → "Low"', () => {
    expect(formatTaskForUi({ title: 'x', priority: 'low' }).priorityDisplay).toBe('Low')
  })
  test('priority medium (default) → "Medium"', () => {
    expect(formatTaskForUi({ title: 'x' }).priorityDisplay).toBe('Medium')
  })

  test('project present → project string', () => {
    expect(
      formatTaskForUi({ title: 'x', priority: 'medium', project: 'work' }).projectDisplay,
    ).toBe('work')
  })
  test('project absent → "—"', () => {
    expect(formatTaskForUi({ title: 'x', priority: 'medium' }).projectDisplay).toBe('—')
  })

  test('tags joined with ", "', () => {
    expect(
      formatTaskForUi({
        title: 'x',
        priority: 'medium',
        contextTags: ['client', 'weekly'],
      }).tagsDisplay,
    ).toBe('client, weekly')
  })
  test('no tags → "—"', () => {
    expect(formatTaskForUi({ title: 'x', priority: 'medium' }).tagsDisplay).toBe('—')
  })

  test('title is passed through', () => {
    expect(formatTaskForUi({ title: 'buy milk', priority: 'medium' }).title).toBe('buy milk')
  })
})

describe('priorityVariant', () => {
  test('high → destructive', () => {
    expect(priorityVariant('high')).toBe('destructive')
  })
  test('medium → default', () => {
    expect(priorityVariant('medium')).toBe('default')
  })
  test('low → secondary', () => {
    expect(priorityVariant('low')).toBe('secondary')
  })
  test('unknown → outline', () => {
    expect(priorityVariant('urgent')).toBe('outline')
  })
  test('undefined → outline', () => {
    expect(priorityVariant(undefined)).toBe('outline')
  })
})
