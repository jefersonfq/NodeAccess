import type { FastifyReply, FastifyRequest } from 'fastify'
import type { CompleteAiInvestigationDto } from '@nodeaccess/shared'
import type { AiInvestigationService } from './ai-investigation.service.js'
export class AiInvestigationController {
  constructor(private readonly service: AiInvestigationService) {}
  list(req: FastifyRequest, rep: FastifyReply) { return this.service.list(req.jwtUser!.tenantId).then((v) => rep.send(v)) }
  get(req: FastifyRequest<{ Params: { id: string } }>, rep: FastifyReply) { return this.service.get(Number(req.params.id), req.jwtUser!.tenantId).then((v) => rep.send(v)) }
  complete(req: FastifyRequest<{ Params: { id: string }; Body: CompleteAiInvestigationDto }>, rep: FastifyReply) { return this.service.complete(Number(req.params.id), req.jwtUser!.tenantId, Number(req.jwtUser!.sub), req.body).then((v) => rep.send(v)) }
  abandon(req: FastifyRequest<{ Params: { id: string } }>, rep: FastifyReply) { return this.service.abandon(Number(req.params.id), req.jwtUser!.tenantId, Number(req.jwtUser!.sub)).then((v) => rep.send(v)) }
}
