import { describe, expect, it } from 'vitest'
import { renderEventEmail } from '@/lib/event-emails/render'
import { STELLR_SIGNATURE, safeLogoUrl, tenantSignature } from '@/lib/event-emails/signature'
import { tenantEventSender } from '@/lib/event-emails/tenant-mail'
import { checkSenderFields } from '@/lib/email/tenant-settings'

const email = {
  subject: 'Hello {{first_name}}',
  body_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See you there.' }] }] },
}

describe('event email signature (email plan G)', () => {
  it("keeps Stellr's signature when no signature is passed", () => {
    const out = renderEventEmail(email, { first_name: 'Ada' })
    expect(out.html).toContain(STELLR_SIGNATURE.html)
    expect(out.text.endsWith(`${STELLR_SIGNATURE.text}\n`)).toBe(true)
  })

  it("signs a tenant's email as the tenant, never as Stellr", () => {
    const sig = tenantSignature({ name: 'Riverside Robotics', text: 'Jo Lee\nProgram lead\nhttps://riverside.example.org' })
    const out = renderEventEmail(email, { first_name: 'Ada' }, sig)
    expect(out.html).not.toContain('Chief Inspiration Officer')
    expect(out.text).not.toContain('Stellr')
    expect(out.html).toContain('Jo Lee<br/>Program lead<br/><a href="https://riverside.example.org"')
    expect(out.text).toContain('All the best,\n\nJo Lee\nProgram lead\nhttps://riverside.example.org')
  })

  it('escapes the text, so the console cannot add markup', () => {
    const sig = tenantSignature({ name: 'X', text: '<script>alert(1)</script>\n<a href="javascript:x">hi</a>' })
    expect(sig.html).not.toContain('<script>')
    expect(sig.html).not.toContain('href="javascript')
    expect(sig.html).toContain('&lt;script&gt;')
  })

  it('links only https URLs and leaves trailing punctuation outside the link', () => {
    const sig = tenantSignature({ name: 'X', text: 'Web: https://a.example.org/x. Old: http://b.example.org' })
    expect(sig.html).toContain('<a href="https://a.example.org/x" style="color:#1155cc">https://a.example.org/x</a>.')
    expect(sig.html).not.toContain('href="http://b')
  })

  it('falls back to the sender name and caps the lines', () => {
    expect(tenantSignature({ name: 'Riverside Robotics' }).text).toBe('All the best,\n\nRiverside Robotics')
    const many = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    expect(tenantSignature({ name: 'X', text: many }).text.split('\n')).toHaveLength(2 + 12)
  })

  it('shows a logo only from a plain https URL', () => {
    expect(safeLogoUrl('https://cdn.example.org/logo.png')).toBe('https://cdn.example.org/logo.png')
    for (const bad of ['http://cdn.example.org/l.png', 'javascript:alert(1)', 'https://u:p@x.example.org/l.png', 'data:image/png;base64,AA', '']) {
      expect(safeLogoUrl(bad)).toBeNull()
    }
    expect(tenantSignature({ name: 'X', logoUrl: 'https://cdn.example.org/l.png' }).html).toContain('<img src="https://cdn.example.org/l.png" alt="X"')
    expect(tenantSignature({ name: 'X', logoUrl: 'javascript:alert(1)' }).html).not.toContain('<img')
  })

  it("puts the tenant's signature on its sender, own domain or via Stellr", () => {
    const base = { sending_domain: null, domain_status: 'none', from_local_part: 'events', from_name: null, reply_to: 'office@riverside.example.org' }
    const via = tenantEventSender({ display_name: 'Riverside Robotics', branding: {}, tenant_email_settings: { ...base, signature_text: 'Jo Lee' } })
    expect(via?.from).toContain('via Stellr')
    expect(via?.signature?.text).toBe('All the best,\n\nJo Lee')
    const own = tenantEventSender({
      display_name: 'Riverside Robotics',
      branding: {},
      tenant_email_settings: { ...base, sending_domain: 'mail.riverside.example.org', domain_status: 'verified', from_name: 'Riverside' },
    })
    expect(own?.from).toBe('"Riverside" <events@mail.riverside.example.org>')
    expect(own?.signature?.text).toBe('All the best,\n\nRiverside')
  })

  it('validates the console fields', () => {
    expect(checkSenderFields({ signature_text: 'Jo\nLead', logo_url: 'https://cdn.example.org/l.png' })).toEqual({
      ok: true,
      value: { signature_text: 'Jo\nLead', logo_url: 'https://cdn.example.org/l.png' },
    })
    expect(checkSenderFields({ signature_text: '', logo_url: null })).toEqual({ ok: true, value: { signature_text: null, logo_url: null } })
    expect(checkSenderFields({ logo_url: 'http://x.example.org/l.png' }).ok).toBe(false)
    expect(checkSenderFields({ signature_text: 'x'.repeat(1001) }).ok).toBe(false)
    expect(checkSenderFields({ signature_text: Array(13).fill('a').join('\n') }).ok).toBe(false)
    expect(checkSenderFields({ signature_text: 5 }).ok).toBe(false)
  })
})
