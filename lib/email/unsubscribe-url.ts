// The member one-click unsubscribe link (app/api/email/unsubscribe). Neutral
// module so event mail can build it without importing the Stellr-only
// campaigns engine (lib/email-campaigns.ts re-exports both helpers).

export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stellreducation.org'
}

export function unsubscribeUrl(token: string): string {
  return `${appUrl()}/api/email/unsubscribe?token=${token}`
}
