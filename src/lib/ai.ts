/**
 * Voice-to-Task AI layer.
 *
 * Two pluggable provider interfaces:
 *   - `ChatProvider`  — non-streaming `complete()` used by the LLM task parser.
 *   - `AsrProvider`   — `transcribe({ file_base64 })` used by /api/transcribe.
 *
 * Each has a Zai implementation (uses `z-ai-web-dev-sdk` via dynamic import so
 * the module evaluates cleanly in unit tests without the SDK installed) and a
 * Mock implementation that returns deterministic output. The mock is the
 * default when the corresponding `VTT_DISABLE_*` env var is set to "1", and
 * also when the ZAI constructor throws (e.g. missing config in the test env).
 */

export interface ChatProvider {
  complete(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): Promise<string>
}

export interface AsrProvider {
  transcribe(args: { file_base64: string }): Promise<string>
}

let cachedChatProvider: ChatProvider | null = null
let cachedAsrProvider: AsrProvider | null = null

class ZaiChatProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): Promise<string> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const messages = [
      { role: 'system' as const, content: args.systemPrompt },
      ...args.messages,
    ]
    const completion = await zai.chat.completions.create({
      messages,
      stream: false,
      thinking: { type: 'disabled' },
    })
    if (typeof completion === 'string') return completion
    const content = (completion as any)?.choices?.[0]?.message?.content
    return typeof content === 'string' ? content : ''
  }
}

class MockChatProvider implements ChatProvider {
  async complete(args: {
    systemPrompt: string
    messages: { role: 'user' | 'assistant' | 'system'; content: string }[]
  }): Promise<string> {
    const lastUser = [...args.messages].reverse().find((m) => m.role === 'user')
    const text = (lastUser?.content ?? '').trim()
    // Deterministic canned JSON for task-parsing prompts so the demoable
    // offline path round-trips correctly through `parseTaskWithLlm`.
    if (args.systemPrompt.toLowerCase().includes('task parsing')) {
      if (text.toLowerCase().includes('buy milk')) {
        return JSON.stringify({
          title: 'buy milk',
          priority: 'medium',
          dueAt: new Date(Date.now() + 86400000).toISOString(),
        })
      }
      return JSON.stringify({
        title: text.slice(0, 80) || 'Untitled task',
        priority: 'medium',
      })
    }
    return `mocked response for: ${text.slice(0, 120)}`
  }
}

class ZaiAsrProvider implements AsrProvider {
  async transcribe(args: { file_base64: string }): Promise<string> {
    const ZAI = (await import('z-ai-web-dev-sdk')).default
    const zai = await ZAI.create()
    const result = await zai.audio.asr.create({ file_base64: args.file_base64 })
    if (typeof result === 'string') return result
    // The SDK may return an object with a `text` field.
    const text = (result as any)?.text ?? (result as any)?.transcript
    return typeof text === 'string' ? text : ''
  }
}

class MockAsrProvider implements AsrProvider {
  async transcribe(_args: { file_base64: string }): Promise<string> {
    // Deterministic offline transcript — used in tests and when ASR is disabled.
    return 'buy milk tomorrow'
  }
}

export function getChatProvider(): ChatProvider {
  if (cachedChatProvider) return cachedChatProvider
  if (process.env.VTT_DISABLE_LLM === '1') {
    cachedChatProvider = new MockChatProvider()
    return cachedChatProvider
  }
  try {
    cachedChatProvider = new ZaiChatProvider()
  } catch (e) {
    console.warn(
      '[ai] ZaiChatProvider unavailable, using MockChatProvider:',
      (e as Error).message,
    )
    cachedChatProvider = new MockChatProvider()
  }
  return cachedChatProvider
}

export function getAsrProvider(): AsrProvider {
  if (cachedAsrProvider) return cachedAsrProvider
  if (process.env.VTT_DISABLE_ASR === '1') {
    cachedAsrProvider = new MockAsrProvider()
    return cachedAsrProvider
  }
  try {
    cachedAsrProvider = new ZaiAsrProvider()
  } catch (e) {
    console.warn(
      '[ai] ZaiAsrProvider unavailable, using MockAsrProvider:',
      (e as Error).message,
    )
    cachedAsrProvider = new MockAsrProvider()
  }
  return cachedAsrProvider
}

/** Test-only. */
export function __setChatProviderForTest(p: ChatProvider | null) {
  cachedChatProvider = p
}

/** Test-only. */
export function __setAsrProviderForTest(p: AsrProvider | null) {
  cachedAsrProvider = p
}
