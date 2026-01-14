# Contributing to opencode-puter-auth

First off, thank you for considering contributing to opencode-puter-auth! This project provides FREE, UNLIMITED access to AI models through Puter.com, and every contribution helps make it better for everyone.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code.

## How to Contribute

### Reporting Bugs

If you find a bug, please [open an issue](https://github.com/Mihai-Codes/opencode-puter-auth/issues/new) with:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected vs actual behavior
- Your environment (Node.js version, OS, OpenCode version)

### Suggesting Features

Feature requests are welcome! Please [open an issue](https://github.com/Mihai-Codes/opencode-puter-auth/issues/new) describing:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes**
4. **Run tests**: `npm test`
5. **Run type check**: `npm run typecheck`
6. **Commit your changes** with a clear message
7. **Push to your fork** and open a Pull Request

### Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/opencode-puter-auth.git
cd opencode-puter-auth

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Type check
npm run typecheck

# Build
npm run build
```

### Code Style

- We use TypeScript with strict mode
- Format code with Prettier (if available) or follow existing style
- Keep functions small and focused
- Add tests for new features
- Document public APIs with JSDoc comments

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks
- `refactor:` - Code changes that neither fix bugs nor add features

Examples:
```
feat: add support for streaming responses
fix: handle timeout errors gracefully
docs: update installation instructions
```

### Contributor License Agreement (CLA)

Before your first pull request can be merged, you'll need to sign our Contributor License Agreement (CLA). This is a simple process:

1. Open your pull request
2. A bot will comment asking you to sign the CLA
3. Reply with `I have read the CLA Document and I hereby sign the CLA`

This ensures that all contributions can be properly licensed.

## Getting Help

- **Questions?** Open a [Discussion](https://github.com/Mihai-Codes/opencode-puter-auth/discussions) or [Issue](https://github.com/Mihai-Codes/opencode-puter-auth/issues)
- **Chat?** Tag the maintainer in your issue

## Recognition

Contributors will be recognized in:
- The README's Contributors section
- Release notes for significant contributions

Thank you for helping make AI more accessible to everyone!

---

**Made with love by the opencode-puter-auth community**
