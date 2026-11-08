# Changelog

## 1.2.0 – unreleased (branch feature/lti-sso)

### Added
- UniGame Hub (LTI 1.3) single sign-on from Moodle, off unless `LTI_ENABLED=true` (same adapter as English City Simulator).
  - `POST /api/lti/launch {ticket}` verifies the Hub's one-time signed ticket and creates or reuses an `lti-…` Auth user.
    The uid is derived from the Hub user id exactly as in Game 1, so a Moodle user has one account across the K26 games.
    Users are never keyed by e-mail, so existing accounts are untouched; school admins are never downgraded and an
    account of another school is refused (409).
  - It sets the claims `{tenantId, role}`, creates the Detective profile and enrols the user in the course mapped from the Moodle course.
  - It creates the assignment for the case the teacher chose (activity id `CASE01`…`CASE06`, must be approved for the school)
    and returns a Firebase custom token.
  - Web page `/lti-launch` signs in with that token and opens the case briefing with the assignment (students) or the class page (teachers).
- Grade sync to Moodle through the Hub: when grading completes (first results check after submission, or teacher regrade)
  and after a teacher review, the final percent (0–100) is sent for sessions of LTI assignments. Every outcome is logged in
  `tenants/{t}/lti_outbox`, and a failure never blocks grading or the request.
- Config: `LTI_ENABLED`, `LTI_HUB_URL`, `LTI_GAME_ID` (default `k26game2`), `LTI_TENANT_MAP` (`hubTenant=appTenant;…`), and
  `LTI_GAME_SECRET` (Secret Manager `unigamehub-secret-k26game2`, override with `LTI_SECRET_NAME`).
- `scripts/create-tenant.mts` creates a school for LMS use (built-in cases seeded, optionally approved; no admin account).
- `scripts/lti-preview.sh` with `firebase.preview.json` deploys a preview (Cloud Run `detective-api-lti-preview` and Hosting channel `lti`).
- `scripts/deploy.sh`: optional `FIREBASE_ACCOUNT` for firebase-tools.

### Changed
- Resuming an open investigation from an assignment link now attaches that assignment to the session; the briefing page's
  "Continue" button resumes through the API when the page was opened from an assignment.

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
