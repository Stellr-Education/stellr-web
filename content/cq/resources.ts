import type { CqThemeId } from './facts'

/**
 * The Classroom Qualifier curriculum library (handover §3.3 and Phase 2).
 *
 * The files themselves live in the member app, behind a free Educator
 * account; this catalogue describes them for the public library page. The
 * whole pack is gated behind the curriculum request form (the handover's
 * default), so no entry carries a file URL.
 *
 * Filters (Phase 2): theme, subject, grade band. Every file serves grades
 * 7–12 and every subject; the subject-specific material is the "ideas by
 * subject" blocks below, which the same filters narrow.
 */

export type CqSubject = 'physics' | 'biology' | 'earth-science' | 'math' | 'cte'
export type CqGradeBand = '7-8' | '9-12'
export type CqResourceKind = 'Brief' | 'Handbook' | 'Schedule' | 'Guide' | 'Rubric' | 'Deck'

export const CQ_SUBJECT_LABELS: Record<CqSubject, string> = {
  physics: 'Physics',
  biology: 'Biology',
  'earth-science': 'Earth science',
  math: 'Math',
  cte: 'CTE',
}

export const CQ_GRADE_LABELS: Record<CqGradeBand, string> = {
  '7-8': 'Grades 7–8',
  '9-12': 'Grades 9–12',
}

export interface CqResource {
  id: string
  title: string
  kind: CqResourceKind
  description: string
  /** Both themes when omitted. */
  theme?: CqThemeId
}

export const CQ_RESOURCES: CqResource[] = [
  {
    id: 'rfp',
    title: 'Request for Proposal (RFP)',
    kind: 'Brief',
    description: 'The client’s brief your teams answer: the mission, the constraints and what the proposal must cover.',
  },
  {
    id: 'handbook-space',
    title: 'Mission Handbook: Space Mission Design',
    kind: 'Handbook',
    theme: 'space',
    description: 'The background science and engineering for a settlement beyond Earth, written for students.',
  },
  {
    id: 'handbook-enviro',
    title: 'Mission Handbook: Environmental Design',
    kind: 'Handbook',
    theme: 'enviro',
    description: 'The background science and engineering for real-world environmental problems, written for students.',
  },
  {
    id: 'schedule-4',
    title: '4-week schedule',
    kind: 'Schedule',
    description: 'An indicative plan for running the curriculum in four weeks of class time.',
  },
  {
    id: 'schedule-10',
    title: '10-week schedule',
    kind: 'Schedule',
    description: 'An indicative plan for a fuller ten-week run, in class, after school or as a club.',
  },
  {
    id: 'pacing',
    title: 'Pacing guide',
    kind: 'Guide',
    description: 'Where each part of the proposal fits in your calendar, so teams reach the deadline with time to spare.',
  },
  {
    id: 'teacher-guide',
    title: 'Teacher Guide',
    kind: 'Guide',
    description: 'How to run it, step by step, for teachers who are not engineers.',
  },
  {
    id: 'student-guide',
    title: 'Student Guide',
    kind: 'Guide',
    description: 'What teams do, in order, and how to write a 10–20 page proposal.',
  },
  {
    id: 'rubric',
    title: 'Judging Rubric',
    kind: 'Rubric',
    description: 'The three equally weighted criteria industry judges use. Share it with teams on day one.',
  },
  {
    id: 'deck',
    title: 'Overview deck',
    kind: 'Deck',
    description: 'A short deck to introduce the Classroom Qualifier to your class, department or principal.',
  },
]

export interface CqSubjectIdea {
  subject: CqSubject
  grades: CqGradeBand[]
  theme?: CqThemeId
  heading: string
  body: string
}

/**
 * "Ideas by subject" (Phase 2). How a teacher of each subject can anchor the
 * proposal in their own course. Teaching suggestions, not claims: no numbers,
 * no standards beyond the certificate's.
 */
export const CQ_SUBJECT_IDEAS: CqSubjectIdea[] = [
  {
    subject: 'physics',
    grades: ['9-12'],
    theme: 'space',
    heading: 'Physics: forces, energy and motion',
    body: 'Have teams justify their launch, landing and power choices with the physics they are studying: forces, energy transfer and orbits.',
  },
  {
    subject: 'physics',
    grades: ['7-8'],
    heading: 'Physical science: energy in the design',
    body: 'Ask teams to trace where their design gets its energy and where it loses it, and to compare two power options.',
  },
  {
    subject: 'biology',
    grades: ['7-8', '9-12'],
    heading: 'Biology: keeping people alive',
    body: 'Life support, food and waste become the core of the proposal: what living things need, and how the design provides it.',
  },
  {
    subject: 'earth-science',
    grades: ['7-8', '9-12'],
    theme: 'enviro',
    heading: 'Earth science: systems under pressure',
    body: 'Teams pick a real environmental problem, map the Earth systems involved and design a response they can defend.',
  },
  {
    subject: 'earth-science',
    grades: ['7-8', '9-12'],
    theme: 'space',
    heading: 'Earth and space science: choosing a site',
    body: 'Compare candidate locations by gravity, atmosphere, temperature and resources, and argue for one.',
  },
  {
    subject: 'math',
    grades: ['7-8', '9-12'],
    heading: 'Math: budgets, scale and data',
    body: 'Every proposal needs numbers: a budget, a scaled layout and the data behind each claim. Grade the math as its own section.',
  },
  {
    subject: 'cte',
    grades: ['9-12'],
    heading: 'CTE: working to a client brief',
    body: 'Run it as a real engineering bid: roles, a schedule, a client brief and a proposal judged by industry professionals.',
  },
]
