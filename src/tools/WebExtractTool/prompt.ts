export const WEB_EXTRACT_TOOL_NAME = 'web_extract'

export const DESCRIPTION = `The web_extract tool fetches and extracts structured content from URLs or PDFs.

**Capabilities:**
- Extract content from any public URL (web pages, articles, documentation)
- Parse and extract from PDF documents
- Apply a prompt to guide what content to extract
- Returns structured data based on the prompt

**When to use:**
- Need to extract specific information from a web page
- Need to parse a PDF document
- Need structured data extraction (not just raw text)

**Limitations:**
- WILL FAIL for authenticated or private URLs (Google Docs, Confluence, Jira, GitHub raw files)
- For authenticated services, use a specialized MCP tool instead

**Usage:**
- url: The URL to extract from (must be public)
- prompt: What to extract from the content (e.g., "Extract all email addresses", "Get the article title and summary")
`