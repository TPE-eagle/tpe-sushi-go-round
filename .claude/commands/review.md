# Code Review

Perform a full code review on current changes (`git diff main`).
Review based on this project's architecture and known risk areas.

---

## Architecture Context

- **Data flow**: Taoyuan Airport API → fetchData() → filterFlightsByTime() → displayFlights()
- **Critical invariant**: API requests must always send `OTimeOpen: null, OTimeClose: null`
- **Time window filtering is client-side only** — never filter at API request level
- **Three airlines**: BR (EVA Air), CI (China Airlines), JX (Starlux)

---

## 1. API & Data Logic

### API Parameters
- Are `OTimeOpen` and `OTimeClose` still `null`? (Never set time range in API requests)
- Is the POST body format correct?

### Time Window
- Does `filterFlightsByTime()` check both ODateTime and RDateTime?
- Is the time window config correct? (Arrival: -40min start, 120min duration; Departure: 0min start, 120min duration)
- Are timezone assumptions correct (UTC+8)?

### Flight Filtering
- Are cancelled flights excluded (Memo contains "取消" or "cancelled")?
- Does airline filtering use `AIRLINE_CODES`?

---

## 2. UI & UX

- Does dark/light theme toggle still work?
- Is mobile responsiveness maintained?
- Do cookie persistence mechanisms work (airline selection, theme, language)?
- Do new UI elements use Bootstrap 5 components?

---

## 3. i18n

- Are all three languages (zh/en/jp) updated for new text?
- Does language switching correctly reload data?

---

## 4. Tests

- Do new features have corresponding test cases?
- Is E2E smart API caching preserved?
- Is `blockGoogleAnalytics()` called in E2E test setup?
- Risk of breaking existing tests?

---

## Output Format

```
## Code Review Results

### FAIL — Must Fix
- [Description] (file:line)

### WARN — Suggested Improvements
- [Description] (file:line)

### PASS — Good Practices
- [Positive observations]

### Verdict
[Ready to merge / Needs changes / Do not merge] — reason
```
