import type { Metadata } from 'next'
import { WindowPage } from '@/components/cq/WindowPage'

export const metadata: Metadata = {
  alternates: { canonical: '/classroom-qualifier/2026-27' },
  title: { absolute: 'Classroom Qualifier 2026–27: Submit by 1/31/27 | Stellr' },
  description:
    'The 2026–27 Classroom Qualifier: a free engineering curriculum for grades 7–12. Start anytime, ' +
    'submit a 10–20 page team proposal by 1/31/27, and get written feedback from industry judges.',
}

export const revalidate = 21600

export default function Page() {
  return <WindowPage id="2026-27" />
}
