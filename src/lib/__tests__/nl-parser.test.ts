/**
 * Bun-native unit tests for the heuristic natural-language task parser.
 * Run: `bun test`
 *
 * The parser is deterministic given a fixed `now`, so all tests pass an
 * explicit `now` Date (Wednesday 2025-01-15 at 08:00 local time).
 */

import { test, expect, describe } from 'bun:test'
import {
  parseTask,
  LLM_FALLBACK_THRESHOLD,
} from '../nl-parser'

const NOW = new Date('2025-01-15T08:00:00') // Wednesday 8am local

describe('parseTask — intent stripping', () => {
  test('"remind me to call mom every Sunday at 10am" → title "call mom", weekly Sunday, time 10:00', () => {
    const p = parseTask('remind me to call mom every Sunday at 10am', NOW)
    expect(p.title).toBe('call mom')
    expect(p.recurrenceRule).toBe('weekly:sunday')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDay()).toBe(0) // Sunday
    expect(p.dueAt!.getHours()).toBe(10)
    expect(p.dueAt!.getMinutes()).toBe(0)
  })

  test('"remember to call dad tomorrow at 6pm" → title "call dad", due tomorrow 18:00', () => {
    const p = parseTask('remember to call dad tomorrow at 6pm', NOW)
    expect(p.title).toBe('call dad')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDate()).toBe(16) // Jan 16
    expect(p.dueAt!.getHours()).toBe(18)
    expect(p.dueAt!.getMinutes()).toBe(0)
  })

  test('"I need to take meds every day at 8am" → title "take meds", daily, 08:00', () => {
    const p = parseTask('I need to take meds every day at 8am', NOW)
    expect(p.title).toBe('take meds')
    expect(p.recurrenceRule).toBe('daily')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getHours()).toBe(8)
  })
})

describe('parseTask — relative dates', () => {
  test('"buy milk tomorrow" → title "buy milk", dueAt = tomorrow 9am', () => {
    const p = parseTask('buy milk tomorrow', NOW)
    expect(p.title).toBe('buy milk')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getFullYear()).toBe(2025)
    expect(p.dueAt!.getMonth()).toBe(0) // January
    expect(p.dueAt!.getDate()).toBe(16)
    expect(p.dueAt!.getHours()).toBe(9)
    expect(p.dueAt!.getMinutes()).toBe(0)
  })

  test('"submit report in 3 days" → dueAt = today + 3 days, 9am', () => {
    const p = parseTask('submit report in 3 days', NOW)
    expect(p.title).toBe('submit report')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDate()).toBe(18)
    expect(p.dueAt!.getHours()).toBe(9)
  })

  test('"in 2 weeks ship the release" → dueAt = today + 14 days', () => {
    const p = parseTask('in 2 weeks ship the release', NOW)
    expect(p.title).toBe('ship the release')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDate()).toBe(29) // Jan 29
  })

  test('"call John today at 3pm" → due today at 15:00', () => {
    const p = parseTask('call John today at 3pm', NOW)
    expect(p.title).toBe('call John')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDate()).toBe(15)
    expect(p.dueAt!.getHours()).toBe(15)
    expect(p.dueAt!.getMinutes()).toBe(0)
  })

  test('"meeting tonight at 7" → due today at 19:00 (pm inferred)', () => {
    const p = parseTask('meeting tonight at 7', NOW)
    expect(p.title).toBe('meeting')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getHours()).toBe(19)
    expect(p.dueAt!.getMinutes()).toBe(0)
  })

  test('"submit report by Friday" → due next Friday at 9am', () => {
    const p = parseTask('submit report by Friday', NOW)
    expect(p.title).toBe('submit report')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDay()).toBe(5) // Friday
    expect(p.dueAt!.getDate()).toBe(17) // Jan 17
  })

  test('"submit report by next Monday" → due next Monday', () => {
    const p = parseTask('submit report by next Monday', NOW)
    expect(p.title).toBe('submit report')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDay()).toBe(1) // Monday
    expect(p.dueAt!.getDate()).toBe(20) // Jan 20
  })

  test('"next Monday follow up" → due next Monday (without "by/on")', () => {
    const p = parseTask('next Monday follow up', NOW)
    expect(p.title).toBe('follow up')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDay()).toBe(1) // Monday
  })
})

describe('parseTask — priority', () => {
  test('"high priority: finish the proposal by Friday" → priority high', () => {
    const p = parseTask('high priority: finish the proposal by Friday', NOW)
    expect(p.priority).toBe('high')
    expect(p.title).toBe('finish the proposal')
  })

  test('"low priority check email" → priority low', () => {
    const p = parseTask('low priority check email', NOW)
    expect(p.priority).toBe('low')
    expect(p.title).toBe('check email')
  })

  test('"medium priority review PRs" → priority medium', () => {
    const p = parseTask('medium priority review PRs', NOW)
    expect(p.priority).toBe('medium')
    expect(p.title).toBe('review PRs')
  })

  test('"priority: high ship the release" → priority high', () => {
    const p = parseTask('priority: high ship the release', NOW)
    expect(p.priority).toBe('high')
    expect(p.title).toBe('ship the release')
  })
})

describe('parseTask — projects + tags', () => {
  test('"/work call Sam #client" → project work, tags [client]', () => {
    const p = parseTask('/work call Sam #client', NOW)
    expect(p.project).toBe('work')
    expect(p.contextTags).toContain('client')
    expect(p.title).toBe('call Sam')
  })

  test('"/personal buy groceries #weekly #errands" → project personal, two tags', () => {
    const p = parseTask('/personal buy groceries #weekly #errands', NOW)
    expect(p.project).toBe('personal')
    expect(p.contextTags).toHaveLength(2)
    expect(p.contextTags).toContain('weekly')
    expect(p.contextTags).toContain('errands')
    expect(p.title).toBe('buy groceries')
  })

  test('"#focus task with only a tag" → tag captured, project undefined', () => {
    const p = parseTask('#focus task with only a tag', NOW)
    expect(p.contextTags).toContain('focus')
    expect(p.project).toBeUndefined()
  })
})

describe('parseTask — recurrence', () => {
  test('"every day drink water" → recurrenceRule daily', () => {
    const p = parseTask('every day drink water', NOW)
    expect(p.recurrenceRule).toBe('daily')
    expect(p.title).toBe('drink water')
  })

  test('"every 3 weeks clean the gutters" → interval:3:week', () => {
    const p = parseTask('every 3 weeks clean the gutters', NOW)
    expect(p.recurrenceRule).toBe('interval:3:week')
    expect(p.title).toBe('clean the gutters')
  })

  test('"every Monday at 9am standup" → weekly:monday, time 9:00', () => {
    const p = parseTask('every Monday at 9am standup', NOW)
    expect(p.recurrenceRule).toBe('weekly:monday')
    expect(p.title).toBe('standup')
    expect(p.dueAt).toBeDefined()
    expect(p.dueAt!.getDay()).toBe(1) // Monday
    expect(p.dueAt!.getHours()).toBe(9)
    expect(p.dueAt!.getMinutes()).toBe(0)
  })

  test('"every 2 months pay rent" → interval:2:month', () => {
    const p = parseTask('every 2 months pay rent', NOW)
    expect(p.recurrenceRule).toBe('interval:2:month')
    expect(p.title).toBe('pay rent')
  })
})

describe('parseTask — defaults + confidence', () => {
  test('"go to gym" → just title, priority medium default, no dueAt', () => {
    const p = parseTask('go to gym', NOW)
    expect(p.title).toBe('go to gym')
    expect(p.priority).toBe('medium')
    expect(p.dueAt).toBeUndefined()
    expect(p.recurrenceRule).toBeUndefined()
    expect(p.project).toBeUndefined()
    expect(p.contextTags).toEqual([])
  })

  test('"go to gym" confidence is below LLM fallback threshold', () => {
    const p = parseTask('go to gym', NOW)
    expect(p.confidence).toBeLessThan(LLM_FALLBACK_THRESHOLD)
  })

  test('"buy milk tomorrow" confidence is above threshold (heuristic wins)', () => {
    const p = parseTask('buy milk tomorrow', NOW)
    expect(p.confidence).toBeGreaterThanOrEqual(LLM_FALLBACK_THRESHOLD)
  })

  test('LLM_FALLBACK_THRESHOLD is 0.3', () => {
    expect(LLM_FALLBACK_THRESHOLD).toBe(0.3)
  })

  test('rawTranscript is preserved', () => {
    const p = parseTask('buy milk tomorrow', NOW)
    expect(p.rawTranscript).toBe('buy milk tomorrow')
  })
})
