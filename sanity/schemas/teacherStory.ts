// Classroom Qualifier teacher stories (handover Phase 2: 2–3 story pages).
//
// Stories name real teachers and students, and this repo is public, so the
// content lives here in Sanity and nowhere in code. A story renders on
// /classroom-qualifier/stories only once "Cleared to publish" is ticked:
// the teacher's testimonial release is on file and, for every student named,
// the family's media consent.

const required = (Rule: { required: () => unknown }) => Rule.required()

export const teacherStory = {
  name: 'teacherStory',
  title: 'Teacher Story (Classroom Qualifier)',
  type: 'document',
  fields: [
    { name: 'title', type: 'string', title: 'Headline', validation: required },
    {
      name: 'slug',
      type: 'slug',
      title: 'URL slug',
      description: 'Use the school or state, never a student’s name (e.g. "denver-physics-class").',
      options: { source: 'title', maxLength: 80 },
      validation: required,
    },
    { name: 'teacher', type: 'string', title: 'Teacher (as cleared, e.g. "Ms. Rivera")' },
    { name: 'role', type: 'string', title: 'Role line (e.g. "Physics teacher, grades 9–12")' },
    { name: 'school', type: 'string', title: 'School' },
    { name: 'state', type: 'string', title: 'State (e.g. CO, NV)' },
    {
      name: 'theme',
      type: 'string',
      title: 'Theme',
      options: { list: [{ title: 'Space Mission Design', value: 'space' }, { title: 'Environmental Design', value: 'enviro' }] },
    },
    { name: 'summary', type: 'text', rows: 3, title: 'Summary (one or two sentences, shown on the list)', validation: required },
    { name: 'quote', type: 'text', rows: 3, title: 'Pull quote (verbatim, cleared)' },
    { name: 'body', type: 'array', title: 'Story', of: [{ type: 'block' }] },
    {
      name: 'students',
      type: 'array',
      title: 'Students named (2027 CO/NV cohorts)',
      description: 'Only students whose families gave media consent. First name and last initial.',
      of: [{ type: 'string' }],
    },
    { name: 'photo', type: 'image', title: 'Photo', options: { hotspot: true } },
    {
      name: 'cleared',
      type: 'boolean',
      title: 'Cleared to publish',
      description: 'Tick only when the testimonial release and every named student’s media consent are on file.',
      initialValue: false,
    },
  ],
  preview: { select: { title: 'title', subtitle: 'state' } },
}
