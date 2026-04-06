import fp from 'fastify-plugin'
import fastifyWebsocket from '@fastify/websocket'

export default fp(async (app) => {
  await app.register(fastifyWebsocket)
})
