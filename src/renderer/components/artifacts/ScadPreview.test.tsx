import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ScadPreview } from './ScadPreview'

// Mock @react-three/fiber and @react-three/drei
vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => <div data-testid="canvas">{children}</div>,
  useThree: () => ({
    camera: { position: { set: vi.fn() }, lookAt: vi.fn(), updateProjectionMatrix: vi.fn() },
  }),
}))

vi.mock('@react-three/drei', () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
}))

// Mock ThreeMFLoader
vi.mock('three/examples/jsm/loaders/3MFLoader.js', () => {
  class MockThreeMFLoader {
    parse() {
      return { position: { sub: () => {} } }
    }
  }
  return { ThreeMFLoader: MockThreeMFLoader }
})

// Mock THREE
vi.mock('three', () => {
  class MockBox3 {
    setFromObject() { return this }
    getCenter() { return { x: 0, y: 0, z: 0 } }
    getSize() { return { x: 1, y: 1, z: 1 } }
  }
  class MockVector3 {
    x = 0; y = 0; z = 0
  }
  class MockPerspectiveCamera {}
  class MockGroup {}
  return {
    Box3: MockBox3,
    Vector3: MockVector3,
    PerspectiveCamera: MockPerspectiveCamera,
    Group: MockGroup,
  }
})

describe('ScadPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.agent = {
      openscad: {
        compile: vi.fn(),
        validateConfig: vi.fn(),
      },
    } as any
  })

  it('shows loading state during compilation', () => {
    vi.mocked(window.agent.openscad.compile).mockReturnValue(new Promise(() => {}))

    render(<ScadPreview filePath="/test/model.scad" lastSavedAt={1} />)
    expect(screen.getByText('Compiling OpenSCAD...')).toBeInTheDocument()
  })

  it('shows error on compile failure', async () => {
    vi.mocked(window.agent.openscad.compile).mockRejectedValue(new Error('OpenSCAD not found'))

    render(<ScadPreview filePath="/test/model.scad" lastSavedAt={1} />)
    await waitFor(() => {
      expect(screen.getByText('OpenSCAD not found')).toBeInTheDocument()
    })
  })

  it('renders canvas on success', async () => {
    vi.mocked(window.agent.openscad.compile).mockResolvedValue({
      data: btoa('fake 3mf'),
      warnings: '',
    })

    render(<ScadPreview filePath="/test/model.scad" lastSavedAt={1} />)
    await waitFor(() => {
      expect(screen.getByTestId('canvas')).toBeInTheDocument()
    })
  })

  it('shows warning banner when warnings exist', async () => {
    vi.mocked(window.agent.openscad.compile).mockResolvedValue({
      data: btoa('fake 3mf'),
      warnings: 'Deprecated syntax',
    })

    render(<ScadPreview filePath="/test/model.scad" lastSavedAt={1} />)
    await waitFor(() => {
      expect(screen.getByText('Deprecated syntax')).toBeInTheDocument()
    })
  })

  it('recompiles when lastSavedAt changes', async () => {
    vi.mocked(window.agent.openscad.compile).mockResolvedValue({
      data: btoa('fake 3mf'),
      warnings: '',
    })

    const { rerender } = render(<ScadPreview filePath="/test/model.scad" lastSavedAt={1} />)
    await waitFor(() => {
      expect(window.agent.openscad.compile).toHaveBeenCalledTimes(1)
    })

    rerender(<ScadPreview filePath="/test/model.scad" lastSavedAt={2} />)
    await waitFor(() => {
      expect(window.agent.openscad.compile).toHaveBeenCalledTimes(2)
    })
  })

  it('shows loading on initial mount', () => {
    vi.mocked(window.agent.openscad.compile).mockReturnValue(new Promise(() => {}))
    render(<ScadPreview filePath="/test/model.scad" lastSavedAt={0} />)
    expect(screen.getByText('Compiling OpenSCAD...')).toBeInTheDocument()
  })
})
