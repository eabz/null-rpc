const DEFAULT_HEADERS = {
  'Content-Type': 'application/json'
}

/**
 * Creates a Response with JSON content-type and stringified data.
 * @param data - The object to serialize
 * @param status - HTTP status code (default: 200)
 */
export function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    headers: DEFAULT_HEADERS,
    status
  })
}

/**
 * Creates a Response with JSON content-type from an already serialized string.
 * Use this for static responses to avoid runtime serialization costs.
 * @param body - The pre-stringified JSON string
 * @param status - HTTP status code (default: 200)
 */
export function createRawJsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    headers: DEFAULT_HEADERS,
    status
  })
}
