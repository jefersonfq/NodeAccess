/** Provider-side shape; application validation still enforces lengths and limits. */
export const terminalAssistJsonSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string' }, explanation: { type: 'string' }, content: { type: 'string' },
    alternatives: { type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: { content: { type: 'string' }, explanation: { type: 'string' } },
      required: ['content', 'explanation'],
    } },
  },
  required: ['title', 'explanation', 'content', 'alternatives'],
}
