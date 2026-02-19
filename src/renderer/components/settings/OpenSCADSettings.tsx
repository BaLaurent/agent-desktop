import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'

interface ValidationResult {
  binaryFound: boolean
  binaryPath: string
  version: string
}

const inputStyle = {
  backgroundColor: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-text-muted)',
}

export function OpenSCADSettings() {
  const { settings, setSetting } = useSettingsStore()
  const [binaryPath, setBinaryPath] = useState(settings.openscad_binaryPath || 'openscad')
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    setBinaryPath(settings.openscad_binaryPath || 'openscad')
  }, [settings.openscad_binaryPath])

  const saveBinaryPath = useCallback((value: string) => {
    setBinaryPath(value)
    setSetting('openscad_binaryPath', value)
    setValidation(null)
  }, [setSetting])

  const handleTest = useCallback(async () => {
    setTesting(true)
    setValidation(null)
    try {
      const result = await window.agent.openscad.validateConfig()
      setValidation(result)
    } catch {
      setValidation(null)
    } finally {
      setTesting(false)
    }
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        OpenSCAD enables 3D model preview for{' '}
        <span className="font-medium" style={{ color: 'var(--color-text)' }}>.scad</span>
        {' '}files in the file explorer. Install it from{' '}
        <button
          onClick={() => window.agent.system.openExternal('https://openscad.org/downloads.html')}
          className="underline hover:opacity-80"
          style={{ color: 'var(--color-primary)' }}
        >
          openscad.org/downloads.html
        </button>
      </p>

      <div className="flex flex-col gap-1.5">
        <label
          className="text-sm font-medium"
          style={{ color: 'var(--color-text)' }}
        >
          OpenSCAD Binary Path
        </label>
        <input
          type="text"
          value={binaryPath}
          onChange={(e) => saveBinaryPath(e.target.value)}
          placeholder="openscad"
          className="w-full px-3 py-2 rounded text-sm outline-none"
          style={inputStyle}
          aria-label="OpenSCAD binary path"
        />
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Full path or command name if it's in your PATH (e.g. openscad, /usr/bin/openscad)
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <button
          onClick={handleTest}
          disabled={testing}
          className="self-start px-4 py-2 rounded text-sm font-medium transition-opacity hover:opacity-80 bg-tool text-contrast"
          style={{ opacity: testing ? 0.6 : 1 }}
        >
          {testing ? 'Testing...' : 'Test Configuration'}
        </button>

        {validation && (
          <div
            className="flex flex-col gap-1.5 px-3 py-2 rounded text-sm"
            style={{
              backgroundColor: 'var(--color-bg)',
              border: `1px solid ${validation.binaryFound ? 'var(--color-success)' : 'var(--color-error)'}`,
            }}
          >
            <div className="flex items-center gap-2">
              <span>{validation.binaryFound ? '\u2713' : '\u2717'}</span>
              <span style={{ color: validation.binaryFound ? 'var(--color-success)' : 'var(--color-error)' }}>
                Binary: {validation.binaryPath}
              </span>
            </div>
            {validation.binaryFound && validation.version && (
              <div className="flex items-center gap-2">
                <span>{'\u2713'}</span>
                <span style={{ color: 'var(--color-success)' }}>
                  Version: {validation.version}
                </span>
              </div>
            )}
            {!validation.binaryFound && (
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>
                Install OpenSCAD and ensure it is in your PATH, or provide an absolute path.
                When running as AppImage, absolute paths are recommended.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
