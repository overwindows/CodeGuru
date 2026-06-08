/**
 * Bun preload script — defines build-time globals that the Bun bundler would
 * normally inline. At dev time these are set to safe defaults.
 */

// @ts-nocheck
globalThis.MACRO = {
  VERSION: '0.0.1-beta',
  BUILD_TIME: new Date().toISOString(),
  PACKAGE_URL: '@anthropic-ai/claude-code',
  NATIVE_PACKAGE_URL: '',
  ISSUES_EXPLAINER: '',
  FEEDBACK_CHANNEL: '',
};
