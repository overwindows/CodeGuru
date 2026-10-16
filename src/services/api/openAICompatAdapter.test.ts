import { afterEach, describe, expect, test } from 'bun:test'
import { wrapFetchWithOpenAICompat } from './openAICompatAdapter.js'

const originalCompat = process.env.CODEGURU_OPENAI_COMPAT
const originalDisableStreaming =
  process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING
const originalEnableThinking =
  process.env.CODEGURU_OPENAI_COMPAT_ENABLE_THINKING
const originalReasoningEffort =
  process.env.CODEGURU_OPENAI_COMPAT_REASONING_EFFORT

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
  if (originalEnableThinking === undefined) {
    delete process.env.CODEGURU_OPENAI_COMPAT_ENABLE_THINKING
  } else {
    process.env.CODEGURU_OPENAI_COMPAT_ENABLE_THINKING =
      originalEnableThinking
  }
  if (originalReasoningEffort === undefined) {
    delete process.env.CODEGURU_OPENAI_COMPAT_REASONING_EFFORT
  } else {
    process.env.CODEGURU_OPENAI_COMPAT_REASONING_EFFORT =
      originalReasoningEffort
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

  test('requests and preserves router reasoning content', async () => {
    process.env.CODEGURU_OPENAI_COMPAT = '1'
    process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING = '1'
    process.env.CODEGURU_OPENAI_COMPAT_ENABLE_THINKING = '1'
    process.env.CODEGURU_OPENAI_COMPAT_REASONING_EFFORT = 'high'

    const inner = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        stream: false,
        chat_template_kwargs: {
          thinking: true,
          reasoning_effort: 'high',
        },
      })

      return Response.json({
        id: 'chatcmpl-reasoning',
        object: 'chat.completion',
        model: 'deepseek-v4-flash',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              reasoning_content: 'I will calculate the result.',
              content: '323',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      })
    }

    const response = await wrapFetchWithOpenAICompat(inner)(
      'https://router.example/v1/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          messages: [{ role: 'user', content: 'What is 17 * 19?' }],
          max_tokens: 512,
          stream: true,
        }),
      },
    )
    const body = await response.text()

    expect(body).toContain(
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}',
    )
    expect(body).toContain(
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I will calculate the result."}}',
    )
    expect(body).toContain(
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"323"}}',
    )
  })
})
