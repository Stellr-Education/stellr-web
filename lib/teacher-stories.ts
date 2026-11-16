import { client, PUBLISHED_CACHE } from '@/lib/sanity'

/**
 * Classroom Qualifier teacher stories, from Sanity (sanity/schemas/teacherStory.ts).
 * Only stories ticked "Cleared to publish" ever leave Sanity: the filter is in
 * the query, so an uncleared draft cannot reach a page, a sitemap or a link.
 */

export interface TeacherStorySummary {
  slug: string
  title: string
  teacher?: string | null
  role?: string | null
  school?: string | null
  state?: string | null
  theme?: 'space' | 'enviro' | null
  summary: string
}

export interface TeacherStory extends TeacherStorySummary {
  quote?: string | null
  body?: unknown[] | null
  students?: string[] | null
}

const CLEARED = '_type == "teacherStory" && cleared == true && defined(slug.current)'
const SUMMARY = '"slug": slug.current, title, teacher, role, school, state, theme, summary'

export async function getTeacherStories(): Promise<TeacherStorySummary[]> {
  if (!client) return []
  const rows = await client
    .fetch<TeacherStorySummary[] | null>(`*[${CLEARED}] | order(_createdAt asc) { ${SUMMARY} }`, {}, PUBLISHED_CACHE)
    .catch(() => null)
  return rows ?? []
}

export async function getTeacherStory(slug: string): Promise<TeacherStory | null> {
  if (!client) return null
  return client
    .fetch<TeacherStory | null>(
      `*[${CLEARED} && slug.current == $slug][0] { ${SUMMARY}, quote, body, students }`,
      { slug },
      PUBLISHED_CACHE,
    )
    .catch(() => null)
}
