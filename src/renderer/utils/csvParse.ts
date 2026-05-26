// Minimal RFC 4180 CSV/TSV parser — zero dependencies.
// Handles quoted fields, embedded delimiters/newlines, and "" escaped quotes.

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const

/** Pick the most frequent delimiter (`,` `;` tab) in the first record, ignoring quoted regions. */
export function sniffDelimiter(sample: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (let i = 0; i < sample.length; i++) {
    const ch = sample[i]
    if (ch === '"') {
      if (inQuotes && sample[i + 1] === '"') { i++; continue } // escaped quote
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (ch === '\n') break // end of first record
    if (ch === ',' || ch === ';' || ch === '\t') counts[ch]++
  }
  let best: string = ','
  let bestCount = -1
  for (const d of CANDIDATE_DELIMITERS) {
    if (counts[d] > bestCount) { bestCount = counts[d]; best = d }
  }
  return best
}

/** Tokenize CSV text into records with a state machine; blank lines are skipped. */
function tokenize(text: string, delimiter: string): string[][] {
  const records: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false

  const flushRow = () => {
    // Skip fully-empty lines (no field accumulated, no prior cells on this row).
    if (field !== '' || row.length > 0) {
      row.push(field)
      records.push(row)
    }
    field = ''
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; continue } // escaped quote
        inQuotes = false
        continue
      }
      field += ch
      continue
    }
    if (ch === '"') { inQuotes = true; continue }
    if (ch === delimiter) { row.push(field); field = ''; continue }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; flushRow(); continue }
    if (ch === '\n') { flushRow(); continue }
    field += ch
  }
  flushRow() // trailing record without a final newline
  return records
}

/** Parse CSV/TSV text. First record becomes the header row. */
export function parseCsv(raw: string): ParsedCsv {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw // strip UTF-8 BOM
  const delimiter = sniffDelimiter(text)
  const records = tokenize(text, delimiter)
  if (records.length === 0) return { headers: [], rows: [] }
  const [headers, ...rows] = records
  return { headers, rows }
}
