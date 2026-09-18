import { afterEach, describe, expect, test } from 'bun:test'
import { wrapFetchWithOpenAICompat } from './openAICompatAdapter.js'

const originalCompat = process.env.CODEGURU_OPENAI_COMPAT
const originalDisableStreaming =
  process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING

afterEach(() => {
  if (originalCompat === undefined) {
    delete process.env.CODEGURU_OPENAI_COMPAT
  } else {
    process.env.CODEGURU_OPENAI_COMPAT = originalCompat
  }
  if (originalDisableStreaming === undefined) {
    delete process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING
  } else {
    process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING =
      originalDisableStreaming
  }
})

describe('OpenAI compatibility adapter', () => {
  test('converts a non-streaming upstream response into Anthropic SSE', async () => {
    process.env.CODEGURU_OPENAI_COMPAT = '1'
    process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING = '1'

    const inner = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://router.example/v1/chat/completions')
      expect(JSON.parse(String(init?.body))).toMatchObject({ stream: false })

      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'hello world' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
        },
      })
    }

    const response = await wrapFetchWithOpenAICompat(inner)(
      'https://router.example/v1/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 32,
          stream: true,
        }),
      },
    )
    const body = await response.text()

    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(body).toContain('event: message_start')
    expect(body).toContain(
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello world"}}',
    )
    expect(body).toContain(
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}',
    )
    expect(body).toContain('event: message_stop')
  })
})
