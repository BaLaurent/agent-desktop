import { render, screen, fireEvent } from '@testing-library/react'
import { ContextMenu, ContextMenuItem, ContextMenuDivider } from './ContextMenu'

describe('ContextMenu', () => {
  it('renders children at specified position', () => {
    render(
      <ContextMenu position={{ x: 100, y: 200 }} onClose={vi.fn()}>
        <div>Menu content</div>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    expect(menu).toBeInTheDocument()
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('200px')
    expect(screen.getByText('Menu content')).toBeInTheDocument()
  })

  it('applies surface/border/text styles', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <div>content</div>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    expect(menu.style.backgroundColor).toBe('var(--color-surface)')
    expect(menu.style.border).toBe('1px solid var(--color-bg)')
    expect(menu.style.color).toBe('var(--color-text)')
  })

  it('passes className and style props', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()} className="min-w-[200px]" style={{ width: 300 }}>
        <div>content</div>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    expect(menu.className).toContain('min-w-[200px]')
    expect(menu.style.width).toBe('300px')
  })

  it('passes role and aria-label', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()} role="listbox" aria-label="Test menu">
        <div>content</div>
      </ContextMenu>
    )
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByLabelText('Test menu')).toBeInTheDocument()
  })

  it('calls onClose on click outside', () => {
    const onClose = vi.fn()
    render(
      <div>
        <div data-testid="outside">outside</div>
        <ContextMenu position={{ x: 0, y: 0 }} onClose={onClose}>
          <div>inside</div>
        </ContextMenu>
      </div>
    )
    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose on click inside', () => {
    const onClose = vi.fn()
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={onClose}>
        <div data-testid="inside">inside</div>
      </ContextMenu>
    )
    fireEvent.mouseDown(screen.getByTestId('inside'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('shows drag handle by default', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <div>content</div>
      </ContextMenu>
    )
    expect(screen.getByTestId('drag-handle')).toBeInTheDocument()
  })

  it('hides drag handle when draggable is false', () => {
    render(
      <ContextMenu draggable={false} position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <div>content</div>
      </ContextMenu>
    )
    expect(screen.queryByTestId('drag-handle')).not.toBeInTheDocument()
  })

  it('focuses first menuitem on mount', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <ContextMenuItem onClick={vi.fn()}>First</ContextMenuItem>
        <ContextMenuItem onClick={vi.fn()}>Second</ContextMenuItem>
      </ContextMenu>
    )
    const items = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(items[0])
  })

  it('moves focus down with ArrowDown and wraps around', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <ContextMenuItem onClick={vi.fn()}>First</ContextMenuItem>
        <ContextMenuItem onClick={vi.fn()}>Second</ContextMenuItem>
        <ContextMenuItem onClick={vi.fn()}>Third</ContextMenuItem>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[2])

    // wraps to first
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
  })

  it('moves focus up with ArrowUp and wraps around', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <ContextMenuItem onClick={vi.fn()}>First</ContextMenuItem>
        <ContextMenuItem onClick={vi.fn()}>Second</ContextMenuItem>
        <ContextMenuItem onClick={vi.fn()}>Third</ContextMenuItem>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')

    // from first, ArrowUp wraps to last
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[2])

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items[1])
  })

  it('navigates to item then activates it via click (Enter triggers click natively)', () => {
    const onClick = vi.fn()
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <ContextMenuItem onClick={vi.fn()}>First</ContextMenuItem>
        <ContextMenuItem onClick={onClick}>Second</ContextMenuItem>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')

    // ArrowDown moves focus to second item
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])

    // click on focused item (native Enter→click behavior not simulated in jsdom)
    fireEvent.click(items[1])
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('skips dividers during keyboard navigation', () => {
    render(
      <ContextMenu position={{ x: 0, y: 0 }} onClose={vi.fn()}>
        <ContextMenuItem onClick={vi.fn()}>First</ContextMenuItem>
        <ContextMenuDivider />
        <ContextMenuItem onClick={vi.fn()}>Second</ContextMenuItem>
      </ContextMenu>
    )
    const menu = screen.getByRole('menu')
    const items = screen.getAllByRole('menuitem')

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
  })

  it('moves menu on drag', () => {
    render(
      <ContextMenu position={{ x: 100, y: 100 }} onClose={vi.fn()}>
        <div>content</div>
      </ContextMenu>
    )
    const handle = screen.getByTestId('drag-handle')
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 })
    fireEvent.pointerMove(document, { clientX: 150, clientY: 120 })
    fireEvent.pointerUp(document)

    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('150px')
    expect(menu.style.top).toBe('120px')
  })
})

describe('ContextMenuItem', () => {
  it('renders a button with correct classes', () => {
    render(<ContextMenuItem onClick={vi.fn()}>Click me</ContextMenuItem>)
    const btn = screen.getByRole('menuitem')
    expect(btn.tagName).toBe('BUTTON')
    expect(btn.className).toContain('w-full')
    expect(btn.className).toContain('text-left')
    expect(btn.className).toContain('px-3')
    expect(btn.className).toContain('py-1.5')
    expect(btn.style.backgroundColor).toBe('transparent')
    expect(btn).toHaveTextContent('Click me')
  })

  it('calls onClick when clicked', () => {
    const onClick = vi.fn()
    render(<ContextMenuItem onClick={onClick}>Click</ContextMenuItem>)
    fireEvent.click(screen.getByRole('menuitem'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('applies error color when danger is true', () => {
    render(<ContextMenuItem onClick={vi.fn()} danger>Delete</ContextMenuItem>)
    const btn = screen.getByRole('menuitem')
    expect(btn.style.color).toBe('var(--color-error)')
  })

  it('does not apply error color when danger is false', () => {
    render(<ContextMenuItem onClick={vi.fn()}>Normal</ContextMenuItem>)
    const btn = screen.getByRole('menuitem')
    expect(btn.style.color).toBe('')
  })

  it('passes className and aria-label', () => {
    render(
      <ContextMenuItem onClick={vi.fn()} className="extra" aria-label="My action">
        Action
      </ContextMenuItem>
    )
    const btn = screen.getByRole('menuitem')
    expect(btn.className).toContain('extra')
    expect(btn).toHaveAttribute('aria-label', 'My action')
  })
})

describe('ContextMenuDivider', () => {
  it('renders a divider with border styles', () => {
    const { container } = render(<ContextMenuDivider />)
    const divider = container.firstChild as HTMLElement
    expect(divider.className).toContain('border-t')
    expect(divider.className).toContain('my-1')
    expect(divider.style.borderColor).toBe('var(--color-bg)')
  })
})
