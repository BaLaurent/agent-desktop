import { render, screen } from '@testing-library/react'
import { CsvPreview } from './CsvPreview'

describe('CsvPreview', () => {
  it('renders the first row as table headers', () => {
    const { container } = render(<CsvPreview content={'name,age\nAlice,30\nBob,25'} />)
    const headerCells = container.querySelectorAll('thead th')
    expect(Array.from(headerCells).map((c) => c.textContent)).toEqual(['name', 'age'])
  })

  it('renders one tbody row per data record', () => {
    const { container } = render(<CsvPreview content={'name,age\nAlice,30\nBob,25'} />)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()
  })

  it('caps rendered rows and shows a truncation banner past the limit', () => {
    const total = 1001
    const dataRows = Array.from({ length: total }, (_, i) => `r${i},${i}`).join('\n')
    const { container } = render(<CsvPreview content={`name,value\n${dataRows}`} />)
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1000)
    expect(container.textContent).toContain('premières lignes sur 1001')
  })

  it('does not show a banner when under the limit', () => {
    const { container } = render(<CsvPreview content={'a,b\n1,2'} />)
    expect(container.textContent).not.toContain('premières lignes')
  })

  it('shows a fallback message for empty content instead of an empty table', () => {
    const { container } = render(<CsvPreview content="" />)
    expect(container.querySelector('table')).toBeNull()
    expect(screen.getByText('Aucune donnée CSV à afficher')).toBeInTheDocument()
  })
})
