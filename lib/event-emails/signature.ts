// The sign-off at the foot of an event email (email plan Workstream G).
//
// Stellr's event mail keeps the signature it has always had (STELLR_SIGNATURE).
// Another tenant's mail signs off as that tenant: the plain-text signature set
// for it in the super-admin console (tenant_email_settings.signature_text), and
// its logo (logo_url) when one is set, or simply its sender name. A tenant's
// mail never carries Stellr's signature.
//
// The console stores text only. The HTML is built here from that text, escaped,
// so nothing typed into the console can add markup, scripts or tracking to an
// email. tenant_email_settings.signature_html is not read.

import { escapeHtml } from '@/lib/email-layout'

export interface EventSignature {
  html: string
  text: string
}

export const STELLR_SIGNATURE: EventSignature = {
  html: `
<p style="margin:24px 0 16px">All the best,</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">
  <tr>
    <td style="padding-right:16px;vertical-align:top;width:175px">
      <a href="https://www.stellreducation.org/"><img src="https://www.stellreducation.org/email/signature-logo.png" alt="Stellr Education — The Engineering Education Community" width="175" height="200" style="width:175px;height:200px;max-width:100%;display:block;border:0" /></a>
    </td>
    <td style="vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:#222222">
      <b>David Shaw</b><br/>
      Chief Inspiration Officer<br/>
      Stellr Education<br/>
      P: <a href="tel:+17026820757" style="color:#1155cc">+1 (702) 682-0757</a><br/>
      E: <a href="mailto:david.shaw@stellreducation.org" style="color:#1155cc">david.shaw@stellreducation.org</a><br/>
      W: <a href="https://www.stellreducation.org/" style="color:#1155cc">www.stellreducation.org</a><br/>
      B: <a href="https://app.usemotion.com/meet/david-m-shaw/check-in" style="color:#1155cc">Schedule A Meeting</a>
    </td>
  </tr>
</table>`,
  text: [
    'All the best,',
    '',
    'David Shaw',
    'Chief Inspiration Officer',
    'Stellr Education',
    'P: +1 (702) 682-0757',
    'E: david.shaw@stellreducation.org',
    'W: www.stellreducation.org',
  ].join('\n'),
}

/** Longest signature the console accepts, in characters. */
export const MAX_SIGNATURE_TEXT = 1000
/** Most lines a signature may have. */
export const MAX_SIGNATURE_LINES = 12

const URL_RE = /\bhttps:\/\/[^\s<>"']+/g

/** A logo URL a signature may show: https, a host, no credentials, at most 500 characters. */
export function safeLogoUrl(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value || value.length > 500) return null
  try {
    const u = new URL(value)
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null
    return u.toString()
  } catch {
    return null
  }
}

/** One line of signature text as HTML: escaped, with https links made clickable. */
function lineHtml(line: string): string {
  let out = ''
  let last = 0
  for (const m of line.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?)]+$/, '')
    const at = m.index ?? 0
    out += escapeHtml(line.slice(last, at))
    out += `<a href="${escapeHtml(url)}" style="color:#1155cc">${escapeHtml(url)}</a>`
    last = at + url.length
  }
  return out + escapeHtml(line.slice(last))
}

/**
 * A tenant's sign-off. The text set in the console, or without one the tenant's
 * sender name, under "All the best,"; the logo beside it when one is set.
 */
export function tenantSignature(input: { name: string; text?: string | null; logoUrl?: string | null }): EventSignature {
  const lines = (input.text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\u0000-\u001f\u007f]/g, '').trimEnd())
    .slice(0, MAX_SIGNATURE_LINES)
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  while (lines.length && !lines[0]) lines.shift()
  const body = lines.length ? lines : [input.name]

  const textBlock = body.map((l) => (l ? lineHtml(l) : '')).join('<br/>')
  const logo = safeLogoUrl(input.logoUrl)
  const cell = `<td style="vertical-align:top;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:#222222">${textBlock}</td>`
  const html = `
<p style="margin:24px 0 16px">All the best,</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">
  <tr>
${logo ? `    <td style="padding-right:16px;vertical-align:top;width:120px"><img src="${escapeHtml(logo)}" alt="${escapeHtml(input.name)}" width="120" style="width:120px;max-width:100%;height:auto;display:block;border:0" /></td>\n` : ''}    ${cell}
  </tr>
</table>`
  return { html, text: ['All the best,', '', ...body].join('\n') }
}
