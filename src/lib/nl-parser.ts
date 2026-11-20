/**
 * Heuristic natural-language task parser.
 *
 * Recognizes a fixed grammar of natural task phrases:
 *   - Intent prefixes:  "remind me to", "remember to", "I need to", "I have to"
 *   - Projects:         /work, /personal            -> project field
 *   - Tags:              #client, #weekly            -> contextTags field
 *   - Priorities:        "high priority:", "low priority", "priority: medium"
 *   - Recurrence:        "every Sunday", "every day", "every 3 weeks"
 *   - Time-of-day:       "at 10am", "at 3 pm", "at 7", "at 15:30"
 *   - Relative dates:    "tomorrow", "today", "tonight",
 *                        "in 3 days", "in 2 weeks", "in 1 month",
 *                        "by Friday", "on Friday", "by next Friday", "next Monday"
 *
 * The parser returns a `confidence` score in [0, 1] — the fraction of feature
 * slots it actually detected. The API layer uses this to decide whether to
 * fall back to an LLM for the long tail of phrasings the heuristics can't see.
 *
 * `recurrenceRule` is encoded as:
 *   - "weekly:Sunday"        (every Sunday)
 *   - "daily"                (every day)
 *   - "interval:3:week"      (every 3 weeks; unit is singular)
 *   - "interval:1:month"     (every 1 month)
 */

export type Priority = 'high' | 'medium' | 'low'

export interface ParsedTask {
  title: string
  dueAt?: Date
  recurrenceRule?: string
  priority: Priority
  project?: string
  contextTags: string[]
  confidence: number
  rawTranscript?: string
}

const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}

const WEEKDAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
]

/**
 * Compute the next occurrence of `target` weekday at 9am, relative to `from`.
 * If `forceNext` is true and today is the target weekday, return next week's
 * occurrence (used by "every Sunday" recurrence so the first dueAt is in the
 * future, not today). Otherwise, return today if today is the target.
 */
function nextWeekday(target: number, from: Date, forceNext = false): Date {
  const result = new Date(from)
  result.setHours(9, 0, 0, 0)
  const current = result.getDay()
  let days = (target - current + 7) % 7
  if (forceNext && days === 0) days = 7
  result.setDate(result.getDate() + days)
  return result
}

export function parseTask(transcript: string, now: Date = new Date()): ParsedTask {
  let text = ' ' + transcript.trim() + ' '
  let confidence = 0

  const today = new Date(now)
  today.setHours(9, 0, 0, 0)

  let dueAt: Date | undefined
  let recurrenceRule: string | undefined
  let priority: Priority = 'medium'
  let project: string | undefined
  const contextTags: string[] = []
  let timeMinutes: number | undefined
  let timeMeridianExplicit = false

  // 1. Strip intent prefixes ("remind me to", "remember to", "I need to", ...).
  //    These carry no task content of their own.
  text = text.replace(
    /\s*(remind me to|remember to|i need to|i have to|please)\s+/gi,
    ' ',
  )

  // 2. Extract project: "/word". First match wins.
  const projectMatch = text.match(/\s\/([a-zA-Z][\w-]*)/)
  if (projectMatch) {
    project = projectMatch[1].toLowerCase()
    text = text.replace(projectMatch[0], ' ')
    confidence += 0.15
  }

  // 3. Extract tags: "#word". Multiple allowed.
  const tagMatches = [...text.matchAll(/\s#([a-zA-Z][\w-]*)/g)]
  if (tagMatches.length) {
    for (const m of tagMatches) {
      contextTags.push(m[1].toLowerCase())
      text = text.replace(m[0], ' ')
    }
    confidence += Math.min(0.2, 0.1 * tagMatches.length)
  }

  // 4. Extract priority: "high priority:" / "low priority" / "priority: medium"
  const prioPhrase = text.match(/\s*(high|medium|low)\s+priority\s*:?\s*/i)
  if (prioPhrase) {
    priority = prioPhrase[1].toLowerCase() as Priority
    text = text.replace(prioPhrase[0], ' ')
    confidence += 0.1
  } else {
    const prioColon = text.match(/\s*priority\s*:\s*(high|medium|low)\s*/i)
    if (prioColon) {
      priority = prioColon[1].toLowerCase() as Priority
      text = text.replace(prioColon[0], ' ')
      confidence += 0.1
    }
  }

  // 5. Extract recurrence: "every N days|weeks|months" | "every day" | "every <weekday>"
  const intervalMatch = text.match(
    /\s*every\s+(\d+)\s+(days?|weeks?|months?)\b/i,
  )
  const dailyMatch = text.match(/\s*every\s+day\b/i)
  const weekdayMatch = text.match(
    new RegExp('\\s*every\\s+(' + WEEKDAY_NAMES.join('|') + ')\\b', 'i'),
  )
  if (intervalMatch) {
    const n = parseInt(intervalMatch[1], 10)
    const unitRaw = intervalMatch[2].toLowerCase().replace(/s$/, '')
    recurrenceRule = `interval:${n}:${unitRaw}`
    text = text.replace(intervalMatch[0], ' ')
    confidence += 0.2
  } else if (dailyMatch) {
    recurrenceRule = 'daily'
    text = text.replace(dailyMatch[0], ' ')
    confidence += 0.2
  } else if (weekdayMatch) {
    const day = weekdayMatch[1].toLowerCase()
    recurrenceRule = `weekly:${day}`
    text = text.replace(weekdayMatch[0], ' ')
    confidence += 0.2
  }

  // 6. Extract time-of-day: "at HH:MM", "at H am/pm", "at H"
  const timeMatch = text.match(/\s*at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i)
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10)
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0
    const meridian = timeMatch[3]?.toLowerCase()
    if (meridian === 'pm' && hours < 12) hours += 12
    if (meridian === 'am' && hours === 12) hours = 0
    timeMinutes = hours * 60 + minutes
    timeMeridianExplicit = !!meridian
    text = text.replace(timeMatch[0], ' ')
    confidence += 0.15
  }

  // 7. Extract dueAt date keyword. Order matters: more-specific first.
  const byNextWeekdayMatch = text.match(
    new RegExp(
      '\\s*(by|on)\\s+next\\s+(' + WEEKDAY_NAMES.join('|') + ')\\b',
      'i',
    ),
  )
  const nextWeekdayMatch = text.match(
    new RegExp('\\s*next\\s+(' + WEEKDAY_NAMES.join('|') + ')\\b', 'i'),
  )
  const inNMatch = text.match(/\s*in\s+(\d+)\s+(days?|weeks?|months?)\b/i)
  const tomorrowMatch = text.match(/\s*tomorrow\b/i)
  const tonightMatch = text.match(/\s*tonight\b/i)
  const todayMatch = text.match(/\s*today\b/i)
  const byWeekdayMatch = text.match(
    new RegExp('\\s*(by|on)\\s+(' + WEEKDAY_NAMES.join('|') + ')\\b', 'i'),
  )

  if (byNextWeekdayMatch) {
    const day = WEEKDAY_MAP[byNextWeekdayMatch[2].toLowerCase()]
    dueAt = nextWeekday(day, today, true)
    text = text.replace(byNextWeekdayMatch[0], ' ')
    confidence += 0.2
  } else if (nextWeekdayMatch) {
    const day = WEEKDAY_MAP[nextWeekdayMatch[1].toLowerCase()]
    dueAt = nextWeekday(day, today, true)
    text = text.replace(nextWeekdayMatch[0], ' ')
    confidence += 0.2
  } else if (inNMatch) {
    const n = parseInt(inNMatch[1], 10)
    const unit = inNMatch[2].toLowerCase()
    const result = new Date(today)
    if (unit.startsWith('day')) result.setDate(result.getDate() + n)
    else if (unit.startsWith('week')) result.setDate(result.getDate() + 7 * n)
    else if (unit.startsWith('month')) result.setMonth(result.getMonth() + n)
    dueAt = result
    text = text.replace(inNMatch[0], ' ')
    confidence += 0.2
  } else if (tomorrowMatch) {
    dueAt = new Date(today)
    dueAt.setDate(dueAt.getDate() + 1)
    text = text.replace(tomorrowMatch[0], ' ')
    confidence += 0.2
  } else if (tonightMatch) {
    dueAt = new Date(today)
    if (timeMinutes !== undefined && !timeMeridianExplicit && timeMinutes < 12 * 60) {
      // "tonight at 7" — interpret the implicit hour as pm
      timeMinutes += 12 * 60
    } else if (timeMinutes === undefined) {
      timeMinutes = 19 * 60 // default 7pm
    }
    dueAt.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0)
    text = text.replace(tonightMatch[0], ' ')
    confidence += 0.2
  } else if (todayMatch) {
    dueAt = new Date(today)
    text = text.replace(todayMatch[0], ' ')
    confidence += 0.2
  } else if (byWeekdayMatch) {
    const day = WEEKDAY_MAP[byWeekdayMatch[2].toLowerCase()]
    dueAt = nextWeekday(day, today, false)
    text = text.replace(byWeekdayMatch[0], ' ')
    confidence += 0.2
  }

  // 8. If a recurrence was set but no explicit dueAt, derive the first occurrence.
  if (recurrenceRule && !dueAt) {
    if (recurrenceRule.startsWith('weekly:')) {
      const day = WEEKDAY_MAP[recurrenceRule.split(':')[1]]
      if (day !== undefined) dueAt = nextWeekday(day, today, true)
    } else if (recurrenceRule === 'daily') {
      dueAt = new Date(today)
    } else if (recurrenceRule.startsWith('interval:')) {
      const [, nStr, unit] = recurrenceRule.split(':')
      const n = parseInt(nStr, 10)
      dueAt = new Date(today)
      if (unit === 'day') dueAt.setDate(dueAt.getDate() + n)
      else if (unit === 'week') dueAt.setDate(dueAt.getDate() + 7 * n)
      else if (unit === 'month') dueAt.setMonth(dueAt.getMonth() + n)
    }
  }

  // 9. Apply explicit time-of-day to dueAt (or to today if no date was set).
  if (timeMinutes !== undefined && !tonightMatch) {
    if (!dueAt) dueAt = new Date(today)
    dueAt.setHours(Math.floor(timeMinutes / 60), timeMinutes % 60, 0, 0)
  }

  // 10. Clean up the remaining text into a title.
  const title = text
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-,:.;]+|[\s\-,:.;]+$/g, '')
    .trim()

  if (!title) {
    confidence = 0
  } else {
    confidence = Math.min(1, confidence + 0.2) // baseline for "we have a title"
  }

  return {
    title: title || transcript.trim(),
    dueAt,
    recurrenceRule,
    priority,
    project,
    contextTags,
    confidence,
    rawTranscript: transcript,
  }
}

/** Confidence threshold below which the API layer should ask the LLM. */
export const LLM_FALLBACK_THRESHOLD = 0.3
