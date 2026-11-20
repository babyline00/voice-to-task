/**
 * Bun-native unit tests for the LLM task-parsing prompt builder + response parser.
 * Run: `bun test`
 */

import { test, expect, describe } from 'bun:test'
import {
  buildTaskParsePrompt,
  parseLlmTaskResponse,
  parseTaskWithLlm,
} from '../task-parser-llm'

describe('buildTaskParsePrompt', () => {
  test('asks the LLM for the required JSON fields', () => {
    const prompt = buildTaskParsePrompt('buy milk tomorrow')
    expect(prompt).toContain('title')
    expect(prompt).toContain('dueAt')
    expect(prompt).toContain('project')
    expect(prompt).toContain('priority')
    expect(prompt).toContain('contextTags')
  })

  test('mentions recurrenceRule (used for "every Sunday")', () => {
    const prompt = buildTaskParsePrompt('x')
    expect(prompt).toContain('recurrenceRule')
  })

  test('mentions JSON explicitly', () => {
    const prompt = buildTaskParsePrompt('x')
    expect(prompt.toLowerCase()).toContain('json')
  })

  test('includes the transcript verbatim', () => {
    const prompt = buildTaskParsePrompt('remind me to call mom every Sunday at 10am')
    expect(prompt).toContain('remind me to call mom every Sunday at 10am')
  })

  test('instructs the model to output only JSON (no markdown / prose)', () => {
    const prompt = buildTaskParsePrompt('x')
    expect(prompt.toLowerCase()).toMatch(/only.*json|no markdown|no prose/)
  })

  test('specifies the priority enum values', () => {
    const prompt = buildTaskParsePrompt('x')
    expect(prompt).toContain('"high"')
    expect(prompt).toContain('"medium"')
    expect(prompt).toContain('"low"')
  })
})

describe('parseLlmTaskResponse', () => {
  test('parses plain JSON', () => {
    const raw = JSON.stringify({
      title: 'buy milk',
      priority: 'medium',
      dueAt: '2025-01-16T09:00:00',
      contextTags: ['groceries'],
      project: 'personal',
    })
    const parsed = parseLlmTaskResponse(raw, 'buy milk tomorrow')
    expect(parsed.title).toBe('buy milk')
    expect(parsed.priority).toBe('medium')
    expect(parsed.project).toBe('personal')
    expect(parsed.contextTags).toEqual(['groceries'])
    expect(parsed.dueAt).toBeInstanceOf(Date)
  })

  test('parses JSON inside a markdown code fence', () => {
    const raw = '```json\n{ "title": "review PRs", "priority": "high" }\n```'
    const parsed = parseLlmTaskResponse(raw, 'review PRs')
    expect(parsed.title).toBe('review PRs')
    expect(parsed.priority).toBe('high')
  })

  test('parses JSON inside a plain code fence (no json tag)', () => {
    const raw = '```\n{ "title": "ship release", "priority": "low" }\n```'
    const parsed = parseLlmTaskResponse(raw, 'ship release')
    expect(parsed.title).toBe('ship release')
    expect(parsed.priority).toBe('low')
  })

  test('parses JSON embedded in surrounding prose', () => {
    const raw = 'Here is the task: { "title": "x", "priority": "medium" }. Done.'
    const parsed = parseLlmTaskResponse(raw, 'x')
    expect(parsed.title).toBe('x')
  })

  test('falls back to a truncated transcript for title on total parse failure', () => {
    const raw = 'the model went off the rails'
    const transcript = 'some long transcript that should become the title'
    const parsed = parseLlmTaskResponse(raw, transcript)
    expect(parsed.title).toContain('some long transcript')
  })

  test('normalizes invalid priority to medium', () => {
    const raw = JSON.stringify({ title: 'x', priority: 'urgent' })
    const parsed = parseLlmTaskResponse(raw, 'x')
    expect(parsed.priority).toBe('medium')
  })

  test('normalizes project to lowercase', () => {
    const raw = JSON.stringify({ title: 'x', priority: 'medium', project: 'Work' })
    const parsed = parseLlmTaskResponse(raw, 'x')
    expect(parsed.project).toBe('work')
  })

  test('filters non-string tags', () => {
    const raw = JSON.stringify({
      title: 'x',
      priority: 'medium',
      contextTags: ['client', 42, null, 'weekly'],
    })
    const parsed = parseLlmTaskResponse(raw, 'x')
    expect(parsed.contextTags).toEqual(['client', 'weekly'])
  })

  test('sets confidence to 0.5 (LLM path — user still reviews)', () => {
    const raw = JSON.stringify({ title: 'x', priority: 'medium' })
    const parsed = parseLlmTaskResponse(raw, 'x')
    expect(parsed.confidence).toBe(0.5)
  })

  test('preserves rawTranscript', () => {
    const raw = JSON.stringify({ title: 'x', priority: 'medium' })
    const parsed = parseLlmTaskResponse(raw, 'buy milk')
    expect(parsed.rawTranscript).toBe('buy milk')
  })
})

describe('parseTaskWithLlm', () => {
  test('calls the provided complete function and parses the response', async () => {
    const complete = async () =>
      JSON.stringify({ title: 'buy groceries', priority: 'low' })
    const parsed = await parseTaskWithLlm('buy groceries', complete)
    expect(parsed.title).toBe('buy groceries')
    expect(parsed.priority).toBe('low')
  })

  test('passes the prompt to the complete function', async () => {
    let received: string | null = null
    const complete = async (prompt: string) => {
      received = prompt
      return JSON.stringify({ title: 'x', priority: 'medium' })
    }
    await parseTaskWithLlm('call mom', complete)
    expect(received).toBeTruthy()
    expect(received).toContain('call mom')
  })

  test('gracefully handles complete() returning garbage', async () => {
    const complete = async () => 'totally not json'
    const parsed = await parseTaskWithLlm('some transcript', complete)
    expect(parsed.title).toContain('some transcript')
    expect(parsed.priority).toBe('medium')
  })
})
