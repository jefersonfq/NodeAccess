import { z } from 'zod'

/** Fastify uses draft-7. Runtime services retain refinements that JSON Schema cannot express. */
export function zodToJsonSchema(schema: z.ZodType): z.core.JSONSchema.JSONSchema {
  return z.toJSONSchema(schema, {
    target: 'draft-7', io: 'input', unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema }): void => {
      // Dates cross HTTP as ISO strings, matching the previous converter contract.
      if (zodSchema._zod.def.type === 'object' && !zodSchema._zod.def.catchall) {
        // Match Zod's default stripping and the previous AJV request contract.
        jsonSchema.additionalProperties = false
      }
      if (zodSchema._zod.def.type === 'date') {
        jsonSchema.type = 'string'
        jsonSchema.format = 'date-time'
      }
    },
  })
}
