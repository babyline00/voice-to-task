/**
 * Bun-native unit tests for the AI provider layer (ChatProvider + AsrProvider).
 * Run: `bun test`
 *
 * Verifies the mock providers return deterministic output and that the test
 * setter hooks override the cached provider correctly.
 */

import { test, expect, describe } from 'bun:test'
import {
  getChatProvider,
  getAsrProvider,
  __setChatProviderForTest,
  __setAsrProviderForTest,
  type ChatProvider,
  type AsrProvider,
} from '../ai'

describe('ChatProvider (mock)', () => {
  test('mocked complete returns deterministic parsed-task JSON for task-parsing prompts', async () => {
    const mock: ChatProvider = {
      async complete() {
        return JSON.stringify({
          title: 'buy milk',
          priority: 'medium',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
        })
      },
    }
    __setChatProviderForTest(mock)
    const provider = getChatProvider()
    const out = await provider.complete({
      systemPrompt: 'You are a task parsing assistant.',
      messages: [{ role: 'user', content: 'buy milk tomorrow' }],
    })
    const parsed = JSON.parse(out)
    expect(parsed.title).toBe('buy milk')
    expect(parsed.priority).toBe('medium')
    expect(parsed.dueAt).toBeDefined()
    __setChatProviderForTest(null)
  })

  test('mocked complete returns generic ack for non-task prompts', async () => {
    const mock: ChatProvider = {
      async complete(args) {
        const last = [...args.messages].reverse().find((m) => m.role === 'user')
        return `echo: ${last?.content ?? ''}`
      },
    }
    __setChatProviderForTest(mock)
    const provider = getChatProvider()
    const out = await provider.complete({
      systemPrompt: 'general assistant',
      messages: [{ role: 'user', content: 'hello world' }],
    })
    expect(out).toBe('echo: hello world')
    __setChatProviderForTest(null)
  })

  test('getChatProvider returns the cached mock instance', () => {
    const mock: ChatProvider = { async complete() { return 'x' } }
    __setChatProviderForTest(mock)
    expect(getChatProvider()).toBe(mock)
    __setChatProviderForTest(null)
  })

  test('resetting the cached provider to null forces re-evaluation', () => {
    const mock: ChatProvider = { async complete() { return 'first' } }
    __setChatProviderForTest(mock)
    expect(getChatProvider()).toBe(mock)
    __setChatProviderForTest(null)
    // After reset, getChatProvider() should NOT return the old mock.
    expect(getChatProvider()).not.toBe(mock)
  })
})

describe('AsrProvider (mock)', () => {
  test('mocked transcribe returns a deterministic transcript', async () => {
    const mock: AsrProvider = {
      async transcribe() {
        return 'buy milk tomorrow'
      },
    }
    __setAsrProviderForTest(mock)
    const provider = getAsrProvider()
    const out = await provider.transcribe({ file_base64: 'fakebase64' })
    expect(out).toBe('buy milk tomorrow')
    __setAsrProviderForTest(null)
  })

  test('getChatProvider returns the cached mock instance', () => {
    const mock: AsrProvider = { async transcribe() { return 'x' } }
    __setAsrProviderForTest(mock)
    expect(getAsrProvider()).toBe(mock)
    __setAsrProviderForTest(null)
  })

  test('transcribe receives the file_base64 argument', async () => {
    let received: unknown = null
    const mock: AsrProvider = {
      async transcribe(args) {
        received = args
        return 'ok'
      },
    }
    __setAsrProviderForTest(mock)
    const provider = getAsrProvider()
    await provider.transcribe({ file_base64: 'abc123' })
    expect(received).toEqual({ file_base64: 'abc123' })
    __setAsrProviderForTest(null)
  })

  test('resetting the cached provider to null forces re-evaluation', () => {
    const mock: AsrProvider = { async transcribe() { return 'first' } }
    __setAsrProviderForTest(mock)
    expect(getAsrProvider()).toBe(mock)
    __setAsrProviderForTest(null)
    expect(getAsrProvider()).not.toBe(mock)
  })
})

describe('Provider interfaces', () => {
  test('ChatProvider.complete returns a Promise<string>', async () => {
    const mock: ChatProvider = { async complete() { return 'hello' } }
    const result = mock.complete({
      systemPrompt: '',
      messages: [],
    })
    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe('hello')
  })

  test('AsrProvider.transcribe returns a Promise<string>', async () => {
    const mock: AsrProvider = { async transcribe() { return 'hello' } }
    const result = mock.transcribe({ file_base64: '' })
    expect(result).toBeInstanceOf(Promise)
    expect(await result).toBe('hello')
  })
})
