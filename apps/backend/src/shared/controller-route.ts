import type { FastifyRequest } from 'fastify'

/** Preserve a controller's request contract when registering its bound handler. */
export type ControllerRoute<T> = T extends (request: FastifyRequest<infer Route>, ...args: never[]) => unknown
  ? Route
  : never
