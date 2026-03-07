// Monkey-patch console methods with ANSI colors for readable terminal output.
// Import this module as early as possible (before any other import that logs).

const RESET = '\x1b[0m'
const PALE_BLUE = '\x1b[94m'   // info / log
const ORANGE = '\x1b[38;5;214m' // warn
const RED = '\x1b[91m'          // error

const originalLog = console.log.bind(console)
const originalWarn = console.warn.bind(console)
const originalError = console.error.bind(console)

console.log = (...args: unknown[]) => originalLog(PALE_BLUE, ...args, RESET)
console.info = (...args: unknown[]) => originalLog(PALE_BLUE, ...args, RESET)
console.warn = (...args: unknown[]) => originalWarn(ORANGE, ...args, RESET)
console.error = (...args: unknown[]) => originalError(RED, ...args, RESET)
