import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/SiteLink'
import { Hero } from '@stellr/web-ui'
import { Section } from '@/components/cq/sections'
import { getTeacherStories } from '@/lib/teacher-stories'

export const metadata: Metadata = {
  alternates: { canonical: '/classroom-qualifier/stories' },
  title: { absolute: 'Classroom Qualifier Teacher Stories | Stellr' },
  description: 'How teachers ran the Classroom Qualifier, a free engineering curriculum for grades 7–12, in their classrooms.',
}

export const revalidate = 21600

export default async function TeacherStoriesPage() {
  const stories = await getTeacherStories()
  // Nothing cleared yet: no page, rather than an empty one.
  if (stories.length === 0) notFound()
  return (
    <>
      <Hero pill={{ accent: 'Classroom Qualifier', rest: 'Teacher stories' }} title="How teachers run it" />
      <Section labelledBy="stories-h">
        <h2 id="stories-h" className="sr-only">
          Stories
        </h2>
        <ul className="grid gap-5 md:grid-cols-2">
          {stories.map((s) => (
            <li key={s.slug}>
              <Link
                href={`/classroom-qualifier/stories/${s.slug}`}
                className="block h-full rounded-ds-card border border-line bg-white p-6 hover:shadow-card-lift"
              >
                <p className="text-ds-meta font-semibold text-content-muted">
                  {[s.role, s.state].filter(Boolean).join(' · ')}
                </p>
                <p className="mt-1 font-display text-xl font-bold text-ink">{s.title}</p>
                <p className="mt-2 text-ds-body text-content-secondary">{s.summary}</p>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/classroom-qualifier" className="mt-8 inline-block font-semibold text-primary underline">
          Back to the Classroom Qualifier
        </Link>
      </Section>
    </>
  )
}
