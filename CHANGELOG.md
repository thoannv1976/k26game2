# Changelog

## 1.1.0 – 2026-11-01

### Added
- `GET /api/lms/v1/learners/:uid/evidence`: one learner's evidence (k26-evidence-1.0). Besides school admins, the
  VSTEP Quest (Game 3) service account may call it read-only with a Google ID token (audience `k26-lms`) and the
  `X-K26-Tenant` header (four-skill profile across the K26 games). Allowed accounts: `LMS_SERVICE_ACCOUNTS`
  (deploy default `vstep-api@<project>.iam.gserviceaccount.com`; empty = disabled).

## 1.0.0 – 2026-11-01

First complete version of English Detective – AI Mystery Challenge (K26 Game 2).

- Six investigation cases CASE01–CASE06 (B1/B2), each a versioned **Canonical Case Dossier** with documents, characters,
  evidence (key / verified / unverified / irrelevant), reading questions, conclusion, writing task, 3-level hints and a sample solution.
- Game Engine (deterministic): unlocking by facts/questions/evidence, highlight-to-evidence matching, Case Board (categories,
  links), conclusion with supporting evidence, submission rules, machine scoring (reading, evidence, conclusion), game points.
- AI (Vertex Gemini): character interviews limited to eligible facts with reply guards, Investigation Assistant (no solutions),
  writing/reasoning grader with verified quotes, learning recommendations, AI Case Generator (drafts only).
- Asynchronous grading, autosaved drafts with version control, resume, teacher review and regrade, CSV export, class leaderboard
  (game points only), case bank with approval workflow, quotas and usage reports, LMS API (`k26-evidence-1.0`).
- Shared Firebase Auth accounts with English City Simulator; separate Firestore database `detective`, Cloud Run service
  `detective-api`, Hosting site `k26-detective`.
- Tests: engine/content, AI guards, API unit, integration (Firebase emulators), Firestore rules, E2E (Playwright).
