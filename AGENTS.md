# agents.md – Library Developer & AI Agent Guidelines

This document outlines the architectural principles, coding conventions, and TypeScript best practices for contributing to this generic library. The library is built with a functional programming mindset, prioritising purity, immutability, and type safety.

## Guiding Principles

- **Functional over object‑oriented** – Prefer pure functions, function composition, and higher‑order functions. Avoid classes, inheritance, and mutable state.
- **Immutability by default** – Never mutate input arguments or internal state. Return new data structures instead.
- **Pure functions** – Functions must be deterministic and free of side effects (e.g., no I/O, no global state mutation, no external API calls unless explicitly isolated).
- **Type safety** – Use TypeScript’s strict mode. Never use `any` or type assertions (`as`). Rely on type inference, union types, type guards, and algebraic data types.
- **Explicit > implicit** – Make types, error handling, and edge cases explicit. Avoid “magic” behaviour.

## Code Style & Conventions

- **Naming**  
  - Use `camelCase` for variables, functions, and parameters.  
  - Use `PascalCase` for types, interfaces, and type aliases.  
  - Use descriptive names: `filterValidUsers` not `f`.

- **File structure**  
  - Group related functions into modules (e.g., `array.ts`, `option.ts`).  
  - One main export per module, with internal helpers kept private (non‑exported).    
  - Tests are in same folder fith code in `*.spec.ts`
  - Barrel files (`index.ts`) can re‑export public APIs.

- **Formatting**  
  - Follow a consistent style (Prettier recommended).  
  - Use 2 spaces for indentation.  
  - Place opening braces on the same line.

- **Imports**  
  - Prefer `import type` for type‑only imports.  
  - Group imports: external libraries first, then internal modules.

## TypeScript Best Practices

- **Strict mode** – Enable `strict: true` in `tsconfig.json` (including `noImplicitAny`, `strictNullChecks`, etc.).
- **No `any`** – Use `unknown` when the type is truly unknown, then narrow with type guards.  
- **No type assertions** – Avoid `as` and `<Type>` casts. Use type predicates or pattern matching instead.
- **Use readonly where possible** – Mark parameters and return types with `readonly` to enforce immutability at the type level.
- **Leverage discriminated unions** – Model state variants with union types and a common discriminant field.

## Function Design

### Pure Functions

Every exported function must:
- Return the same output for the same input.
- Not modify any external state.
- Not perform I/O operations (unless wrapped in a controlled abstraction like `Task` or `IO`).

### Immutable Parameters

```typescript
// ❌ Mutates input
function addItem<T>(arr: T[], item: T): T[] {
  arr.push(item);
  return arr;
}

// ✅ Pure & immutable
function addItem<T>(arr: readonly T[], item: T): readonly T[] {
  return [...arr, item];
}
```


## Testing

- **Unit tests** – Write tests for every exported function. Libraty using Jest.
- **Property‑based testing** – Use fast-check to verify laws (e.g., functor laws, identity, composition).
- **Test purity** – Ensure no side effects are introduced. Mock external dependencies when unavoidable.
