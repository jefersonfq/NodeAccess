import type { FeedbackPublic, FeedbackStatus, FeedbackType } from '@nodeaccess/shared'
import { NotFoundError, ValidationError } from '../../shared/errors.js'
import type { FeedbackRepository } from './feedback.repository.js'
import type { LicenseEntitlementService } from '../license/license-entitlement.service.js'

export interface CreateFeedbackBody {
  type: FeedbackType
  title: string
  message: string
  contextRoute?: string | null
  contextScreen?: string | null
}

export interface UpdateFeedbackBody {
  status: FeedbackStatus
  adminResponse?: string | null
}

export interface AdminFeedbackFilters {
  status?: FeedbackStatus
  type?: FeedbackType
  userId?: number
}

const TYPE_TO_DB = {
  suggestion: 'SUGGESTION',
  problem: 'PROBLEM',
  question: 'QUESTION',
} as const

const TYPE_FROM_DB = {
  SUGGESTION: 'suggestion',
  PROBLEM: 'problem',
  QUESTION: 'question',
} as const

const STATUS_TO_DB = {
  new: 'NEW',
  in_review: 'IN_REVIEW',
  accepted: 'ACCEPTED',
  not_planned: 'NOT_PLANNED',
  completed: 'COMPLETED',
} as const

const STATUS_FROM_DB = {
  NEW: 'new',
  IN_REVIEW: 'in_review',
  ACCEPTED: 'accepted',
  NOT_PLANNED: 'not_planned',
  COMPLETED: 'completed',
} as const

export class FeedbackService {
  constructor(
    private readonly feedbackRepository: FeedbackRepository,
    private readonly licenseEntitlementService: LicenseEntitlementService,
  ) {}

  async create(tenantId: number, userId: number, input: CreateFeedbackBody): Promise<FeedbackPublic> {
    await this.ensureLicensed(tenantId)
    const title = input.title.trim()
    const message = input.message.trim()

    if (title.length < 4) throw new ValidationError('Informe um título mais descritivo')
    if (message.length < 10) throw new ValidationError('Descreva melhor o feedback antes de enviar')

    const feedback = await this.feedbackRepository.create({
      tenantId,
      userId,
      type: TYPE_TO_DB[input.type],
      title,
      message,
      contextRoute: sanitizeContext(input.contextRoute),
      contextScreen: sanitizeContext(input.contextScreen),
    })
    if (!feedback) throw new NotFoundError('Feedback')

    return mapFeedback(feedback)
  }

  async listMine(tenantId: number, userId: number): Promise<FeedbackPublic[]> {
    await this.ensureLicensed(tenantId)
    const feedbacks = await this.feedbackRepository.listMine(tenantId, userId)
    return feedbacks.filter(isFeedbackRecord).map(mapFeedback)
  }

  async listForAdmin(tenantId: number, filters: AdminFeedbackFilters): Promise<FeedbackPublic[]> {
    await this.ensureLicensed(tenantId)
    const repositoryFilters: {
      status?: 'NEW' | 'IN_REVIEW' | 'ACCEPTED' | 'NOT_PLANNED' | 'COMPLETED'
      type?: 'SUGGESTION' | 'PROBLEM' | 'QUESTION'
      userId?: number
    } = {}

    if (filters.status) repositoryFilters.status = STATUS_TO_DB[filters.status]
    if (filters.type) repositoryFilters.type = TYPE_TO_DB[filters.type]
    if (typeof filters.userId === 'number') repositoryFilters.userId = filters.userId

    const feedbacks = await this.feedbackRepository.listForAdmin(tenantId, repositoryFilters)

    return feedbacks.filter(isFeedbackRecord).map(mapFeedback)
  }

  async update(tenantId: number, id: number, input: UpdateFeedbackBody): Promise<FeedbackPublic> {
    await this.ensureLicensed(tenantId)
    const existing = await this.feedbackRepository.findById(tenantId, id)
    if (!existing) throw new NotFoundError('Feedback')
    if (existing.deletedAt) throw new ValidationError('Feedback já foi excluído')

    const feedback = await this.feedbackRepository.update(id, {
      status: STATUS_TO_DB[input.status],
      adminResponse: normalizeResponse(input.adminResponse),
      closedAt: input.status === 'completed' ? new Date() : null,
    })
    if (!feedback) throw new NotFoundError('Feedback')

    return mapFeedback(feedback)
  }

  async delete(tenantId: number, id: number, deletedByUserId: number): Promise<FeedbackPublic> {
    await this.ensureLicensed(tenantId)
    const existing = await this.feedbackRepository.findById(tenantId, id)
    if (!existing) throw new NotFoundError('Feedback')
    if (existing.deletedAt) return mapFeedback(existing)

    const feedback = await this.feedbackRepository.softDelete(id, {
      deletedAt: new Date(),
      deletedByUserId,
    })
    if (!feedback) throw new NotFoundError('Feedback')

    return mapFeedback(feedback)
  }

  private async ensureLicensed(tenantId: number): Promise<void> {
    await this.licenseEntitlementService.requireFeature(
      tenantId,
      'feedback',
      'Feedback não está habilitado na licença deste tenant',
    )
  }
}

function sanitizeContext(value?: string | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  return trimmed.slice(0, 190)
}

function normalizeResponse(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function mapFeedback(
  feedback: {
    id: number
    type: keyof typeof TYPE_FROM_DB
    title: string
    message: string
    status: keyof typeof STATUS_FROM_DB
    adminResponse: string | null
    contextRoute: string | null
    contextScreen: string | null
    createdAt: Date
    updatedAt: Date
    closedAt: Date | null
    deletedAt: Date | null
    user?: { id: number; name: string; email: string } | null
    deletedBy?: { id: number; name: string; email: string } | null
  },
): FeedbackPublic {
  return {
    id: feedback.id,
    type: TYPE_FROM_DB[feedback.type],
    title: feedback.title,
    message: feedback.message,
    status: STATUS_FROM_DB[feedback.status],
    adminResponse: feedback.adminResponse,
    contextRoute: feedback.contextRoute,
    contextScreen: feedback.contextScreen,
    createdAt: feedback.createdAt.toISOString(),
    updatedAt: feedback.updatedAt.toISOString(),
    closedAt: feedback.closedAt?.toISOString() ?? null,
    deletedAt: feedback.deletedAt?.toISOString() ?? null,
    user: feedback.user ?? undefined,
    deletedBy: feedback.deletedBy ?? null,
  }
}

function isFeedbackRecord<T>(value: T | null): value is T {
  return value !== null
}
