import { z } from 'zod'

type WithoutDefault<T extends z.ZodType> = T extends z.ZodDefault<infer Inner> ? Inner : T

/** PATCH input must not reset omitted fields to their create-time defaults. */
export function partialWithoutDefaults<T extends Record<string, z.ZodType>>(schema: z.ZodObject<T>): z.ZodObject<{ [K in keyof T]: z.ZodOptional<WithoutDefault<T[K]>> }> {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [
    key, z.optional(field instanceof z.ZodDefault ? field.removeDefault() : field),
  ]))
  return z.object(shape) as z.ZodObject<{ [K in keyof T]: z.ZodOptional<WithoutDefault<T[K]>> }>
}
