// Event add-ons: emails (copy per VOICE.md). Lines name the add-on, the person's
// first name and the price; never health or contact details.

import { emailLayout, escapeHtml as esc } from '@/lib/email-layout'
import { formatAddonPrice } from './rules'

export interface EmailLine {
  title: string
  firstName: string
  variantLabel?: string | null
  quantity: number
  unitPriceCents: number
  currency: string
}

function lineText(l: EmailLine): string {
  const what = l.variantLabel ? `${l.title} (${l.variantLabel})` : l.title
  const qty = l.quantity > 1 ? ` × ${l.quantity}` : ''
  return `${what}${qty} for ${l.firstName}: ${formatAddonPrice(l.unitPriceCents * l.quantity, l.currency)}`
}

function linesHtml(lines: EmailLine[]): string {
  return `<ul>${lines.map((l) => `<li>${esc(lineText(l))}</li>`).join('')}</ul>`
}

/** "Each person pays": a link to pay for the extras booked for them (US-18, US-19). */
export function addonPayLinkEmail({
  firstName, eventTitle, lines, totalCents, currency, payUrl, closesAt, bookedBy,
}: {
  firstName: string; eventTitle: string; lines: EmailLine[]; totalCents: number; currency: string; payUrl: string; closesAt: string | null; bookedBy: string
}) {
  const total = formatAddonPrice(totalCents, currency)
  const deadline = closesAt ? new Date(closesAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null
  const subject = `Pay for your extras: ${eventTitle}`
  const html = emailLayout({
    heading: 'Extras Booked for You',
    preheader: `${total} to pay for your extras at ${eventTitle}.`,
    bodyHtml: `
        <p>Hi ${esc(firstName)},</p>
        <p>${bookedBy === 'You' ? 'You added these extras' : `${esc(bookedBy)} booked these extras for you`} at <strong>${esc(eventTitle)}</strong>:</p>
        ${linesHtml(lines)}
        <p><strong>Total: ${esc(total)}</strong></p>
        <p><a href="${esc(payUrl)}">Pay for your extras</a>. Anyone can pay from this link, so you can forward it to a parent or guardian.</p>
        ${deadline ? `<p>Your place is held until ${esc(deadline)}. If it isn’t paid by then, it’s released for someone else.</p>` : ''}
        <p style="color:#6b7280;font-size:14px">Questions? Ask your group’s organizer or reply to this email.</p>`,
  })
  const text = `Hi ${firstName},\n\n${bookedBy === 'You' ? 'You added these extras' : `${bookedBy} booked these extras for you`} at ${eventTitle}:\n${lines.map((l) => `- ${lineText(l)}`).join('\n')}\n\nTotal: ${total}\n\nPay here (anyone can pay from this link): ${payUrl}\n${deadline ? `\nYour place is held until ${deadline}. If it isn't paid by then, it's released for someone else.\n` : ''}\n— Stellr Education`
  return { subject, html, text }
}

/** Paid: the receipt for an add-on order (US-21). */
export function addonPaidEmail({
  firstName, eventTitle, lines, totalCents, currency, awaitingConsent,
}: {
  firstName: string; eventTitle: string; lines: EmailLine[]; totalCents: number; currency: string; awaitingConsent: string[]
}) {
  const total = formatAddonPrice(totalCents, currency)
  const subject = `Your extras are booked: ${eventTitle}`
  const consent = awaitingConsent.length
    ? `<p>${esc(awaitingConsent.join(', '))} still ${awaitingConsent.length === 1 ? 'needs' : 'need'} a parent or guardian to sign the overnight and off-site consent. We’ll send it when it’s ready; the booking is confirmed once it’s signed.</p>`
    : ''
  const html = emailLayout({
    heading: 'Your Extras Are Booked',
    preheader: `Payment received for your extras at ${eventTitle}.`,
    bodyHtml: `
        <p>Hi ${esc(firstName)},</p>
        <p>Thanks — we’ve received ${esc(total)} for these extras at <strong>${esc(eventTitle)}</strong>:</p>
        ${linesHtml(lines)}
        ${consent}
        <p>You’ll find them in your account, beside your registration. Stripe emails a receipt separately.</p>`,
  })
  const text = `Hi ${firstName},\n\nThanks — we've received ${total} for these extras at ${eventTitle}:\n${lines.map((l) => `- ${lineText(l)}`).join('\n')}\n${awaitingConsent.length ? `\n${awaitingConsent.join(', ')} still need a parent or guardian to sign the overnight and off-site consent. The booking is confirmed once it's signed.\n` : ''}\nYou'll find them in your account, beside your registration.\n\n— Stellr Education`
  return { subject, html, text }
}
