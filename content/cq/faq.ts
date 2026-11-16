import type { LpFaqItem } from '@/content/lp/types'

/**
 * Teacher questions for the Classroom Qualifier pages. `{{standards}}` is
 * filled from lib/pd-standards.ts (the Educator certificate's wording).
 */
export const CQ_FAQ: LpFaqItem[] = [
  {
    q: 'What does it cost?',
    a: 'The curriculum is free with an Educator account. Paid tiers add more material and PD hours. If your team wins, the International Summer Camp carries a fee.',
  },
  {
    q: 'Do I need an engineering background?',
    a: 'No. The curriculum, guides and rubric walk you through it, and industry professionals do the judging.',
  },
  {
    q: 'Which grades is it for?',
    a: 'Grades 7–12. Teams have 2–12 students.',
  },
  {
    q: 'How long does it take?',
    a: '4–10 weeks. The pack includes a 4-week and a 10-week schedule. Run it in class, after school or as a club.',
  },
  { q: 'Is it standards-aligned?', a: 'Yes. It maps to {{standards}}.' },
  {
    q: 'What do teams submit?',
    a: 'One 10–20 page team proposal, by the deadline for your window.',
  },
  {
    q: 'Which window should we enter?',
    a: 'The 2026–27 window: start anytime and submit by 1/31/27, with feedback and awards by 1/31/27. Spring 2027: opens 1/1/27, submit by 5/14/27, with feedback and awards by 5/31/27.',
  },
  {
    q: 'How is it judged?',
    a: 'Industry professionals score every proposal against three equally weighted criteria, and every team gets written feedback.',
  },
  {
    q: 'Is there a guarantee on paid tiers?',
    a: 'Yes. A 100% money-back guarantee within 45 days.',
  },
]
