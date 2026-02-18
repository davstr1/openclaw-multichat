/**
 * Strip OpenClaw inbound metadata blocks from user messages.
 * These are prepended by the gateway for the AI but shouldn't be shown in the UI.
 *
 * Pattern 1: "Conversation info (untrusted metadata):\n```json\n{...}\n```\n"
 * Pattern 2: "[Wed 2026-02-18 22:04 GMT+1] " timestamp prefix
 */
export function stripInboundMeta(content: string): string {
  // Remove "Conversation info" code blocks
  let cleaned = content.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*\{[^}]*\}\s*```\s*/g,
    '',
  )
  // Remove timestamp prefix like "[Wed 2026-02-18 22:04 GMT+1] "
  cleaned = cleaned.replace(
    /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*/,
    '',
  )
  return cleaned.trim()
}
