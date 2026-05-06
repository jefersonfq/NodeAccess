export class AppError extends Error {
  constructor(
    public override readonly message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} não encontrado`, 404, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Não autorizado') {
    super(message, 401, 'UNAUTHORIZED')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Acesso negado') {
    super(message, 403, 'FORBIDDEN')
    this.name = 'ForbiddenError'
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'VALIDATION_ERROR')
    this.name = 'ValidationError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT')
    this.name = 'ConflictError'
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400, 'BAD_REQUEST')
    this.name = 'BadRequestError'
  }
}

export class LicenseLimitError extends AppError {
  constructor() {
    super('Limite de usuários da licença atingido', 403, 'LICENSE_LIMIT_REACHED')
    this.name = 'LicenseLimitError'
  }
}

export class AccountLockedError extends AppError {
  constructor() {
    super('Conta bloqueada por excesso de tentativas. Tente novamente mais tarde.', 403, 'ACCOUNT_LOCKED')
    this.name = 'AccountLockedError'
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Muitas tentativas. Tente novamente mais tarde.') {
    super(message, 429, 'TOO_MANY_REQUESTS')
    this.name = 'TooManyRequestsError'
  }
}
