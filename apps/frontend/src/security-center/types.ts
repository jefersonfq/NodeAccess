export interface PublicSecuritySection {
  id: string
  title: string
  summary: string
  details: string[]
  conditions: string[]
}

export interface PublicSecurityCatalog {
  revision: string
  reviewedAt: string
  sections: PublicSecuritySection[]
  practices: string[]
}
