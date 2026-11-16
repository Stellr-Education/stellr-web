import { NextResponse } from 'next/server'
import { supabaseServer } from '@/lib/supabase'
import { acceptUpload, MAX_UPLOAD_BYTES } from '@/lib/esign/native/template-admin'
import { adminName, failure, forbidden, noStore } from '../guard'
import { withAudit } from '@/lib/audit/route'
import { adminAuditSubject, noteAuditSubject } from '@/lib/audit/route-subject'

// POST /api/admin/esign/templates/upload — a new agreement PDF for the field
// editor (multipart, field "file"). Checked by its bytes and rebuilt clean;
// the answer names the cleaned draft the editor works on.

export const maxDuration = 60

// Platform audit (docs/TENANCY-S5.md, C7): a draft PDF stored for the editor. Its hash
// and page count are the metadata; the storage path is not.
export const POST = withAudit(
  ({ args: [req] }: { args: [Request] }) => ({ action: 'esign.template.upload', ...adminAuditSubject(req, 'esign_templates') }),
  upload,
)

async function upload(req: Request) {
  if (!(await adminName())) return forbidden()
  if (Number(req.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES + 64_000) {
    return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 413, headers: noStore })
  }
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a PDF to upload.' }, { status: 400, headers: noStore })
  try {
    const out = await acceptUpload(supabaseServer(), new Uint8Array(await file.arrayBuffer()))
    noteAuditSubject(req, { detail: { sha256: out.sha256, page_count: out.pageCount } })
    return NextResponse.json(out, { headers: noStore })
  } catch (err) {
    return failure(err)
  }
}
