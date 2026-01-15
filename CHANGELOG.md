# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Integration test setup for Puter API (coming soon)

## [1.0.0-beta.5] - 2026-01-15

### Fixed
- Upgraded all vitest packages to v4.x for peer dependency compatibility
- Fixed contributor avatar URL in README (use numeric GitHub user ID)

### Changed
- Updated devDependencies: vitest ^4.0.0, @vitest/ui ^4.0.0, @vitest/coverage-v8 ^4.0.0

## [1.0.0-beta.4] - 2026-01-14

### Added
- Example usage scripts in `examples/` directory
- Exported additional types: `PuterChatMessage`, `PuterChatStreamChunk`, `PuterModelInfo`
- CHANGELOG.md following Keep a Changelog format

### Changed
- Repository transferred to `Mihai-Codes` organization
- Updated all GitHub URLs to new organization
- Updated npm Trusted Publisher for new organization

## [1.0.0-beta.3] - 2026-01-14

### Changed
- Updated dependencies: open 10.2.0 → 11.0.0, @vitest/ui 3.2.4 → 4.0.17

## [1.0.0-beta.2] - 2025-01-14

### Added
- Contributing guidelines (`CONTRIBUTING.md`)
- CLA (Contributor License Agreement) workflow
- All Contributors bot configuration
- GitHub Sponsors/Ko-fi funding configuration

### Changed
- Updated dependencies (zod 4.3.5, @types/node 25.0.8)

### Fixed
- Handle prerelease versions in npm publish workflow

## [1.0.0-beta.1] - 2025-01-13

### Added
- Initial release of opencode-puter-auth plugin
- OAuth authentication via Puter.com popup flow
- Support for 500+ AI models through Puter's "User-Pays" model:
  - Claude Opus 4.5, Sonnet 4.5, Haiku
  - GPT-5, GPT-5 Nano
  - Gemini models
  - And many more via OpenRouter
- Streaming and non-streaming chat completions
- TypeScript types with Zod validation
- Custom OpenCode tools:
  - `puter_login` - Authenticate with Puter
  - `puter_models` - List available models
  - `puter_account` - View account info
- Secure token storage in `~/.config/opencode/puter-accounts.json`
- 24 comprehensive unit tests
- Full CI/CD with GitHub Actions
- npm Trusted Publishing (OIDC - no tokens needed!)

### Security
- OAuth tokens stored locally, never transmitted to third parties
- Uses HTTPS for all API communications

## [0.0.0] - 2025-01-12

### Added
- Initial project setup
- Basic project structure

[Unreleased]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.5...HEAD
[1.0.0-beta.5]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.4...v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.3...v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.2...v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v0.0.0...v1.0.0-beta.1
[0.0.0]: https://github.com/Mihai-Codes/opencode-puter-auth/releases/tag/v0.0.0
