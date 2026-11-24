// Amazon SES, the email standby (email plan F, warm standby; owner, 23 Nov 2026).
//
// Used only while EMAIL_PROVIDER=ses (lib/email/provider.ts), switched by a person
// when Resend is down or the account is paused (docs/RUNBOOK-email-standby.md).
// Sends raw MIME through SESv2 in us-east-2, through the configuration set whose
// events reach app/api/webhooks/ses, with short-lived credentials from Vercel OIDC
// (IAM role stellr-ses-standby: send-only, this identity and set only).
//
// SES knows one identity, mail.stellreducation.org, so a From on any other domain
// (a tenant's own domain, the community domain) is moved onto it: the name is kept
// and "via Stellr" added where it is not Stellr's, and replies still go where
// Reply-To says. There is no idempotency key on SES; the outbox's row claim is the
// guard against a double send.

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { buildMime } from './mime'
import { addressOf, domainOf } from './senders'
import { EmailSendError, resendTags, type EmailTransport, type OutgoingEmail } from './transport'

export const SES_IDENTITY_DOMAIN = 'mail.stellreducation.org'
export const SES_FROM_ADDRESS = `no-reply@${SES_IDENTITY_DOMAIN}`

/** The From SES can send: unchanged on the SES identity's domain, otherwise moved onto it. */
export function sesFrom(from: string): string {
  if (domainOf(from) === SES_IDENTITY_DOMAIN) return from
  const name = from.includes('<') ? from.slice(0, from.indexOf('<')).replace(/"/g, '').trim() : ''
  const shown = name ? (/stellr/i.test(name) ? name : `${name} via Stellr`) : 'Stellr Education'
  return `"${shown}" <${SES_FROM_ADDRESS}>`
}

let client: SESv2Client | null = null
function sesClient(): SESv2Client {
  if (client) return client
  const roleArn = process.env.SES_ROLE_ARN
  if (!roleArn) throw new EmailSendError('SES_ROLE_ARN is not set, so the SES standby cannot send', 503, 'ses_not_configured')
  client = new SESv2Client({
    region: process.env.SES_REGION || 'us-east-2',
    credentials: awsCredentialsProvider({ roleArn }),
  })
  return client
}

/** For tests: forget the cached client. */
export function resetSesClient(): void {
  client = null
}

function toSendError(err: unknown): EmailSendError {
  const name = (err as { name?: string })?.name ?? 'Error'
  const message = err instanceof Error ? err.message : String(err)
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode
  if (name === 'TooManyRequestsException' || name === 'ThrottlingException') return new EmailSendError(`SES: ${message}`, 429, 'rate_limit_exceeded')
  if (name === 'LimitExceededException' || name === 'SendingPausedException' || name === 'AccountSuspendedException') {
    return new EmailSendError(`SES: ${message}`, 429, 'daily_quota_exceeded')
  }
  if (name === 'MessageRejected' || name === 'BadRequestException' || name === 'MailFromDomainNotVerifiedException') {
    return new EmailSendError(`SES: ${message}`, 422, 'validation_error')
  }
  return new EmailSendError(`SES: ${message}`, status && status >= 400 ? status : 503, name)
}

export function sesTransport(): EmailTransport {
  return {
    name: 'ses',
    async send(message: OutgoingEmail) {
      const from = sesFrom(message.from)
      const raw = buildMime({ ...message, from })
      try {
        const out = await sesClient().send(
          new SendEmailCommand({
            FromEmailAddress: addressOf(from),
            Destination: { ToAddresses: message.to, ...(message.cc.length ? { CcAddresses: message.cc } : {}) },
            Content: { Raw: { Data: raw } },
            ConfigurationSetName: process.env.SES_CONFIGURATION_SET || 'stellr-email-standby',
            EmailTags: resendTags(message.tags).map((t) => ({ Name: t.name, Value: t.value })),
          }),
        )
        return { id: out.MessageId ?? null }
      } catch (err) {
        if (err instanceof EmailSendError) throw err
        throw toSendError(err)
      }
    },
  }
}
