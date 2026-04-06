/** Resposta padrão de erro da API */
export interface ApiError {
  statusCode: number
  error:      string
  message:    string
}

/** Resposta paginada genérica */
export interface Paginated<T> {
  data:  T[]
  total: number
  page:  number
  limit: number
}

/** Contexto do tenant resolvido pelo Nginx header */
export interface TenantContext {
  id:   number
  slug: string
  name: string
}