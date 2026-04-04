# Contributing to Frostpillar Storage Engine

Thank you for your interest in contributing! This guide explains how to get started.

## Requirements

- Node.js `>=24.0.0`
- pnpm `>=10.0.0`

## Setup

```bash
git clone https://github.com/hjmsano/frostpillar-storage-engine.git
cd frostpillar-storage-engine
pnpm install
```

## Development Workflow

This project follows a strict **SDD/TDD** workflow:

1. **Spec** — update or create a spec in `docs/specs/` before implementation.
2. **Test** — write tests before code.
3. **Code** — implement minimal logic to pass the tests.
4. **Verify** — run `pnpm check` to ensure everything passes.

## Commands

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `pnpm check`        | Run type checking, lint, tests, and textlint |
| `pnpm test`         | Run tests                                    |
| `pnpm lint`         | Run ESLint                                   |
| `pnpm typecheck`    | Run TypeScript type checking                 |
| `pnpm build`        | Build the package                            |
| `pnpm build:bundle` | Build the browser IIFE bundle                |

## Submitting Changes

1. Fork the repository and create a feature branch from `main`.
2. Follow the SDD/TDD workflow described above.
3. Run `pnpm check` and confirm all checks pass.
4. Open a pull request against `main` with a clear description of the change.

## Reporting Bugs

Open an issue on [GitHub Issues](https://github.com/hjmsano/frostpillar-storage-engine/issues) with:

- A clear title and description.
- Steps to reproduce.
- Expected vs. actual behavior.
- Environment details (Node.js version, OS, etc.).

## Code Style

- Code is formatted with [Prettier](https://prettier.io/) and linted with [ESLint](https://eslint.org/).
- Markdown is checked with [textlint](https://textlint.github.io/).
- Run `pnpm format` to auto-format before committing.

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Vision and principles](docs/architecture/vision-and-principles.md)
- [Testing strategy](docs/architecture/testing-strategy.md)
- [Specs index](docs/specs/README.md)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
