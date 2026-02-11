import { describe, it, expect } from 'vitest'
import { validateString, validatePositiveInt, validatePathSafe } from './validate'

describe('validate utilities', () => {
  describe('validateString', () => {
    it('accepts valid string', () => {
      expect(validateString('hello', 'test')).toBe('hello')
    })

    it('accepts empty string', () => {
      expect(validateString('', 'test')).toBe('')
    })

    it('throws on non-string input', () => {
      expect(() => validateString(123, 'test')).toThrow('test must be a string')
      expect(() => validateString(null, 'test')).toThrow('test must be a string')
      expect(() => validateString(undefined, 'test')).toThrow('test must be a string')
      expect(() => validateString({}, 'test')).toThrow('test must be a string')
      expect(() => validateString([], 'test')).toThrow('test must be a string')
    })

    it('throws on oversized string with default max length', () => {
      const longString = 'a'.repeat(10001)
      expect(() => validateString(longString, 'test')).toThrow('test exceeds max length (10000)')
    })

    it('throws on oversized string with custom max length', () => {
      expect(() => validateString('hello', 'test', 3)).toThrow('test exceeds max length (3)')
    })

    it('accepts string at exact max length', () => {
      const exactString = 'a'.repeat(100)
      expect(validateString(exactString, 'test', 100)).toBe(exactString)
    })
  })

  describe('validatePositiveInt', () => {
    it('accepts positive integer', () => {
      expect(validatePositiveInt(1, 'test')).toBe(1)
      expect(validatePositiveInt(100, 'test')).toBe(100)
      expect(validatePositiveInt(999999, 'test')).toBe(999999)
    })

    it('throws on zero', () => {
      expect(() => validatePositiveInt(0, 'test')).toThrow('test must be a positive integer')
    })

    it('throws on negative integer', () => {
      expect(() => validatePositiveInt(-1, 'test')).toThrow('test must be a positive integer')
      expect(() => validatePositiveInt(-100, 'test')).toThrow('test must be a positive integer')
    })

    it('throws on float', () => {
      expect(() => validatePositiveInt(1.5, 'test')).toThrow('test must be a positive integer')
      expect(() => validatePositiveInt(0.1, 'test')).toThrow('test must be a positive integer')
    })

    it('throws on NaN', () => {
      expect(() => validatePositiveInt(NaN, 'test')).toThrow('test must be a positive integer')
    })

    it('throws on Infinity', () => {
      expect(() => validatePositiveInt(Infinity, 'test')).toThrow(
        'test must be a positive integer'
      )
    })

    it('throws on non-number', () => {
      expect(() => validatePositiveInt('1', 'test')).toThrow('test must be a positive integer')
      expect(() => validatePositiveInt(null, 'test')).toThrow('test must be a positive integer')
      expect(() => validatePositiveInt(undefined, 'test')).toThrow(
        'test must be a positive integer'
      )
    })
  })

  describe('validatePathSafe', () => {
    it('accepts valid path', () => {
      const result = validatePathSafe('/home/user/documents/file.txt')
      expect(result).toBe('/home/user/documents/file.txt')
    })

    it('resolves relative paths', () => {
      const result = validatePathSafe('./relative/path')
      expect(result).toContain('relative/path')
    })

    it('blocks /proc path', () => {
      expect(() => validatePathSafe('/proc/self/maps')).toThrow(
        'Access denied: /proc is a protected directory'
      )
      expect(() => validatePathSafe('/proc')).toThrow(
        'Access denied: /proc is a protected directory'
      )
    })

    it('blocks /sys path', () => {
      expect(() => validatePathSafe('/sys/kernel/debug')).toThrow(
        'Access denied: /sys is a protected directory'
      )
      expect(() => validatePathSafe('/sys')).toThrow(
        'Access denied: /sys is a protected directory'
      )
    })

    it('blocks /dev path', () => {
      expect(() => validatePathSafe('/dev/null')).toThrow(
        'Access denied: /dev is a protected directory'
      )
      expect(() => validatePathSafe('/dev')).toThrow(
        'Access denied: /dev is a protected directory'
      )
    })

    it('blocks /boot path', () => {
      expect(() => validatePathSafe('/boot/vmlinuz')).toThrow(
        'Access denied: /boot is a protected directory'
      )
    })

    it('blocks /sbin path', () => {
      expect(() => validatePathSafe('/sbin/init')).toThrow(
        'Access denied: /sbin is a protected directory'
      )
    })

    it('blocks /etc path', () => {
      expect(() => validatePathSafe('/etc/passwd')).toThrow(
        'Access denied: /etc is a protected directory'
      )
      expect(() => validatePathSafe('/etc/shadow')).toThrow(
        'Access denied: /etc is a protected directory'
      )
    })

    it('accepts path within allowedBase', () => {
      const result = validatePathSafe('/home/user/project/file.txt', '/home/user/project')
      expect(result).toBe('/home/user/project/file.txt')
    })

    it('accepts allowedBase itself', () => {
      const result = validatePathSafe('/home/user/project', '/home/user/project')
      expect(result).toBe('/home/user/project')
    })

    it('blocks path outside allowedBase', () => {
      expect(() => validatePathSafe('/home/user/other/file.txt', '/home/user/project')).toThrow(
        'Path traversal detected'
      )
    })

    it('blocks parent directory traversal with ..', () => {
      // This resolves to /home which is outside /home/user/project
      expect(() =>
        validatePathSafe('/home/user/project/../../../home/other/file.txt', '/home/user/project')
      ).toThrow('Path traversal detected')
    })

    it('blocks subtle parent traversal', () => {
      // This resolves to /home/user which is outside /home/user/project
      expect(() => validatePathSafe('/home/user/project/../file.txt', '/home/user/project')).toThrow(
        'Path traversal detected'
      )
    })

    it('allows nested paths within allowedBase', () => {
      const result = validatePathSafe('/home/user/project/nested/deep/file.txt', '/home/user/project')
      expect(result).toBe('/home/user/project/nested/deep/file.txt')
    })
  })
})
