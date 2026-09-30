const configuredBase = import.meta.env.BASE_URL || '/'

export const BASE_URL = configuredBase.endsWith('/')
  ? configuredBase
  : `${configuredBase}/`

export function withBase(path: string): string {
  return `${BASE_URL}${path.replace(/^\/+/, '')}`
}
