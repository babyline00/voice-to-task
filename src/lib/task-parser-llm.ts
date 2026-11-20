/**
 * LLM task-parsing fallback.
 *
 * Used by `/api/parse-task` only when the heuristic parser's `confidence`
 * score is below the threshold and a real LLM provider is available. The
 * prompt asks the model to return strict JSON with the same shape as the
 * heuristic output so the API layer can normalize both paths to a single
 * `ParsedTask`.
 */

import type { ParsedTask, Priority } from './nl-parser'

export function buildTaskParsePrompt(transcript: string): string {
  return [
    'You are a task parsing assistant. Given the user\'s transcribed voice input,',
    'return a JSON object with EXACTLY the following fields and no other text:',
    '',
    '{',
    '  "title": string,            // required, short imperative title (no leading "remind me to")',
    '  "dueAt": string | null,      // optional, ISO 8601 date string',
    '  "project": string | null,    // optional, e.g. "work" or "personal"',
    '  "priority": "high" | "medium" | "low",  // default "medium"',
    '  "contextTags": string[],     // optional, may be empty',
    '  "recurrenceRule": string | null  // optional, e.g. "weekly:Sunday", "daily", "interval:3:week"',
    '}',
    '',
    'Rules:',
    '- Output ONLY the JSON object. No markdown, no prose, no code fences.',
    '- If a field is unknown, use null (or [] for tags) — never invent values.',
    '- "title" is always required and should be a short imperative phrase.',
    '- Normalize project and tags to lowercase with no leading "/" or "#".',
    '',
    'Transcript:',
    '"""',
    transcript,
    '"""',
  ].join('\n')
}

/**
 * Parse the model's response into a `ParsedTask`. Tolerates a leading/trailing
 * code fence and surrounding prose by extracting the first balanced `{...}`
 * block.
 */
export function parseLlmTaskResponse(raw: string, transcript: string): ParsedTask {
  const jsonStr = extractJsonObject(raw)
  let obj: any = {}
  try {
    obj = JSON.parse(jsonStr)
  } catch {
    obj = {}
  }

  const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : transcript.slice(0, 80)
  const dueAtStr = typeof obj.dueAt === 'string' ? obj.dueAt : null
  const dueAt = dueAtStr ? new Date(dueAtStr) : undefined
  const priorityRaw = typeof obj.priority === 'string' ? obj.priority.toLowerCase() : 'medium'
  const priority: Priority = ['high', 'medium', 'low'].includes(priorityRaw as Priority)
    ? (priorityRaw as Priority)
    : 'medium'
  const project = typeof obj.project === 'string' && obj.project.trim() ? obj.project.trim().toLowerCase() : undefined
  const contextTags = Array.isArray(obj.contextTags)
    ? obj.contextTags.filter((t: unknown): t is string => typeof t === 'string').map((t: string) => t.toLowerCase())
    : []
  const recurrenceRule = typeof obj.recurrenceRule === 'string' && obj.recurrenceRule.trim()
    ? obj.recurrenceRule.trim()
    : undefined

  return {
    title,
    dueAt: dueAt && !isNaN(dueAt.getTime()) ? dueAt : undefined,
    recurrenceRule,
    priority,
    project,
    contextTags,
    confidence: 0.5, // LLM path — assume middling confidence since user still reviews
    rawTranscript: transcript,
  }
}

function extractJsonObject(raw: string): string {
  if (!raw) return '{}'
  // Strip a leading ```json or ``` fence.
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  if (fenceMatch) return fenceMatch[1].trim()
  // Otherwise, find the first balanced {...} block.
  const start = raw.indexOf('{')
  if (start === -1) return '{}'
  let depth = 0
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return raw.slice(start).trim()
}

/**
 * High-level: build the prompt, call the supplied `complete` function (which
 * is the ChatProvider's `complete` method), and parse the response.
 */
export async function parseTaskWithLlm(
  transcript: string,
  complete: (prompt: string) => Promise<string>,
): Promise<ParsedTask> {
  const prompt = buildTaskParsePrompt(transcript)
  const raw = await complete(prompt)
  return parseLlmTaskResponse(raw, transcript)
}
