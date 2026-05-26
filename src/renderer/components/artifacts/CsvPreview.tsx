import { useMemo } from 'react'
import { parseCsv } from '../../utils/csvParse'

const MAX_PREVIEW_ROWS = 1000

interface CsvPreviewProps {
  content: string
}

export function CsvPreview({ content }: CsvPreviewProps) {
  const { headers, rows } = useMemo(() => parseCsv(content), [content])

  if (headers.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-muted">
        Aucune donnée CSV à afficher
      </div>
    )
  }

  const visibleRows = rows.slice(0, MAX_PREVIEW_ROWS)
  const truncated = rows.length > MAX_PREVIEW_ROWS

  return (
    <div className="h-full w-full overflow-auto p-4">
      {truncated && (
        <div className="text-xs text-muted mb-2">
          Affichage des {MAX_PREVIEW_ROWS} premières lignes sur {rows.length}
        </div>
      )}
      <table className="w-full text-sm border-collapse" style={{ borderColor: 'var(--color-text-muted)' }}>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th
                key={i}
                className="text-left px-3 py-2 font-semibold border-b whitespace-nowrap"
                style={{ borderColor: 'var(--color-text-muted)', backgroundColor: 'var(--color-surface)' }}
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, r) => (
            <tr key={r}>
              {headers.map((_, c) => (
                <td key={c} className="px-3 py-2 border-b align-top" style={{ borderColor: 'var(--color-surface)' }}>
                  {row[c] ?? ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
