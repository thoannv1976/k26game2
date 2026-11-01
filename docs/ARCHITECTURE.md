# ARCHITECTURE

```
Browser (React SPA) ── Firebase Auth (shared with English City Simulator)
   │ /api/** + ID token
   ▼
Firebase Hosting site "k26-detective" ──rewrite──► Cloud Run "detective-api" (asia-southeast1)
                                                    ├─ Firestore database "detective" (separate from Game 1's "(default)")
                                                    ├─ Firebase Auth Admin (claims {tenantId, role} shared by both games)
                                                    └─ Vertex AI Gemini (characters, assistant, grader, case generator)
```

## Packages

| Package | Role |
|---|---|
| `packages/shared` | Platform types (schools, users, quotas – same model as Game 1), **Canonical Case Dossier** schema (`case.ts`), common evidence format `k26-evidence-1.0` |
| `packages/game-engine` | Deterministic rules: `state.ts` (unlocking, highlight matching, board, conclusion, hints, submission), `scoring.ts`, `view.ts` (student-safe projections), `validate.ts` (`checkDossier`) |
| `packages/ai` | `prompts.ts`, `vertex.ts` (Gemini, JSON schemas, thinking budget cap), `fake.ts` (offline, tests only), `guards.ts` (reply/answer guards, grader quote verification) |
| `apps/api` | Fastify routes (`core`, `teacher`, `admin`, `platform`, `lms`), services (`investigation`, `grading`, `cases`, `users`, `access`), quotas, audit |
| `apps/web` | Detective Office, investigation workspace, results, academy, teacher/admin/platform dashboards |

## Principles

1. **Canonical Case Dossier.** Each case version contains all facts, evidence (with the correct category), character knowledge,
   answers and the expected conclusion. It is approved by a teacher, versioned, and **only the backend reads it**. A session
   keeps the version it started with.
2. **The Game Engine decides; the AI talks.** Unlocking documents, accepting evidence, stage progress, submission rules and
   most of the score are deterministic code. The AI proposes which facts its reply reveals; the engine accepts only facts of
   that character whose condition is met.
3. **Grounded characters.** The character prompt contains only facts eligible *now* and the list of restricted topics.
   `guardCharacterReply` replaces any reply containing restricted phrases, text of locked facts or the solution.
4. **No invented feedback.** Grader quotes/corrections that do not appear in the student's report are removed; scores are clamped.
   If the AI fails, AI parts are "not assessed" – never guessed.
5. **Everything sensitive on the server.** Firestore rules deny all client writes and any client read of dossiers.
6. **Shared identity, separate data.** Same Firebase Auth users and claims as Game 1; separate database, service account
   (IAM-conditioned to the `detective` database), Cloud Run service and Hosting site.

## Key flows

**Highlight → evidence:** the selected text must exist in an unlocked document; it matches an evidence item if it covers the
excerpt (not grossly longer) or ≥ 60% of its words; otherwise it is stored as a personal clue.

**Interview:** claim (idempotent `clientMessageId`, per-session lock, limits, quota) → eligible facts → Gemini (JSON) → guard →
engine `revealFacts` (may unlock documents) → save message + state. On AI failure: neutral fallback reply, nothing unlocked, not counted.

**Submission & grading (asynchronous):** `POST /submit` validates the blockers and stores the final report (202). The first
`GET /results` claims the session (`grading` lock, stale after 3 min) and grades: engine scores + one Gemini call
(open answers + reasoning + writing) → verification → assessment (id = session id, so never duplicated) → profile update
(XP, detective points, badges once).

## Scoring (100)

Reading 25 (objective questions by engine + open answers by AI) · Evidence 25 (engine: key recall 12, categorization 8, links 5)
· Critical thinking 20 (engine 10: correct conclusion + required evidence; AI 10: reasoning quality) · Writing 30 (AI: 10/7/7/6).
Game points (detective points, XP, badges) are separate and never shown with language scores on the leaderboard.
