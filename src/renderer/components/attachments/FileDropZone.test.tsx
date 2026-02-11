import { render, screen } from '@testing-library/react'
import { FileDropZone } from './FileDropZone'

describe('FileDropZone', () => {
  it('renders children', () => {
    render(
      <FileDropZone onFilesDropped={vi.fn()}>
        <span>child content</span>
      </FileDropZone>
    )
    expect(screen.getByText('child content')).toBeInTheDocument()
  })

  it('wrapper has flex layout classes for proper sizing', () => {
    const { container } = render(
      <FileDropZone onFilesDropped={vi.fn()}>
        <div>inner</div>
      </FileDropZone>
    )
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('flex-1')
    expect(wrapper.className).toContain('flex-col')
    expect(wrapper.className).toContain('overflow-hidden')
  })
})
