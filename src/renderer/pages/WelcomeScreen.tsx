import { useAuthStore } from '../stores/authStore'

function DiagnosticsPanel() {
  const { diagnostics } = useAuthStore()
  if (!diagnostics) return null

  const rows: [string, string][] = [
    ['HOME', diagnostics.home],
    ['Config dir', diagnostics.configDir],
    ['Credentials found', diagnostics.credentialsFileExists ? 'Yes' : 'No'],
    ['claude binary found', diagnostics.claudeBinaryFound ? 'Yes' : 'No'],
    ['claude binary path', diagnostics.claudeBinaryPath || 'Not in PATH'],
    ['AppImage', diagnostics.isAppImage ? 'Yes' : 'No'],
    ['LD_LIBRARY_PATH', diagnostics.ldLibraryPath || '(clean)'],
  ]
  if (diagnostics.sdkError) {
    rows.push(['SDK error', diagnostics.sdkError])
  }

  return (
    <details
      className="mt-3 text-left text-xs rounded p-2"
      style={{ backgroundColor: 'var(--color-deep)', color: 'var(--color-text-muted)' }}
    >
      <summary className="cursor-pointer select-none" style={{ color: 'var(--color-text-muted)' }}>
        Diagnostics
      </summary>
      <table className="mt-2 w-full">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="pr-3 py-0.5 font-mono whitespace-nowrap align-top" style={{ color: 'var(--color-text-muted)' }}>
                {label}
              </td>
              <td className="py-0.5 font-mono break-all" style={{ color: 'var(--color-text)' }}>
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

export function WelcomeScreen() {
  const { isLoading, error, login } = useAuthStore()

  return (
    <div
      className="flex-1 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <div
        className="rounded-lg p-8 text-center max-w-md"
        style={{ backgroundColor: 'var(--color-surface)' }}
      >
        <h1
          className="text-3xl font-bold mb-2"
          style={{ color: 'var(--color-primary)' }}
        >
          Agent Desktop
        </h1>
        <p className="mb-6 text-sm" style={{ color: 'var(--color-text-muted)' }}>
          Open-source Linux desktop client for Claude AI
        </p>

        <div
          className="rounded-md p-4 mb-6 text-left text-sm"
          style={{
            backgroundColor: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
          }}
        >
          <p className="mb-2" style={{ color: 'var(--color-text)' }}>
            Uses your existing Claude subscription.
          </p>
          <p>
            Run{' '}
            <code
              className="px-1.5 py-0.5 rounded text-xs font-mono"
              style={{
                backgroundColor: 'var(--color-deep)',
                color: 'var(--color-primary)',
              }}
            >
              claude login
            </code>{' '}
            in your terminal to authenticate with your Anthropic account, then click below to connect.
          </p>
        </div>

        {error && (
          <div className="mb-4">
            <p
              className="text-sm rounded p-2"
              style={{
                color: 'var(--color-error)',
                backgroundColor: 'var(--color-bg)',
              }}
            >
              {error}
            </p>
            <DiagnosticsPanel />
          </div>
        )}

        <button
          onClick={login}
          disabled={isLoading}
          className="w-full px-6 py-3 rounded-md font-medium transition-opacity"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: '#fff',
            opacity: isLoading ? 0.6 : 1,
            cursor: isLoading ? 'wait' : 'pointer',
          }}
        >
          {isLoading ? 'Checking...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
