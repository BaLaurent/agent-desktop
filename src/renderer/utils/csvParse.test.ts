import { parseCsv, sniffDelimiter } from './csvParse'

describe('parseCsv', () => {
  it('uses the first record as headers and the rest as rows', () => {
    const { headers, rows } = parseCsv('name,age\nAlice,30\nBob,25')
    expect(headers).toEqual(['name', 'age'])
    expect(rows).toEqual([['Alice', '30'], ['Bob', '25']])
  })

  it('keeps commas inside quoted fields', () => {
    const { rows } = parseCsv('a,b,c\nx,"b,c",d')
    expect(rows[0]).toEqual(['x', 'b,c', 'd'])
  })

  it('keeps embedded newlines inside quoted fields', () => {
    const { headers, rows } = parseCsv('h1,h2\nx,"line1\nline2"')
    expect(headers).toEqual(['h1', 'h2'])
    expect(rows).toEqual([['x', 'line1\nline2']])
  })

  it('unescapes doubled quotes', () => {
    const { rows } = parseCsv('h\n"a""b"')
    expect(rows[0]).toEqual(['a"b'])
  })

  it('preserves a trailing empty field', () => {
    const { rows } = parseCsv('a,b\n1,')
    expect(rows[0]).toEqual(['1', ''])
  })

  it('ignores a trailing newline and blank lines', () => {
    const { rows } = parseCsv('a,b\n1,2\n\n')
    expect(rows).toEqual([['1', '2']])
  })

  it('handles CRLF line endings', () => {
    const { headers, rows } = parseCsv('a,b\r\n1,2')
    expect(headers).toEqual(['a', 'b'])
    expect(rows).toEqual([['1', '2']])
  })

  it('strips a leading UTF-8 BOM from the first header', () => {
    const { headers } = parseCsv('﻿name,age\nAlice,30')
    expect(headers[0]).toBe('name')
  })

  it('returns empty headers/rows for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('sniffDelimiter', () => {
  it('detects semicolons (European CSV)', () => {
    expect(sniffDelimiter('a;b;c')).toBe(';')
  })

  it('detects tabs (TSV)', () => {
    expect(sniffDelimiter('a\tb\tc')).toBe('\t')
  })

  it('defaults to comma', () => {
    expect(sniffDelimiter('a,b,c')).toBe(',')
  })

  it('ignores delimiters inside quotes when sniffing', () => {
    // Only the unquoted comma should count; the semicolons are inside quotes.
    expect(sniffDelimiter('"a;b;c",d')).toBe(',')
  })

  it('only inspects the first record', () => {
    expect(sniffDelimiter('a,b\n1;2;3;4')).toBe(',')
  })
})
