/**
 * Version utility tests
 */

import { describe, test, expect } from 'vitest'
import {
  VERSION,
  compareVersions,
  isNewerVersion,
  parseVersion,
  isMajorUpgrade,
  isMinorUpgrade,
  isPatchUpgrade,
  shouldAutoUpgrade,
} from '../src/utils/version'

describe('VERSION constant', () => {
  test('VERSION is defined and valid semver', () => {
    expect(VERSION).toBeDefined()
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})

describe('compareVersions', () => {
  test('equal versions return 0', () => {
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('2.3.4', '2.3.4')).toBe(0)
  })

  test('greater major version returns 1', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1)
    expect(compareVersions('10.0.0', '9.0.0')).toBe(1)
  })

  test('lesser major version returns -1', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1)
    expect(compareVersions('9.0.0', '10.0.0')).toBe(-1)
  })

  test('greater minor version returns 1', () => {
    expect(compareVersions('1.1.0', '1.0.0')).toBe(1)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
  })

  test('lesser minor version returns -1', () => {
    expect(compareVersions('1.0.0', '1.1.0')).toBe(-1)
    expect(compareVersions('1.9.0', '1.10.0')).toBe(-1)
  })

  test('greater patch version returns 1', () => {
    expect(compareVersions('1.0.1', '1.0.0')).toBe(1)
    expect(compareVersions('1.0.10', '1.0.9')).toBe(1)
  })

  test('lesser patch version returns -1', () => {
    expect(compareVersions('1.0.0', '1.0.1')).toBe(-1)
    expect(compareVersions('1.0.9', '1.0.10')).toBe(-1)
  })

  test('handles versions with v prefix', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', 'v1.0.0')).toBe(0)
    expect(compareVersions('v2.0.0', 'v1.0.0')).toBe(1)
  })

  test('handles versions with different lengths', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0', '1.0')).toBe(0)
    expect(compareVersions('1.0.1', '1.0')).toBe(1)
  })
})

describe('isNewerVersion', () => {
  test('returns true when latest is newer', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.1.0', '1.0.0')).toBe(true)
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true)
  })

  test('returns false when versions are equal', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false)
  })

  test('returns false when latest is older', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(false)
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false)
  })
})

describe('parseVersion', () => {
  test('parses standard version', () => {
    const result = parseVersion('1.2.3')
    expect(result).toEqual({ major: 1, minor: 2, patch: 3 })
  })

  test('handles v prefix', () => {
    const result = parseVersion('v2.0.0')
    expect(result).toEqual({ major: 2, minor: 0, patch: 0 })
  })

  test('handles missing parts', () => {
    const result = parseVersion('1')
    expect(result).toEqual({ major: 1, minor: 0, patch: 0 })
  })
})

describe('isMajorUpgrade', () => {
  test('returns true for major version bump', () => {
    expect(isMajorUpgrade('2.0.0', '1.0.0')).toBe(true)
    expect(isMajorUpgrade('3.0.0', '2.5.3')).toBe(true)
  })

  test('returns false for minor or patch bump', () => {
    expect(isMajorUpgrade('1.1.0', '1.0.0')).toBe(false)
    expect(isMajorUpgrade('1.0.1', '1.0.0')).toBe(false)
  })

  test('returns false for same or older version', () => {
    expect(isMajorUpgrade('1.0.0', '1.0.0')).toBe(false)
    expect(isMajorUpgrade('1.0.0', '2.0.0')).toBe(false)
  })
})

describe('isMinorUpgrade', () => {
  test('returns true for minor version bump', () => {
    expect(isMinorUpgrade('1.1.0', '1.0.0')).toBe(true)
    expect(isMinorUpgrade('1.2.0', '1.1.5')).toBe(true)
  })

  test('returns false for major or patch bump', () => {
    expect(isMinorUpgrade('2.0.0', '1.0.0')).toBe(false)
    expect(isMinorUpgrade('1.0.1', '1.0.0')).toBe(false)
  })
})

describe('isPatchUpgrade', () => {
  test('returns true for patch version bump', () => {
    expect(isPatchUpgrade('1.0.1', '1.0.0')).toBe(true)
    expect(isPatchUpgrade('1.1.2', '1.1.1')).toBe(true)
  })

  test('returns false for major or minor bump', () => {
    expect(isPatchUpgrade('2.0.0', '1.0.0')).toBe(false)
    expect(isPatchUpgrade('1.1.0', '1.0.0')).toBe(false)
  })
})

describe('shouldAutoUpgrade', () => {
  test('returns false when not a newer version', () => {
    expect(shouldAutoUpgrade('1.0.0', '1.0.0', true)).toBe(false)
    expect(shouldAutoUpgrade('1.0.0', '2.0.0', true)).toBe(false)
  })

  test('never auto-upgrades major versions', () => {
    expect(shouldAutoUpgrade('2.0.0', '1.0.0', true)).toBe(false)
    expect(shouldAutoUpgrade('2.0.0', '1.0.0', false)).toBe(false)
  })

  test('auto-upgrades minor versions when enabled', () => {
    expect(shouldAutoUpgrade('1.1.0', '1.0.0', true)).toBe(true)
    expect(shouldAutoUpgrade('1.2.0', '1.1.0', true)).toBe(true)
  })

  test('skips minor versions when disabled', () => {
    expect(shouldAutoUpgrade('1.1.0', '1.0.0', false)).toBe(false)
    expect(shouldAutoUpgrade('1.2.0', '1.1.0', false)).toBe(false)
  })

  test('always auto-upgrades patch versions', () => {
    expect(shouldAutoUpgrade('1.0.1', '1.0.0', true)).toBe(true)
    expect(shouldAutoUpgrade('1.0.1', '1.0.0', false)).toBe(true)
    expect(shouldAutoUpgrade('1.1.2', '1.1.1', false)).toBe(true)
  })
})
