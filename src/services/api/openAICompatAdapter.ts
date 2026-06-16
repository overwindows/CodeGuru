/**
 * OpenAI-compatible API adapter for CodeGuru.
 *
 * When CODEGURU_OPENAI_COMPAT=1 (or the base URL is not first-party Anthropic),
 * the Anthropic SDK's /v1/messages requests are intercepted and translated to
 * OpenAI /v1/chat/completions format, and the responses are translated back.
 *
 * This enables providers like SambaNova, Together, OpenRouter, Groq, etc.
 * without needing a separate SDK.
 */

import { isFirstPartyAnthropicBaseUrl } from '../../utils/model/providers.js'
import { isEnvTruthy } from '../../utils/envUtils.js'

/** Return true when we should run OpenAI-compat translation. */
export function isOpenAICompatMode(): boolean {
  if (isEnvTruthy(process.env.CODEGURU_OPENAI_COMPAT)) return true
  // Automatically engage when base URL is not first-party Anthropic
  if (!isFirstPartyAnthropicBaseUrl()) return true
  return false
}

// ---------------------------------------------------------------------------
// Anthropic → OpenAI request translation
// ---------------------------------------------------------------------------

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content:
    | string
    | Array<{
        type: string
        text?: string
        source?: unknown
        id?: string
        name?: string
        input?: unknown
        tool_use_id?: string
        content?: unknown
      }>
}

type AnthropicRequest = {
  model: string
  messages: AnthropicMessage[]
  system?: string | Array<{ type: string; text: string }>
  max_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: Array<{
    name: string
    description?: string
    input_schema: unknown
  }>
  tool_choice?: unknown
}

type OpenAIMessage = {
  role: string
  content:
    | string
    | null
    | Array<{ type: string; text?: string; image_url?: { url: string } }>
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

function anthropicContentToOpenAI(
  content: AnthropicMessage['content'],
): OpenAIMessage['content'] {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)

  const parts: Array<{
    type: string
    text?: string
    image_url?: { url: string }
  }> = []
  for (const block of content) {
    if (block.type === 'text' && block.text !== undefined) {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image' && block.source) {
      const src = block.source as {
        type: string
        media_type?: string
        data?: string
        url?: string
      }
      if (src.type === 'base64' && src.media_type && src.data) {
        parts.push({
          type: 'image_url',
          image_url: {
            url: `data:${src.media_type};base64,${src.data}`,
          },
        })
      } else if (src.type === 'url' && src.url) {
        parts.push({
          type: 'image_url',
          image_url: { url: src.url },
        })
      }
    }
    // tool_use, tool_result blocks are handled separately
  }
  if (parts.length === 1 && parts[0].type === 'text') return parts[0].text!
  if (parts.length === 0) return null
  return parts
}

function translateMessagesToOpenAI(messages: AnthropicMessage[]): OpenAIMessage[] {
  const result: OpenAIMessage[] = []
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content })
      continue
    }
    if (!Array.isArray(msg.content)) {
      result.push({ role: msg.role, content: String(msg.content) })
      continue
    }

    // Check if this assistant message has tool_use blocks
    const toolUseBlocks = msg.content.filter(b => b.type === 'tool_use')
    const textBlocks = msg.content.filter(b => b.type === 'text')
    const toolResultBlocks = msg.content.filter(b => b.type === 'tool_result')

    if (msg.role === 'assistant' && toolUseBlocks.length > 0) {
      const textContent =
        textBlocks.length > 0
          ? textBlocks.map(b => b.text ?? '').join('')
          : null
      result.push({
        role: 'assistant',
        content: textContent,
        tool_calls: toolUseBlocks.map(b => ({
          id: b.id ?? `call_${b.name}`,
          type: 'function' as const,
          function: {
            name: b.name ?? '',
            arguments:
              typeof b.input === 'string'
                ? b.input
                : JSON.stringify(b.input ?? {}),
          },
        })),
      })
      continue
    }

    if (msg.role === 'user' && toolResultBlocks.length > 0) {
      for (const trBlock of toolResultBlocks) {
        const trContent = Array.isArray(trBlock.content)
          ? (trBlock.content as Array<{ type: string; text?: string }>)
              .filter(c => c.type === 'text')
              .map(c => c.text ?? '')
              .join('')
          : typeof trBlock.content === 'string'
            ? trBlock.content
            : ''
        result.push({
          role: 'tool',
          content: trContent,
          tool_call_id: trBlock.tool_use_id ?? '',
        })
      }
      // Any non-tool_result content comes after
      const rest = msg.content.filter(b => b.type !== 'tool_result')
      if (rest.length > 0) {
        result.push({
          role: 'user',
          content: anthropicContentToOpenAI(rest as AnthropicMessage['content']),
        })
      }
      continue
    }

    result.push({
      role: msg.role,
      content: anthropicContentToOpenAI(msg.content),
    })
  }
  return result
}

function buildOpenAIRequest(body: AnthropicRequest): Record<string, unknown> {
  const oaiMessages: OpenAIMessage[] = []

  // Prepend system message
  if (body.system) {
    const systemText =
      typeof body.system === 'string'
        ? body.system
        : Array.isArray(body.system)
          ? body.system
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n')
          : ''
    if (systemText) {
      oaiMessages.push({ role: 'system', content: systemText })
    }
  }

  oaiMessages.push(...translateMessagesToOpenAI(body.messages))

  const req: Record<string, unknown> = {
    model: body.model,
    messages: oaiMessages,
  }

  if (body.max_tokens !== undefined) req.max_tokens = body.max_tokens
  if (body.temperature !== undefined) req.temperature = body.temperature
  if (body.top_p !== undefined) req.top_p = body.top_p
  if (body.stream !== undefined) req.stream = body.stream
  if (body.stop_sequences?.length) req.stop = body.stop_sequences

  if (body.tools?.length) {
    req.tools = body.tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.input_schema,
      },
    }))
  }

  return req
}

// ---------------------------------------------------------------------------
// OpenAI → Anthropic response translation
// ---------------------------------------------------------------------------

type OpenAIResponse = {
  id: string
  object: string
  model: string
  choices: Array<{
    index: number
    message?: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: string
        function: { name: string; arguments: string }
      }>
    }
    finish_reason?: string
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

function openAIToAnthropicResponse(
  oai: OpenAIResponse,
  originalModel: string,
): Record<string, unknown> {
  const choice = oai.choices[0]
  const message = choice?.message

  const contentBlocks: Array<Record<string, unknown>> = []

  if (message?.content) {
    contentBlocks.push({ type: 'text', text: message.content })
  }

  if (message?.tool_calls?.length) {
    for (const tc of message.tool_calls) {
      let parsedInput: unknown = {}
      try {
        parsedInput = JSON.parse(tc.function.arguments)
      } catch {
        parsedInput = tc.function.arguments
      }
      contentBlocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      })
    }
  }

  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: 'text', text: '' })
  }

  const finishReason = choice?.finish_reason
  let stopReason = 'end_turn'
  if (finishReason === 'tool_calls') stopReason = 'tool_use'
  else if (finishReason === 'length') stopReason = 'max_tokens'
  else if (finishReason === 'stop') stopReason = 'end_turn'

  return {
    id: oai.id,
    type: 'message',
    role: 'assistant',
    model: originalModel,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: oai.usage?.prompt_tokens ?? 0,
      output_tokens: oai.usage?.completion_tokens ?? 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Streaming: translate SSE chunks from OpenAI to Anthropic stream format
// ---------------------------------------------------------------------------

type OpenAIDelta = {
  role?: string
  content?: string | null
  tool_calls?: Array<{
    index: number
    id?: string
    type?: string
    function?: { name?: string; arguments?: string }
  }>
}

/**
 * Emit a properly-formatted Anthropic SSE event.
 * The Anthropic SDK's SSEDecoder requires:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 * The `type` field inside the JSON payload is redundant but harmless.
 */
function sseEvent(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
}

function* translateStreamChunk(
  chunk: {
    id: string
    model: string
    choices: Array<{
      index: number
      delta: OpenAIDelta
      finish_reason?: string | null
    }>
    usage?: {
      prompt_tokens: number
      completion_tokens: number
    }
  },
  state: {
    messageStarted: boolean
    inputTokens: number
    contentIndex: number
    toolCallIndex: Map<number, number>
    toolCallIds: Map<number, string>
    toolCallNames: Map<number, string>
  },
): Generator<string> {
  const choice = chunk.choices[0]

  if (!state.messageStarted) {
    state.messageStarted = true
    yield sseEvent('message_start', {
      type: 'message_start',
      message: {
        id: chunk.id,
        type: 'message',
        role: 'assistant',
        content: [],
        model: chunk.model,
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: state.inputTokens, output_tokens: 0 },
      },
    })
  }

  const delta = choice?.delta

  if (delta?.content) {
    // Text delta — open the text block on first content
    if (state.contentIndex === 0 && !state.toolCallIndex.has(0)) {
      yield sseEvent('content_block_start', {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      })
      yield sseEvent('ping', { type: 'ping' })
      state.contentIndex = 1
    }
    yield sseEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: delta.content },
    })
  }

  if (delta?.tool_calls?.length) {
    for (const tc of delta.tool_calls) {
      const tcIdx = tc.index
      if (!state.toolCallIndex.has(tcIdx)) {
        const blockIdx = state.contentIndex++
        state.toolCallIndex.set(tcIdx, blockIdx)
        const toolId = tc.id ?? `call_${tcIdx}`
        const toolName = tc.function?.name ?? ''
        state.toolCallIds.set(tcIdx, toolId)
        state.toolCallNames.set(tcIdx, toolName)
        yield sseEvent('content_block_start', {
          type: 'content_block_start',
          index: blockIdx,
          content_block: {
            type: 'tool_use',
            id: toolId,
            name: toolName,
            input: {},
          },
        })
      }
      if (tc.function?.arguments) {
        const blockIdx = state.toolCallIndex.get(tcIdx)!
        yield sseEvent('content_block_delta', {
          type: 'content_block_delta',
          index: blockIdx,
          delta: {
            type: 'input_json_delta',
            partial_json: tc.function.arguments,
          },
        })
      }
    }
  }

  if (choice?.finish_reason) {
    // Close open content blocks
    for (let i = 0; i < state.contentIndex; i++) {
      yield sseEvent('content_block_stop', { type: 'content_block_stop', index: i })
    }

    const finishReason = choice.finish_reason
    let stopReason = 'end_turn'
    if (finishReason === 'tool_calls') stopReason = 'tool_use'
    else if (finishReason === 'length') stopReason = 'max_tokens'

    yield sseEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: chunk.usage?.completion_tokens ?? 0 },
    })

    yield sseEvent('message_stop', { type: 'message_stop' })
  }
}

async function translateStreamResponse(
  oaiStream: Response,
  originalModel: string,
  estimatedInputTokens: number,
): Promise<Response> {
  const reader = oaiStream.body?.getReader()
  if (!reader) {
    return new Response('No stream body', { status: 500 })
  }

  const state = {
    messageStarted: false,
    inputTokens: estimatedInputTokens,
    contentIndex: 0,
    toolCallIndex: new Map<number, number>(),
    toolCallIds: new Map<number, string>(),
    toolCallNames: new Map<number, string>(),
  }

  const decoder = new TextDecoder()
  let buffer = ''

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        while (true) {
          let done = false
          let value: Uint8Array | undefined

          try {
            const result = await reader.read()
            done = result.done
            value = result.value
          } catch {
            break
          }

          if (done) {
            // Flush any remaining buffered data
            if (buffer.trim()) {
              try {
                // Strip leading 'data:' or 'event:' prefix if present
                const trimmed = buffer.trim()
                const dataLine = trimmed.startsWith('data:')
                  ? trimmed.slice(5).trim()
                  : trimmed.startsWith('event:')
                    ? null
                    : trimmed
                if (dataLine && dataLine !== '[DONE]') {
                  const parsed = JSON.parse(dataLine)
                  for (const sseChunk of translateStreamChunk(parsed as Parameters<typeof translateStreamChunk>[0], state)) {
                    controller.enqueue(encoder.encode(sseChunk))
                  }
                }
              } catch {
                /* ignore parse errors at stream end */
              }
            }
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            // Skip empty lines, comments, and non-data lines (event: lines, etc.)
            if (!trimmed || trimmed === ':' || trimmed.startsWith('event:')) continue
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (data === '[DONE]') continue
            try {
              const parsed = JSON.parse(data)
              for (const sseChunk of translateStreamChunk(parsed as Parameters<typeof translateStreamChunk>[0], state)) {
                controller.enqueue(encoder.encode(sseChunk))
              }
            } catch {
              /* skip malformed chunks */
            }
          }
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
    },
  })
}

// ---------------------------------------------------------------------------
// Main fetch interceptor
// ---------------------------------------------------------------------------

/** Rough estimate of input tokens for stream start event (exact value comes later in usage). */
function estimateTokens(body: AnthropicRequest): number {
  const systemLen =
    typeof body.system === 'string'
      ? body.system.length
      : Array.isArray(body.system)
        ? body.system.map(b => b.text).join('').length
        : 0
  const msgLen = body.messages.reduce((acc, m) => {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return acc + c.length
  }, 0)
  return Math.ceil((systemLen + msgLen) / 4)
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * Wraps a fetch function to intercept Anthropic SDK calls and translate them
 * to OpenAI-compatible format when the base URL is not first-party Anthropic.
 */
export function wrapFetchWithOpenAICompat(inner: FetchFn): FetchFn {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)

    // Check compat mode lazily at each call so env vars applied after client
    // construction are respected (e.g. ANTHROPIC_BASE_URL set by the CODEGURU_*
    // alias bridge which runs during settings load, which may occur after the
    // Anthropic client object is first constructed).
    // Also only intercept /v1/messages — all other paths pass through unchanged.
    if (!isOpenAICompatMode() || !url.includes('/v1/messages')) {
      return inner(input, init)
    }

    // Parse the Anthropic request body
    const bodyText =
      init?.body instanceof Uint8Array
        ? new TextDecoder().decode(init.body)
        : typeof init?.body === 'string'
          ? init.body
          : init?.body != null
            ? String(init.body)
            : '{}'

    let anthropicBody: AnthropicRequest
    try {
      anthropicBody = JSON.parse(bodyText) as AnthropicRequest
    } catch {
      // Can't parse — pass through unchanged
      return inner(input, init)
    }

    // Translate to OpenAI format
    const openAIBody = buildOpenAIRequest(anthropicBody)

    // Build the OpenAI URL: replace /v1/messages → /v1/chat/completions
    const oaiUrl = url.replace(/\/v1\/messages(\?.*)?$/, '/v1/chat/completions')

    // Forward headers, removing Anthropic-specific headers that third-party
    // OpenAI-compatible endpoints don't understand (and may reject).
    const headers = new Headers(init?.headers)
    headers.set('content-type', 'application/json')
    // Remove headers only Anthropic's backend knows about
    headers.delete('anthropic-version')
    headers.delete('anthropic-beta')
    headers.delete('x-api-key')
    headers.delete('x-app')
    headers.delete('x-claude-code-session-id')

    const isStreaming = anthropicBody.stream === true

    const oaiResponse = await inner(oaiUrl, {
      ...init,
      method: 'POST',
      headers,
      body: JSON.stringify(openAIBody),
    })

    if (!oaiResponse.ok) {
      // Pass error response back as-is so SDK error handling works
      return oaiResponse
    }

    if (isStreaming) {
      return translateStreamResponse(
        oaiResponse,
        anthropicBody.model,
        estimateTokens(anthropicBody),
      )
    }

    // Non-streaming: parse and translate
    const oaiJson = (await oaiResponse.json()) as OpenAIResponse
    const anthropicJson = openAIToAnthropicResponse(oaiJson, anthropicBody.model)

    return new Response(JSON.stringify(anthropicJson), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
}
