'use client'

import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import {
  CQ_GRADE_LABELS,
  CQ_RESOURCES,
  CQ_SUBJECT_IDEAS,
  CQ_SUBJECT_LABELS,
  type CqGradeBand,
  type CqSubject,
} from '@/content/cq/resources'
import { CQ_THEMES, type CqThemeId } from '@/content/cq/facts'

type Filter<T extends string> = T | 'all'

function FilterGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: Filter<T>
  options: { id: T; label: string }[]
  onChange: (v: Filter<T>) => void
}) {
  const all: { id: Filter<T>; label: string }[] = [{ id: 'all', label: 'All' }, ...options]
  return (
    <fieldset className="min-w-0">
      <legend className="text-ds-meta font-semibold text-content-secondary">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2">
        {all.map((o) => {
          const on = value === o.id
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.id)}
              className={`rounded-pill border px-3 py-1 text-sm font-semibold ${
                on ? 'border-primary bg-primary text-white' : 'border-line bg-white text-ink hover:bg-surface'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

const themeName = (id?: CqThemeId) => CQ_THEMES.find((t) => t.id === id)?.name ?? 'Both themes'

/**
 * The curriculum library (Phase 2): every file in the pack plus the "ideas by
 * subject" blocks, filtered by theme, subject and grade. The files are not
 * linked here: the whole pack comes through the curriculum form and the free
 * Educator account, so every download action goes to #get-curriculum.
 */
export function CurriculumLibrary({ appUrl }: { appUrl: string }) {
  const [theme, setTheme] = useState<Filter<CqThemeId>>('all')
  const [subject, setSubject] = useState<Filter<CqSubject>>('all')
  const [grade, setGrade] = useState<Filter<CqGradeBand>>('all')

  const files = useMemo(
    () => CQ_RESOURCES.filter((r) => theme === 'all' || !r.theme || r.theme === theme),
    [theme],
  )
  const ideas = useMemo(
    () =>
      CQ_SUBJECT_IDEAS.filter(
        (i) =>
          (theme === 'all' || !i.theme || i.theme === theme) &&
          (subject === 'all' || i.subject === subject) &&
          (grade === 'all' || i.grades.includes(grade)),
      ),
    [theme, subject, grade],
  )

  return (
    <div>
      <div className="grid gap-5 rounded-panel border border-line bg-white p-5 md:grid-cols-3">
        <FilterGroup
          label="Theme"
          value={theme}
          options={CQ_THEMES.map((t) => ({ id: t.id, label: t.name }))}
          onChange={setTheme}
        />
        <FilterGroup
          label="Subject"
          value={subject}
          options={(Object.keys(CQ_SUBJECT_LABELS) as CqSubject[]).map((id) => ({ id, label: CQ_SUBJECT_LABELS[id] }))}
          onChange={setSubject}
        />
        <FilterGroup
          label="Grade"
          value={grade}
          options={(Object.keys(CQ_GRADE_LABELS) as CqGradeBand[]).map((id) => ({ id, label: CQ_GRADE_LABELS[id] }))}
          onChange={setGrade}
        />
      </div>

      <h3 className="mt-10 font-display text-2xl font-bold text-ink">The full pack</h3>
      <p className="mt-1 text-ds-body text-content-secondary">
        Every file works for grades 7–12 and every subject. {files.length} of {CQ_RESOURCES.length} shown.
      </p>
      <ul className="mt-5 grid gap-4 md:grid-cols-2" aria-live="polite">
        {files.map((r) => (
          <li key={r.id} id={r.id} className="flex flex-col rounded-ds-card border border-line bg-white p-5">
            <p className="text-ds-meta font-semibold text-content-muted">
              {r.kind} · {themeName(r.theme)}
            </p>
            <p className="mt-1 font-display text-lg font-bold text-ink">{r.title}</p>
            <p className="mt-1 flex-1 text-sm leading-relaxed text-content-secondary">{r.description}</p>
            <a
              href="#get-curriculum"
              className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-sm font-semibold text-primary hover:bg-surface"
            >
              <Download aria-hidden="true" className="h-4 w-4" />
              Download with the full pack
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-ds-meta text-content-secondary">
        Already have an Educator account?{' '}
        <a href={`${appUrl}/campaigns`} className="font-semibold text-primary underline">
          Open the material in the app
        </a>
        .
      </p>

      <h3 id="ideas" className="mt-12 scroll-mt-20 font-display text-2xl font-bold text-ink">
        Ideas by subject
      </h3>
      <p className="mt-1 text-ds-body text-content-secondary">How teachers anchor the proposal in their own course.</p>
      {ideas.length === 0 ? (
        <p className="mt-5 rounded-ds-card border border-line bg-white p-5 text-ds-body text-content-secondary">
          No ideas match these filters yet. Try another subject or grade.
        </p>
      ) : (
        <ul className="mt-5 grid gap-4 md:grid-cols-2" aria-live="polite">
          {ideas.map((i) => (
            <li key={i.heading} className="rounded-ds-card border border-line bg-surface p-5">
              <p className="text-ds-meta font-semibold text-content-muted">
                {i.grades.map((g) => CQ_GRADE_LABELS[g]).join(' · ')} · {themeName(i.theme)}
              </p>
              <p className="mt-1 font-display text-lg font-bold text-ink">{i.heading}</p>
              <p className="mt-1 text-sm leading-relaxed text-content-secondary">{i.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
