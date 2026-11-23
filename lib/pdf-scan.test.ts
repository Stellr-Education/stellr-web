// @vitest-environment node
import { deflateSync } from 'node:zlib'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/pdf-scan.ts at the byte level: the tables and limits it builds when it
// loads, where a stream's data starts, comments in an object-stream header,
// signed and fractional numbers an xref stream loops by, #-escaped names, and
// dictionaries that can't be read backwards. lib/pdf-page-count.test.ts holds
// the whole-file behaviour (pdf-lib parity, bombs, linear time).
//
// The module is loaded afresh before each test: its byte tables and limits
// are built when it loads, and a mutation run (stryker.config.mjs) switches a
// mutant on only after a test file's static imports have run.

type Scan = typeof import('./pdf-scan')
let S: Scan
beforeEach(async () => {
  vi.resetModules()
  S = await import('./pdf-scan')
})

const MB = 1024 * 1024
const enc = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'))
const join = (...parts: (string | Uint8Array)[]) =>
  new Uint8Array(Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p)))))

const HEAD =
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n' +
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 9 9] >>\nendobj\n'
const TAIL = 'trailer\n<< /Root 1 0 R >>\n%%EOF\n'

/** One page, then one object with `dict` and, when given, a stream of `data` after `keyword`. */
function file(dict: string, data?: string | Uint8Array, keyword = 'stream\n'): Uint8Array {
  if (data === undefined) return enc(`${HEAD}4 0 obj\n${dict}\nendobj\n${TAIL}`)
  const bytes = typeof data === 'string' ? Buffer.from(data, 'latin1') : Buffer.from(data)
  return join(`${HEAD}4 0 obj\n${dict.replace('{L}', String(bytes.length))}\n${keyword}`, bytes, `\nendstream\nendobj\n${TAIL}`)
}

describe('limits', () => {
  it('are the documented values', () => {
    expect(S.MAX_OBJECT_STREAMS).toBe(1000)
    expect(S.MAX_FLATE_STREAMS).toBe(20_000)
    expect(S.SNIFF_BUDGET).toBe(32 * MB)
    expect(S.LOAD_INFLATE_BUDGET).toBe(32 * MB)
    expect(S.MAX_INFLATE_RATIO).toBe(200)
    expect(S.INFLATE_RATIO_FLOOR).toBe(MB)
    expect(S.DICT_WINDOW).toBe(16 * 1024)
    expect(S.DICT_READ_BUDGET).toBe(16 * MB)
    expect(S.XREF_ENTRY_LIMIT).toBe(1_000_000)
    expect(S.XREF_WORK_LIMIT).toBe(50_000_000)
    expect(S.NUMBER_ARRAY_BUDGET).toBe(8 * MB)
  })
})

describe('names, objects and whitespace', () => {
  it('counts /Type /Page with whitespace or a delimiter after the name, and every top-level obj', () => {
    for (const page of ['<< /Type /Page >>', '<</Type/Page>>', '<<\t/Type\r\n/Page\f>>', '<< /Type\x00/Page[] >>', '<</Type/Page(x)>>', '<</Type/Page{}>>', '<</Type/Page%c\n>>']) {
      const r = S.scanPdfPages(file(page))
      expect(r, JSON.stringify(page)).toEqual({ bound: 2, objects: 4, markers: 2, inflated: 0 })
    }
  })

  it('a name longer than any it looks for is none of them', () => {
    expect(S.scanPdfPages(file('<< /Type /Pages >>'))?.markers).toBe(1)
    expect(S.scanPdfPages(file('<< /Type /Pagex >>'))?.markers).toBe(1)
  })

  it('reads #-escapes in either case, A to F included', () => {
    for (const objStm of ['/Ob#6AStm', '/Ob#6aStm', '/#4FbjStm', '/#4fbjStm', '/ObjStm']) {
      expect(S.scanPdfPages(file(`<< /Type ${objStm} /Filter /LZWDecode >>`)), objStm).toBeNull()
    }
    expect(S.scanPdfPages(file('<< /Type /ObxStm /Filter /LZWDecode >>'))).not.toBeNull()
    expect(S.scanPdfPages(file('<< /Type /P#61g#65 >>'))?.markers).toBe(2)
    expect(S.scanPdfPages(file('<< /Type /P#41ge >>'))?.markers).toBe(1)
    expect(S.scanPdfPages(file('<< /Type /P#6Ge >>'))?.markers).toBe(1)
  })

  it('refuses each filter it does not read, next to an object stream', () => {
    for (const f of ['LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']) {
      expect(S.scanPdfPages(file(`<< /Type /ObjStm /Filter /${f} >>`)), f).toBeNull()
      expect(S.scanPdfPages(file(`<< /Type /XObject /Filter /${f} >>`)), f).not.toBeNull()
    }
  })

  it('a hidden /Type is a possible reference too', () => {
    expect(S.scanPdfPages(file('<< /Type %c\n/Page /Filter /LZWDecode >>'))).toBeNull()
    expect(S.scanPdfPages(file('<< /Type %c\n/Page >>'))?.markers).toBe(2)
    expect(S.scanPdfPages(file('<< /Type 9 0 R /Filter /LZWDecode >>'))).toBeNull()
    expect(S.scanPdfPages(file('<< /Type +9 0 R /Filter /LZWDecode >>'))).toBeNull()
  })
})

describe('an unfiltered object-stream header', () => {
  it('starts where pdf-lib starts the data, whatever the line ending', () => {
    for (const keyword of ['stream\n', 'stream\r\n', 'stream\r', 'stream \r\n']) {
      expect(S.scanPdfPages(file('<< /Length {L} >>', '3 0 4 5', keyword))?.bound, JSON.stringify(keyword)).toBe(3)
    }
    expect(S.scanPdfPages(file('<< /Length {L} >>', '3 0 4 5 6', 'stream\n'))?.bound).toBe(3)
    expect(S.scanPdfPages(file('<< /Length {L} >>', '3 0 4 5 6 7', 'stream\n'))?.bound).toBe(4)
  })

  it('skips comments between the integers, and stops at the first non-integer', () => {
    expect(S.scanPdfPages(file('<< /Length {L} >>', '3 0 % a note\r4 5 % more\n6 7 x 8 9'))?.bound).toBe(4)
    expect(S.scanPdfPages(file('<< /Length {L} >>', '%only a note'))?.bound).toBe(1)
  })

  it('refuses a header comment holding another stream keyword', () => {
    expect(S.scanPdfPages(file('<< /Length {L} >>', '3 0 %stream\n4 5'))).toBeNull()
  })
})

describe('numbers an xref stream loops by', () => {
  const xref = (dict: string) => file(`<< /Type /XRef ${dict} >>`, '\x01\x00\x00\x00')

  it('/Size: the entry limit, with signs and fractions read as pdf-lib loops', () => {
    expect(S.scanPdfPages(xref('/Size 1000000 /W [1 2 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000001 /W [1 2 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size +1000001 /W [1 2 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size -+1000001 /W [1 2 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size -2000000 /W [1 2 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000000.5 /W [1 2 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000000.05 /W [1 2 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000000.0 /W [1 2 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000000. /W [1 2 1]'))).not.toBeNull()
  })

  it('/Size: a reference or a hidden value is unresolved; a non-number is no loop', () => {
    expect(S.scanPdfPages(xref('/Size 9 0 R /W [1 2 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size %c\n9 /W [1 2 1]'))).toBeNull()
    expect(S.scanPdfPages(xref(`/Size${' '.repeat(40)}9 /W [1 2 1]`))).toBeNull()
    expect(S.scanPdfPages(xref('/Size [256] /W [1 2 1]'))).not.toBeNull()
  })

  it('/W: entries times the first three widths, under the work limit', () => {
    expect(S.scanPdfPages(xref('/Size 30000 /W [1 2 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 30000 /W [1 2000 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000 /W [1 1 1 100000]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 1000 /W [1 1 100000]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size 10 /W [1 %c\n 1 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 10 /W [1 9 0 R 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size 10 /W 9 0 R'))).toBeNull()
    expect(S.scanPdfPages(xref('/Size 10 /W 9 /Index [0 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Size 10 /W [1 /x 1]'))).not.toBeNull()
  })

  it('/Index: every second number is a subsection length', () => {
    expect(S.scanPdfPages(xref('/Index [0 600000 0 600000] /W [1 1 1]'))).toBeNull()
    expect(S.scanPdfPages(xref('/Index [600000 1 600000 1] /W [1 1 1]'))).not.toBeNull()
    expect(S.scanPdfPages(xref('/Index [0 10 R] /W [1 1 1]'))).toBeNull()
  })

  it('only counts them in a file that may hold an xref stream', () => {
    expect(S.scanPdfPages(file('<< /Size 2000000 /W [1 2000 1] >>'))).not.toBeNull()
  })
})

describe('streams pdf-lib may inflate on load', () => {
  // A sniff of it ends at once (no header: `x` can't begin one), so only a
  // stream decoded on load is inflated in full, and that is held to the ratio.
  const blank = deflateSync(Buffer.concat([Buffer.from('x'), Buffer.alloc(4 * MB, 0x20)]))
  const small = deflateSync(Buffer.from('5 0 << /A 1 >> hello', 'latin1'))

  it('a dictionary it can read that says image is left compressed, bomb or not', () => {
    const f = file('<< /Subtype /Image /Filter /FlateDecode /Length {L} >>', blank)
    expect(S.scanPdfPages(f)?.inflated).toBe(0)
    expect(S.checkLoadInflation(f)).toBe(0)
  })

  it('a dictionary a string or a brace hides is inflated as if decoded on load', () => {
    for (const dict of [
      '<< /Subtype /Image /Note (x) /Filter /FlateDecode /Length {L} >>',
      '<< /Subtype /Image /Note {x} /Filter /FlateDecode /Length {L} >>',
      '<< /Subtype /Image /Note } /Filter /FlateDecode /Length {L} >>',
    ]) {
      expect(S.scanPdfPages(file(dict, blank)), dict).toBeNull()
      expect(S.checkLoadInflation(file(dict, blank)), dict).toBeNull()
    }
  })

  it('an honest stream behind a dictionary it cannot read still passes, and is counted as inflated', () => {
    const f = file('<< /Note (x) /Filter /FlateDecode /Length {L} >>', small)
    const r = S.scanPdfPages(f)
    expect(r).not.toBeNull()
    expect(r!.inflated).toBe(20)
    expect(S.checkLoadInflation(f)).toBe(20)
  })

  it('behind an unreadable dictionary, a filter it does not read named earlier is "can’t tell"', () => {
    const f = join(
      HEAD,
      '5 0 obj\n<< /Subtype /Image /Filter /ASCIIHexDecode >>\nendobj\n',
      `4 0 obj\n<< /Note (x) /Filter /FlateDecode /Length ${small.length} >>\nstream\n`,
      small,
      `\nendstream\nendobj\n${TAIL}`,
    )
    expect(S.scanPdfPages(f)).toBeNull()
    expect(S.checkLoadInflation(f)).toBeNull()
  })

  it('an object stream holding page markers counts them as evidence, entries as the bound', () => {
    const body = Buffer.from('3 0 4 20 5 40\n<< /Type /Page >>  << /Type /Page >>   << /Type /Page >>', 'latin1')
    const f = file('<< /Type /ObjStm /N 3 /First 14 /Filter /FlateDecode /Length {L} >>', deflateSync(body))
    const r = S.scanPdfPages(f)!
    expect(r.bound).toBe(1 + 3)
    expect(r.markers).toBe(1 + 3)
    expect(r.inflated).toBe(body.length)
    // Stops reading names once the markers pass the limit.
    expect(S.scanPdfPages(f, 2)!.markers).toBe(3)
  })

  it('reads the dictionary only up to its window', () => {
    // A readable dictionary longer than DICT_WINDOW is "can’t read": inflated as if decoded.
    const long = `<< /Subtype /Image /Pad [${'1 '.repeat(9000)}] /Filter /FlateDecode /Length {L} >>`
    expect(S.scanPdfPages(file(long, blank))).toBeNull()
    const short = `<< /Subtype /Image /Pad [${'1 '.repeat(100)}] /Filter /FlateDecode /Length {L} >>`
    expect(S.scanPdfPages(file(short, blank))?.inflated).toBe(0)
  })
})
