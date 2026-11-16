import type { Metadata } from 'next'
import { WindowPage } from '@/components/cq/WindowPage'

export const metadata: Metadata = {
  alternates: { canonical: '/classroom-qualifier/spring-2027' },
  title: { absolute: 'Classroom Qualifier Spring 2027: Submit by 5/14/27 | Stellr' },
  description:
    'The Spring 2027 Classroom Qualifier: a free engineering curriculum for grades 7–12. Opens 1/1/27; ' +
    'submit a 10–20 page team proposal by 5/14/27, with feedback and awards by 5/31/27.',
}

export const revalidate = 21600

export default function Page() {
  return <WindowPage id="spring-2027" />
}
