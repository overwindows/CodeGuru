export const X_SEARCH_TOOL_NAME = 'x_search'

export const DESCRIPTION = `The x_search tool searches for posts on Twitter/X using the xAI API.

**When to use:**
- Need to find recent tweets about a topic
- Need to search for specific users or hashtags
- Need current trending topics on X

**Requirements:**
- Requires XAI_API_KEY environment variable
- Falls back to web search if XAI API is not available

**Limitations:**
- Rate limits may apply
- Some tweets may not be available due to privacy settings

**Usage:**
- query: The search query (e.g., "from:@username", "#hashtag", "keyword")
- max_results: Maximum number of results to return (default: 10, max: 100)
`