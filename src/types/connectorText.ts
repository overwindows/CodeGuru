/** Streaming/API content block for connector-sourced assistant text. */
export type ConnectorTextBlock = {
  type: 'connector_text'
  connector_text: string
  signature?: string
}

export type ConnectorTextDelta = {
  type: 'connector_text_delta'
  connector_text: string
}

export function isConnectorTextBlock(
  block: unknown,
): block is ConnectorTextBlock {
  if (typeof block !== 'object' || block === null) return false
  const b = block as Record<string, unknown>
  return (
    b.type === 'connector_text' && typeof b.connector_text === 'string'
  )
}
