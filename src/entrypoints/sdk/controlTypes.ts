// Stub: SDK control types (generated in full build)
// These types define the control protocol between SDK implementations and the CLI.

export type StdoutMessage = {
  type: string
  [key: string]: unknown
}
export type StdinMessage = {
  type: string
  [key: string]: unknown
}
export interface SDKControlRequest {
  type: string
  [key: string]: unknown
}
export interface SDKControlResponse {
  type: string
  [key: string]: unknown
}
export interface SDKControlInitializeRequest extends SDKControlRequest {}
export interface SDKControlInitializeResponse extends SDKControlResponse {}
export interface SDKControlMcpSetServersResponse extends SDKControlResponse {}
export interface SDKControlReloadPluginsResponse extends SDKControlResponse {
  plugins: unknown[]
}
export interface SDKControlPermissionRequest extends SDKControlRequest {}
export interface SDKPartialAssistantMessage {
  type: string
  [key: string]: unknown
}
