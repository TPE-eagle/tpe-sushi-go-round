# Run Tests

Run the full test suite and analyze results.

---

## Steps

### 1. Unit Tests
```bash
npm run test:run
```

### 2. If all unit tests pass
- Report the number of tests passed
- Ask the user whether to proceed with E2E tests

### 3. If any test fails
- List each failing test name and error message
- Read the relevant test code and the production code being tested
- Analyze root cause (production bug vs outdated test)
- Suggest fixes, but **do NOT modify test files automatically**

### 4. E2E Tests (requires user confirmation)
```bash
npm run test:e2e:local
```

### 5. Build Verification
```bash
npm run build
```

## Rules

- When tests fail, fix production code first — never modify tests without user approval
- E2E tests hit the Taoyuan Airport API (first call only, then cached) — confirm before running
- All times are UTC+8 (Taipei time) — watch for timezone issues
