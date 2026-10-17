import { afterEach, describe, expect, test } from 'bun:test'
import { wrapFetchWithOpenAICompat } from './openAICompatAdapter.js'

const originalCompat = process.env.CODEGURU_OPENAI_COMPAT
const originalDisableStreaming =
  process.env.CODEGURU_OPENAI_COMPAT_DISABLE_STREAMING
const originalEnableThinking =
  process.env.CODEGURU_OPENAI_COMPAT_ENABLE_THINKING
const originalReasoningEffort =
  process.env.CODEGURU_OPENAI_COMPAT_REASONING_EFFORT
const originalVisionModel = process.env.CODEGURU_OPENAI_COMPAT_VISION_MODEL

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
  if (originalVisionModel === undefined) {
    delete process.env.CODEGURU_OPENAI_COMPAT_VISION_MODEL
  } else {
    process.env.CODEGURU_OPENAI_COMPAT_VISION_MODEL = originalVisionModel
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

  test('omits page images for text-only GLM-5.3', async () => {
    process.env.CODEGURU_OPENAI_COMPAT = '1'
    delete process.env.CODEGURU_OPENAI_COMPAT_VISION_MODEL
    delete process.env.CODEGURU_OPENAI_COMPAT_ALLOW_IMAGES

    const inner = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('GLM-5.3')
      expect(JSON.stringify(body.messages)).not.toContain('image_url')
      expect(body.messages).toEqual([
        {
          role: 'user',
          content:
            '[Attached image or PDF was omitted because this model endpoint accepts only text content.]',
        },
      ])
      return Response.json({
        id: 'chatcmpl-image',
        object: 'chat.completion',
        model: 'GLM-5.3',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'a page' },
            finish_reason: 'stop',
          },
        ],
      })
    }

    const response = await wrapFetchWithOpenAICompat(inner)(
      'https://api.sambanova.ai/v1/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          model: 'GLM-5.3',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: 'QUJD',
                  },
                },
              ],
            },
          ],
          max_tokens: 16,
          stream: false,
        }),
      },
    )
    expect(response.status).toBe(200)
  })

  test('omits PDF file parts for text-only GLM-5.3', async () => {
    process.env.CODEGURU_OPENAI_COMPAT = '1'
    delete process.env.CODEGURU_OPENAI_COMPAT_VISION_MODEL
    delete process.env.CODEGURU_OPENAI_COMPAT_ALLOW_IMAGES

    const inner = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('GLM-5.3')
      expect(JSON.stringify(body.messages)).not.toContain('file_data')
      expect(body.messages[0].content).toBe(
        'Summarize this.\n[Attached image or PDF was omitted because this model endpoint accepts only text content.]',
      )
      return Response.json({
        id: 'chatcmpl-pdf',
        object: 'chat.completion',
        model: 'GLM-5.3',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'summary' },
            finish_reason: 'stop',
          },
        ],
      })
    }

    const response = await wrapFetchWithOpenAICompat(inner)(
      'https://api.sambanova.ai/v1/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          model: 'GLM-5.3',
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Summarize this.' },
                {
                  type: 'document',
                  source: {
                    type: 'base64',
                    media_type: 'application/pdf',
                    data: 'JVBERg==',
                  },
                },
              ],
            },
          ],
          max_tokens: 16,
          stream: false,
        }),
      },
    )
    expect(response.status).toBe(200)
  })

  test('still honors an explicit vision model override', async () => {
    process.env.CODEGURU_OPENAI_COMPAT = '1'
    process.env.CODEGURU_OPENAI_COMPAT_VISION_MODEL = 'gemma-4-31B-it'

    const inner = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.model).toBe('gemma-4-31B-it')
      return Response.json({
        id: 'chatcmpl-vision',
        object: 'chat.completion',
        model: 'gemma-4-31B-it',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      })
    }

    await wrapFetchWithOpenAICompat(inner)(
      'https://api.sambanova.ai/v1/messages',
      {
        method: 'POST',
        body: JSON.stringify({
          model: 'GLM-5.3',
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: 'QUJD',
                  },
                },
              ],
            },
          ],
          max_tokens: 16,
          stream: false,
        }),
      },
    )
  })
})
