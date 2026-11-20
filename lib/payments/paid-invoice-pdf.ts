import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import { tokens } from '@/lib/tokens'
import { ORG_POSTAL_ADDRESS } from '@/lib/email-layout'
import { pdfSafe } from '@/lib/pdf-safe'
import type { ParticipantForDocs, PaymentDocuments, RegistrationForDocs } from './documents'

// A paid invoice / receipt that Stellr issues itself, for a payment Stripe holds no
// invoice for: a card payment made before Checkout issued invoices (a teacher's pay-link
// payment of 9 Nov 2026, for one), and a group invoice an admin marked paid offline.
// One page, Stellr's name and address, and the facts the payment record holds.
// Never a bill: it is only issued for a payment that has been made.

export const ORG_NAME = 'Stellr Education'
export const ORG_EMAIL = 'hello@stellreducation.org'
export const ORG_SITE = 'stellreducation.org'

export interface PaidInvoiceLine {
  description: string
  quantity: number
  amountCents: number
}

export interface PaidInvoiceData {
  documentNumber: string
  issuedOn: string
  paidOn: string | null
  payerName: string
  payerEmail: string | null
  schoolName: string | null
  eventTitle: string
  lines: PaidInvoiceLine[]
  totalCents: number
  refundedCents: number
  currency: string
  /** "Visa ending 8046", "Invoice paid offline", … */
  method: string
  /** Stripe ids or the invoice number, for anyone reconciling it. */
  reference: string | null
}

const fullName = (first?: string | null, last?: string | null) => `${first ?? ''} ${last ?? ''}`.trim()

function capital(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/**
 * The facts for a paid invoice, from what paid for the place. Null when nothing was paid
 * (a free place, or a payment still pending) or the amount cannot be known.
 */
export async function buildPaidInvoiceData(
  db: SupabaseClient,
  docs: PaymentDocuments,
  participant: ParticipantForDocs,
  registration: RegistrationForDocs,
  now: Date = new Date(),
): Promise<PaidInvoiceData | null> {
  const eventTitle = registration.event_title || registration.event_slug
  const participantName = fullName(participant.first_name, participant.last_name)
  const organiser = fullName(registration.teacher_first_name, registration.teacher_last_name)
  const isGroup = registration.type === 'group'
  // A seat paid by its own payment is that person's; anything else on a group is the organiser's.
  const ownSeat = !!participant.stripe_payment_intent_id && docs.charge?.paymentIntentId === participant.stripe_payment_intent_id
  const wholeGroup = isGroup && !ownSeat
  const groupLabel = registration.group_name || registration.school_name || organiser

  if (docs.charge) {
    const c = docs.charge
    const seats = docs.invoice?.seats ?? (wholeGroup ? (registration.adult_count ?? 0) + (registration.student_count ?? 0) : 0)
    const lines: PaidInvoiceLine[] = [{
      description: wholeGroup
        ? `${eventTitle}: registration for ${groupLabel || 'the group'}`
        : `${eventTitle}: registration for ${participantName || 'one participant'}`,
      quantity: wholeGroup && seats > 0 ? seats : 1,
      amountCents: c.amountCents,
    }]
    return {
      documentNumber: `STL-${c.chargeId.slice(-10).toUpperCase()}`,
      issuedOn: now.toISOString(),
      paidOn: c.paidAt,
      payerName: c.billingName || (wholeGroup ? organiser : participantName) || 'Registrant',
      payerEmail: c.billingEmail ?? (wholeGroup ? registration.teacher_email : participant.email),
      schoolName: registration.school_name,
      eventTitle,
      lines,
      totalCents: c.amountCents,
      refundedCents: c.refundedCents,
      currency: c.currency,
      method: c.cardBrand ? `${capital(c.cardBrand)} card${c.cardLast4 ? ` ending ${c.cardLast4}` : ''}` : 'Card',
      reference: docs.invoice?.number ? `Stripe invoice ${docs.invoice.number}` : `Stripe payment ${c.paymentIntentId}`,
    }
  }

  if (docs.offlinePaid) {
    // What the group was invoiced: its ledger's live invoices, else the amount due.
    const { data: rows } = await db
      .from('group_invoices')
      .select('total_cents, seats, status, stripe_invoice_number')
      .eq('registration_id', registration.id)
      .in('status', ['open', 'paid'])
    const ledger = (rows ?? []) as { total_cents: number; seats: number; stripe_invoice_number: string | null }[]
    const total = ledger.length ? ledger.reduce((n, r) => n + (r.total_cents ?? 0), 0) : registration.amount_due_cents ?? 0
    if (total <= 0) return null
    const seats = ledger.length ? ledger.reduce((n, r) => n + (r.seats ?? 0), 0) : (registration.adult_count ?? 0) + (registration.student_count ?? 0)
    const { data: refundRows } = await db
      .from('event_refunds')
      .select('refund_cents')
      .eq('registration_id', registration.id)
      .eq('refund_type', 'cash')
    const refunded = ((refundRows ?? []) as { refund_cents: number | null }[]).reduce((n, r) => n + (r.refund_cents ?? 0), 0)
    const numbers = ledger.map((r) => r.stripe_invoice_number).filter(Boolean)
    return {
      documentNumber: `STL-${registration.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`,
      issuedOn: now.toISOString(),
      paidOn: registration.invoice_paid_at,
      payerName: organiser || groupLabel || 'Registrant',
      payerEmail: registration.teacher_email,
      schoolName: registration.school_name,
      eventTitle,
      lines: [{
        description: `${eventTitle}: registration for ${isGroup ? groupLabel || 'the group' : participantName || 'one participant'}`,
        quantity: seats > 0 ? seats : 1,
        amountCents: total,
      }],
      totalCents: total,
      refundedCents: Math.min(refunded, total),
      currency: 'usd',
      method: 'Invoice, paid directly to Stellr Education',
      reference: numbers.length ? `Invoice ${numbers.join(', ')}` : null,
    }
  }

  return null
}

// ── Rendering ──────────────────────────────────────────────────────────────────

function hex(h: string): RGB {
  const n = parseInt(h.replace('#', ''), 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

const INK = hex(tokens.color.ink)
const BODY = hex(tokens.color.text.body)
const MUTED = hex(tokens.color.text.muted)
const RULE = hex(tokens.color.border)
const PRIMARY = hex(tokens.color.primary)
const GREEN = hex(tokens.color.enviroGreen)

const PAGE: [number, number] = [612, 792] // US Letter
const MARGIN = 54

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Denver' })
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = pdfSafe(text).split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line)
      line = w
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

let logoBytes: Promise<Uint8Array | null> | null = null
function loadLogo(): Promise<Uint8Array | null> {
  logoBytes ??= readFile(path.join(process.cwd(), 'public', 'images', 'logo-horiz.png'))
    .then((b) => new Uint8Array(b))
    .catch(() => null)
  return logoBytes
}

export async function renderPaidInvoicePdf(data: PaidInvoiceData): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(pdfSafe(`Paid invoice ${data.documentNumber}`))
  doc.setAuthor(ORG_NAME)
  doc.setCreator(ORG_NAME)
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const page: PDFPage = doc.addPage(PAGE)
  const [w, h] = PAGE
  const right = w - MARGIN
  const text = (s: string, x: number, y: number, size = 10, font: PDFFont = regular, color: RGB = BODY) =>
    page.drawText(pdfSafe(s), { x, y, size, font, color })
  const textRight = (s: string, y: number, size = 10, font: PDFFont = regular, color: RGB = BODY) =>
    text(s, right - font.widthOfTextAtSize(pdfSafe(s), size), y, size, font, color)

  // Header: logo (or the name), the document's title and status.
  let y = h - MARGIN
  const logo = await loadLogo()
  if (logo) {
    try {
      const img = await doc.embedPng(logo)
      const lw = 150
      const lh = (img.height / img.width) * lw
      page.drawImage(img, { x: MARGIN, y: y - lh, width: lw, height: lh })
    } catch {
      text(ORG_NAME, MARGIN, y - 18, 18, bold, INK)
    }
  } else {
    text(ORG_NAME, MARGIN, y - 18, 18, bold, INK)
  }
  textRight('PAID INVOICE', y - 16, 18, bold, INK)
  const fullyRefunded = data.refundedCents >= data.totalCents && data.totalCents > 0
  const status = fullyRefunded ? 'REFUNDED' : data.refundedCents > 0 ? 'PAID, PART REFUNDED' : 'PAID'
  textRight(status, y - 34, 11, bold, fullyRefunded ? MUTED : GREEN)
  y -= 70

  // From / details.
  text(ORG_NAME, MARGIN, y, 10, bold, INK)
  textRight(`Invoice number  ${data.documentNumber}`, y)
  y -= 14
  const address = ORG_POSTAL_ADDRESS.split(/,\s*/)
  const addrLines = address.length > 2 ? [address.slice(0, -2).join(', '), address.slice(-2).join(', ')] : [ORG_POSTAL_ADDRESS]
  text(addrLines[0], MARGIN, y)
  textRight(`Issued  ${formatDate(data.issuedOn)}`, y)
  y -= 14
  if (addrLines[1]) text(addrLines[1], MARGIN, y)
  textRight(`Paid  ${formatDate(data.paidOn)}`, y)
  y -= 14
  text(`${ORG_EMAIL} · ${ORG_SITE}`, MARGIN, y)
  y -= 34

  // Bill to.
  text('BILLED TO', MARGIN, y, 8, bold, MUTED)
  y -= 14
  text(data.payerName, MARGIN, y, 11, bold, INK)
  y -= 14
  if (data.payerEmail) { text(data.payerEmail, MARGIN, y); y -= 14 }
  if (data.schoolName) { text(data.schoolName, MARGIN, y); y -= 14 }
  y -= 20

  // Lines.
  const colQty = right - 170
  text('DESCRIPTION', MARGIN, y, 8, bold, MUTED)
  text('QTY', colQty, y, 8, bold, MUTED)
  textRight('AMOUNT', y, 8, bold, MUTED)
  y -= 8
  page.drawLine({ start: { x: MARGIN, y }, end: { x: right, y }, thickness: 0.75, color: RULE })
  y -= 16
  for (const line of data.lines) {
    const wrapped = wrap(line.description, regular, 10, colQty - MARGIN - 16)
    text(String(line.quantity), colQty, y)
    textRight(formatMoney(line.amountCents, data.currency), y)
    for (const l of wrapped) { text(l, MARGIN, y, 10, regular, INK); y -= 14 }
    y -= 6
  }
  page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: right, y: y + 4 }, thickness: 0.75, color: RULE })
  y -= 14

  // Totals.
  const totalRow = (label: string, value: string, font: PDFFont = regular, color: RGB = BODY) => {
    text(label, colQty - 60, y, 10, font, color)
    textRight(value, y, 10, font, color)
    y -= 16
  }
  totalRow('Total', formatMoney(data.totalCents, data.currency), bold, INK)
  totalRow('Amount paid', formatMoney(data.totalCents, data.currency))
  if (data.refundedCents > 0) {
    totalRow('Refunded', `-${formatMoney(data.refundedCents, data.currency)}`)
    totalRow('Net paid', formatMoney(data.totalCents - data.refundedCents, data.currency), bold, INK)
  }
  totalRow('Balance due', formatMoney(0, data.currency), bold, PRIMARY)
  y -= 18

  // Payment.
  text('PAYMENT', MARGIN, y, 8, bold, MUTED)
  y -= 14
  text(data.method, MARGIN, y)
  y -= 14
  if (data.reference) { text(`Reference: ${data.reference}`, MARGIN, y, 9, regular, MUTED); y -= 14 }

  // Footer.
  const footer = `Thank you for registering for ${data.eventTitle}. Questions about this payment: ${ORG_EMAIL}.`
  let fy = MARGIN + 24
  for (const l of wrap(footer, regular, 9, w - MARGIN * 2)) { text(l, MARGIN, fy, 9, regular, MUTED); fy -= 12 }

  return doc.save()
}
