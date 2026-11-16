import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PortableText } from 'next-sanity'
import { Button, Hero } from '@stellr/web-ui'
import Link from '@/components/ui/SiteLink'
import { VoiceQuote } from '@/components/lp/sections/Reasons'
import { Section } from '@/components/cq/sections'
import { currentCqWindow } from '@/content/cq/facts'
import { getTeacherStory } from '@/lib/teacher-stories'

export const revalidate = 21600

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const story = await getTeacherStory(slug)
  if (!story) return {}
  return {
    alternates: { canonical: `/classroom-qualifier/stories/${slug}` },
    title: { absolute: `${story.title} | Classroom Qualifier | Stellr` },
    description: story.summary,
  }
}

export default async function TeacherStoryPage({ params }: Props) {
  const { slug } = await params
  const story = await getTeacherStory(slug)
  if (!story) notFound()
  const win = currentCqWindow()
  const byline = [story.teacher, story.role, story.school, story.state].filter(Boolean).join(' · ')
  return (
    <>
      <Hero pill={{ accent: 'Teacher story', rest: 'Classroom Qualifier' }} title={story.title} lead={byline || undefined} />
      <Section labelledBy="story-h">
        <h2 id="story-h" className="sr-only">
          The story
        </h2>
        <div className="max-w-prose">
          <p className="text-lg leading-relaxed text-ink">{story.summary}</p>
          {story.quote && (
            <figure className="m-0 mt-8">
              <VoiceQuote accent={story.theme === 'enviro' ? 'enviro' : 'space'} className="mt-0 px-6 py-6">
                <span className="block font-display text-lg font-medium leading-snug">“{story.quote}”</span>
                {story.teacher && <figcaption className="mt-3 text-ds-meta font-semibold">{story.teacher}</figcaption>}
              </VoiceQuote>
            </figure>
          )}
          {Array.isArray(story.body) && story.body.length > 0 && (
            <div className="prose mt-8 max-w-none text-ink">
              <PortableText value={story.body as never} />
            </div>
          )}
          {story.students && story.students.length > 0 && (
            <p className="mt-8 text-ds-meta text-content-secondary">Team: {story.students.join(', ')}</p>
          )}
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Button href={`/classroom-qualifier#get-curriculum`} as={Link}>
              {win.cta}
            </Button>
            <Link href="/classroom-qualifier/stories" className="font-semibold text-primary underline">
              More teacher stories
            </Link>
          </div>
        </div>
      </Section>
    </>
  )
}
