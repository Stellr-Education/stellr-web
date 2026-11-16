import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SpamGuardFields } from './SpamGuardFields'
import { useSpamGuard } from './useSpamGuard'
import { MIN_DWELL_MS } from '@/lib/spam-guard'

function Harness({ onValues }: { onValues: (v: unknown) => void }) {
  const spam = useSpamGuard()
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault()
        onValues(await spam.values())
      }}
    >
      <label htmlFor="email">Email</label>
      <input id="email" type="email" />
      <SpamGuardFields {...spam.fields} />
      <button type="submit">Send</button>
    </form>
  )
}

// performance is faked too: the hook measures the dwell on the monotonic clock.
const fakeClocks = () =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] })

afterEach(() => vi.useRealTimers())

describe('SpamGuardFields', () => {
  it('is not announced: no textbox in the accessibility tree but the real one', () => {
    render(<Harness onValues={() => {}} />)
    const boxes = screen.getAllByRole('textbox')
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toHaveAccessibleName('Email')
    expect(screen.queryByRole('textbox', { name: /website/i })).toBeNull()
  })

  it('is not focusable by keyboard and never autofilled', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness onValues={() => {}} />)
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!
    expect(trap).toHaveAttribute('tabindex', '-1')
    expect(trap).toHaveAttribute('autocomplete', 'off')
    expect(trap).toHaveAttribute('aria-hidden', 'true')
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull()

    // Tab goes from the email field straight to the button.
    await user.tab()
    expect(screen.getByRole('textbox')).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus()
    expect(trap).not.toHaveFocus()
  })

  // Better bots skip display:none and `hidden` fields because they read as traps.
  it('is hidden off-screen, not with display:none or hidden', () => {
    const { container } = render(<Harness onValues={() => {}} />)
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!
    const wrapper = trap.parentElement!
    expect(wrapper.className).toContain('absolute')
    expect(wrapper.className).toContain('left-[-9999px]')
    expect(wrapper).not.toHaveAttribute('hidden')
    expect(trap).not.toHaveAttribute('hidden')
    expect(trap.type).toBe('text')
    expect(wrapper.style.display).not.toBe('none')
  })
})

describe('useSpamGuard', () => {
  it('reports what a bot typed into the trap, read from the DOM', async () => {
    let got: { website?: string } | undefined
    const { container } = render(<Harness onValues={(v) => (got = v as typeof got)} />)
    const trap = container.querySelector<HTMLInputElement>('input[name="website"]')!
    // A bot that sets .value directly fires no React change event.
    trap.value = 'https://spam.example'
    await act(async () => {
      fireEvent.submit(trap.form!)
    })
    expect(got!.website).toBe('https://spam.example')
  })

  it('sends the mount time and the submit time on the same clock', async () => {
    fakeClocks()
    const { result } = renderHook(() => useSpamGuard())
    await vi.advanceTimersByTimeAsync(12_000)
    const v = await result.current.values()
    expect(v.website).toBe('')
    expect(v.renderedAt).toEqual(expect.any(Number))
    expect(v.submittedAt! - v.renderedAt!).toBe(12_000)
  })

  // The trap is the server's call: a fast submission goes out as it is.
  it('does not hold back a fast submission', async () => {
    fakeClocks()
    const { result } = renderHook(() => useSpamGuard())
    const v = await result.current.values()
    expect(v.submittedAt! - v.renderedAt!).toBeLessThan(MIN_DWELL_MS)
  })

  it('sends no timing for a tab left open past the ceiling', async () => {
    fakeClocks()
    const { result } = renderHook(() => useSpamGuard())
    await vi.advanceTimersByTimeAsync(7 * 60 * 60 * 1000)
    const v = await result.current.values()
    expect(v).toEqual({ website: '' })
  })
})
