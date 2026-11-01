# API

Base: `https://k26-detective.web.app/api` (Hosting → Cloud Run `detective-api`). Every endpoint except `GET /api/health` needs
`Authorization: Bearer <Firebase ID token>` (accounts shared with English City Simulator). Errors:
`{ "error": { "code", "message", "details" } }` – codes in `ApiErrorCodes` (`packages/shared/src/platform.ts`).

## Student

| Method | Path | Body / notes |
|---|---|---|
| GET | `/me` · PATCH `/me` | profile (created on first visit for accounts made in Game 1) · `{locale?, level?, displayName?}` |
| GET | `/cases?level=` · `/cases/:id` | approved cases (no hidden data) + solved/best/activeSessionId |
| POST | `/sessions` | `{caseId, assignmentId?, restart?}` → start or **resume**; returns the investigation view |
| GET | `/sessions/:id` · `/sessions/:id/documents` | view: `{session, investigation, interviews, assistant, notebook, draft}` |
| POST | `/sessions/:id/briefing` | acknowledge the briefing |
| POST | `/sessions/:id/documents/:docId/open` | mark a document as read (locked → 409 LOCKED) |
| POST | `/sessions/:id/answers` | `{questionId, value}` – one attempt; objective answers marked right/wrong |
| POST | `/sessions/:id/highlights` | `{documentId, text}` → `result.kind` `evidence` (with label) or `clue` |
| DELETE | `/sessions/:id/clues/:clueId` | remove a personal clue |
| PUT/POST | `/sessions/:id/board` · `/sessions/:id/evidence` | `{items: {evidenceId: {category, note}}, links: [{a,b,note}]}` |
| POST | `/sessions/:id/conclusion` | `{optionId, supportingEvidenceIds[], justification}` |
| POST | `/sessions/:id/hint` | `{stage: documents|evidence|interviews|analysis|report}` → level 1–3 |
| POST | `/sessions/:id/interviews` | `{clientMessageId (uuid), characterId, question}` → `{message: {reply, unlockedDocumentIds…}, …view}` |
| POST | `/sessions/:id/assistant` | `{clientMessageId, stage, question}` → `{message: {answer, kind}}` |
| PUT | `/sessions/:id/notes` | `{text}` |
| PUT | `/sessions/:id/draft` | `{text, baseVersion}` → 409 `DRAFT_CONFLICT` with `details.current` if a newer draft exists |
| POST | `/sessions/:id/submit` | `{text, draftVersion}` → **202**; 409 `NOT_READY_TO_SUBMIT` with `details.blockers` |
| GET | `/sessions/:id/results` | `{status}` while grading; when graded `{assessment, report, solution, case}` |
| GET | `/student/progress` · `/student/courses` · `/leaderboard?courseId=` | dashboard; leaderboard shows game points only |

## Teacher (teacher, school_admin)

`GET /teacher/classes`, `GET /teacher/classes/:id`, `POST /teacher/assignments {courseId, caseId, dueAt, note}`,
`DELETE /teacher/assignments/:id`, `GET /teacher/students/:uid`, `GET /teacher/sessions/:id` (results),
`GET /teacher/sessions/:id/process` (investigation trail), `PUT /teacher/assessments/:id/review {scores: {reading?, evidence?,
criticalThinking?, writing?}, comment}`, `POST /teacher/assessments/:id/regrade`, `GET /teacher/export.csv?courseId=`.

## Case bank (teacher, school_admin)

`GET /admin/cases`, `GET /admin/cases/:id` (versions + consistency check), `PUT /admin/cases/:id {dossier, note}` (new draft),
`POST /admin/cases/:id/approve {version}` (refused if the check fails), `POST /admin/cases/:id/archive {archived}` (admin),
`POST /admin/cases/seed` (admin), `POST /admin/cases/generate {caseId, topic, level, learningObjectives, documentCount,
characterCount, minutes, writingType}` – AI Case Generator, creates a draft.

## School admin / platform

Same as Game 1: `/admin/users` (+ `/import`), `/admin/courses`, `/admin/settings`, `PUT /admin/ai-config`, `PUT /admin/quotas`,
`PUT /admin/school`, `POST /admin/health/ai`, `GET /admin/usage` (+ `.csv`), `GET /admin/audit-logs`, `GET /admin/reports/overview`,
`/platform/tenants`.

## LMS-AI9 / AI English Learning Portfolio

`GET /lms/v1/results?courseId=&since=&limit=` and `GET /lms/v1/evidence/:sessionId` (school_admin) return the **common K26
format** `k26-evidence-1.0` (also used by English City Simulator):

```json
{
  "schema": "k26-evidence-1.0",
  "evidenceId": "ed:<tenantId>:<sessionId>",
  "source": "english-detective",
  "learner": { "uid": "…", "email": "…", "studentCode": "SV001", "name": "…" },
  "courseId": "…",
  "activity": { "type": "investigation_case", "id": "CASE01", "version": 1, "title": "The Missing Scholarship", "level": "B1" },
  "skills": ["reading", "writing", "critical_thinking"],
  "result": {
    "completed": true, "aiPercent": 86, "finalPercent": 88, "scoreType": "ai_practice | teacher_validated",
    "criteria": { "reading": { "score": 23, "max": 25, "status": "assessed", "source": "engine+ai" } }
  },
  "feedback": { "strengths": [], "improvements": [], "nextPractice": [] },
  "timestamps": { "startedAt": "…", "completedAt": "…", "reviewedAt": null },
  "versions": { "rubric": "ed-rubric-1.0", "prompt": "ed-prompt-1.0", "model": "vertex:gemini-3-flash-preview", "caseVersion": 1 },
  "disclaimer": "AI-assisted learning feedback. This is not an official score."
}
```

AI scores are not pushed to the Moodle gradebook; LMS-AI9 decides what to import (`scoreType` distinguishes practice vs validated).
