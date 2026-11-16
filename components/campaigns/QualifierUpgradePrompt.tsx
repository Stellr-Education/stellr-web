import { Sparkles } from 'lucide-react'
import { Button } from '@stellr/web-ui'
import { cqUpgradeCopy, type CqUpgradeStage } from '@/lib/cq-upgrade-prompt'

/**
 * The contextual Catalyst prompt for a free-tier teacher running the
 * Classroom Qualifier (lib/cq-upgrade-prompt.ts decides the stage). The
 * caller renders it only for members without a paid tier.
 */
export function QualifierUpgradePrompt({
  stage,
  deadlineLabel,
}: {
  stage: CqUpgradeStage
  deadlineLabel?: string | null
}) {
  const copy = cqUpgradeCopy(stage, deadlineLabel)
  return (
    <div
      data-cq-upgrade={stage}
      className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-pathway-amber bg-pathway-amber-bg p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-white text-gold-ink">
          <Sparkles aria-hidden="true" className="h-4 w-4" />
        </span>
        <div>
          <p className="font-heading font-bold text-ink">{copy.heading}</p>
          <p className="mt-1 text-sm text-content-secondary">{copy.body}</p>
        </div>
      </div>
      <Button href="/membership#catalyst" variant="primary">
        Compare Catalyst
      </Button>
    </div>
  )
}
