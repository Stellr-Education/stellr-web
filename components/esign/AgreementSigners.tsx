import { SignerStatusList, type SignerStatusItem } from '@stellr/web-ui'
import { formatDateShort } from '@/lib/utils'
import type { SignerSummary } from '@/lib/docusign-status'

// The per-signer status lines for one agreement (lib/docusign-status decides
// the tone and words; this only adds the signed date and renders the list).
export function AgreementSigners({
  signers,
  showNames = false,
  className,
}: {
  signers: SignerSummary[]
  /** Off where the surrounding card already names each signer. */
  showNames?: boolean
  className?: string
}) {
  const items: SignerStatusItem[] = signers.map((s, i) => ({
    id: `${i}-${s.role}`,
    role: s.role,
    name: showNames ? s.name : undefined,
    tone: s.tone,
    status: s.tone === 'done' && s.signedAt ? `Signed ${formatDateShort(s.signedAt)}` : s.status,
  }))
  return <SignerStatusList signers={items} className={className} />
}
