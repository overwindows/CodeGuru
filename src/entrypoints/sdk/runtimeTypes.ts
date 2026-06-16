// Stub: SDK runtime types (generated in full build)
// These types are used as import type throughout the codebase.

export type EffortLevel = 'low' | 'medium' | 'high' | 'auto'

export type AnyZodRawShape = Record<string, unknown>
export type InferShape<T> = Record<string, unknown>

export interface Options {}
export interface InternalOptions extends Options {}
export interface Query {}
export interface InternalQuery extends Query {}
export interface SDKSession {}
export interface SDKSessionOptions {}
export interface SessionMessage {}
export interface SessionMutationOptions {}
export interface ListSessionsOptions {}
export interface GetSessionInfoOptions {}
export interface GetSessionMessagesOptions {}
export interface ForkSessionOptions {}
export interface ForkSessionResult {}
export interface McpSdkServerConfigWithInstance {}
export interface SdkMcpToolDefinition {}
