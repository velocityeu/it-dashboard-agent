# Version Control

This document describes the version management approach for the IT Dashboard Agent.

## Semantic Versioning

The agent follows [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Incompatible API changes or breaking changes
- **MINOR**: New functionality in a backward-compatible manner
- **PATCH**: Backward-compatible bug fixes

## Version Source Location

The single source of truth for the agent version is:

**`src/utils/version.ts`**

```typescript
export const VERSION = '1.0.0'
```

This file is imported by all components that need version information.

### Other Version References

These files also contain version references and should be updated during releases:

| File | Purpose |
|------|---------|
| `package.json` | NPM package version (should match) |
| `scripts/install.ps1` | Banner display version |
| `scripts/install.sh` | Banner display version |

## Version Synchronization

All version strings should be synchronized during the release process:

1. Update `src/utils/version.ts`
2. Update `package.json`
3. Update installer scripts banners
4. Create Git tag
5. Create GitHub release

## Dashboard Version

The dashboard maintains its own version in:

**`src/lib/constants.ts`**

```typescript
export const APP_VERSION = '1.0.0'
export const LATEST_AGENT_VERSION = '1.0.0'  // Update when releasing new agent
```

When releasing a new agent version, the dashboard's `LATEST_AGENT_VERSION` constant should be updated to match.

## Version Comparison

The agent includes version comparison utilities in `src/utils/version.ts`:

- `compareVersions(a, b)` - Compare two version strings
- `isNewerVersion(latest, current)` - Check if an upgrade is available
- `isMajorUpgrade(latest, current)` - Check for breaking changes
- `isMinorUpgrade(latest, current)` - Check for new features
- `isPatchUpgrade(latest, current)` - Check for bug fixes
- `shouldAutoUpgrade(latest, current, autoMinor)` - Determine if auto-upgrade should proceed

## Release Checklist

Before releasing a new version:

- [ ] All tests pass
- [ ] Version updated in `src/utils/version.ts`
- [ ] Version updated in `package.json`
- [ ] Version updated in installer banners
- [ ] CHANGELOG.md updated
- [ ] Documentation updated
- [ ] Git commit with message: `chore: release v1.x.x`
- [ ] Git tag created: `v1.x.x`
- [ ] GitHub release created
- [ ] Dashboard `LATEST_AGENT_VERSION` updated
