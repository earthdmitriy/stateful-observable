Release checklist:
1) Tests passing
2) Everything listed in index.ts
3) New functionality listed in readme

Steps:
1. Run tests with `npm run test`
2. Ensure formatting `npm run prettier`
3. Build with `npm run tsup`
4. Update readme
5. Commit changes
6. Bump version `npm version patch` or `npm version minor`
7. Ensure login `npm login`
8. Publish with `npm publish --access public`
9. Push changes