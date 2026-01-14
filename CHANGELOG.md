# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Integration test setup for Puter API (coming soon)
- Example usage scripts

### Changed
- Improved error messages with more context

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

[Unreleased]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.2...HEAD
[1.0.0-beta.2]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/Mihai-Codes/opencode-puter-auth/compare/v0.0.0...v1.0.0-beta.1
[0.0.0]: https://github.com/Mihai-Codes/opencode-puter-auth/releases/tag/v0.0.0
