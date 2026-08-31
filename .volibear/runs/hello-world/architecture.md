# Architecture: Hello World Function in TypeScript

## Approach
Create a simple exported function in the `@volibear/core` package that returns the "Hello, World!" string. The function will follow existing code patterns in the core package, using proper TypeScript type annotations and being exported through the package's public API.

## Files to Create
- `packages/core/src/greeting.ts` - Contains the hello world function with proper TypeScript types

## Files to Modify
- `packages/core/src/index.ts` - Export the new greeting function to make it available to consumers

## Risks
- None identified. This is a simple, isolated function with no external dependencies.

## Acceptance Criteria
1. Function returns the exact string "Hello, World!"
2. Function has explicit TypeScript return type annotation (`string`)
3. Function is exported from `@volibear/core` package
4. Function does not perform any side effects (no console.log, no file I/O)
5. Code passes TypeScript strict mode compilation
6. Code passes ESLint checks
7. Function can be imported by other packages in the monorepo