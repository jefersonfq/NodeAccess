/** NA-0187 — short browser/system label for a stored user-agent string. */
const BROWSERS: Array<[RegExp, string]> = [[/Edg\//, 'Edge'], [/OPR\//, 'Opera'], [/Firefox\//, 'Firefox'], [/Chrome\//, 'Chrome'], [/Safari\//, 'Safari']]
const SYSTEMS: Array<[RegExp, string]> = [[/Windows/, 'Windows'], [/Android/, 'Android'], [/iPhone|iPad/, 'iOS'], [/Mac OS X/, 'macOS'], [/Linux/, 'Linux']]
/** Short "Browser · System" label; the full string stays in the tooltip. */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return '—'
  const browser = BROWSERS.find(([re]) => re.test(userAgent))?.[1]
  const system = SYSTEMS.find(([re]) => re.test(userAgent))?.[1]
  return [browser, system].filter(Boolean).join(' · ') || userAgent.slice(0, 40)
}
