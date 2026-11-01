# DATABASE – Firestore database `detective`

English Detective uses the Firestore database **`detective`** (Native mode, `asia-southeast1`) in the shared project; English City
Simulator uses `(default)`. Types: `packages/shared/src/platform.ts`, `packages/shared/src/case.ts`, `apps/api/src/types.ts`.

```
tenants/{tenantId}                             name, allowedEmailDomains, quotas, aiConfig, active   (same id as in Game 1)
  users/{uid}                                  role, email, displayName, studentCode, courseIds, level, xp, detectivePoints,
                                               completedCaseIds, bestPercent, achievements, locale, disabled
  courses/{id}  assignments/{id}               classes and assigned cases (caseId, dueAt)
  cases/{caseId}                               approvedVersion, latestVersion, status draft|approved|archived, title
    versions/{n}                               dossier (Canonical Case Dossier), status, source builtin|teacher|ai_generated,
                                               createdBy, approvedBy, note                          – server only
  investigation_sessions/{sid}                 uid, caseId, caseVersion, status active|submitted|grading|graded|abandoned,
                                               state (engine state: opened docs, revealed facts, answers, collected evidence,
                                               clues, board, links, conclusion, hints, interview counts), lock, gradingAttempts
    interview_messages/{clientMessageId}       characterId, question, reply, factsRevealed, unlockedDocumentIds, fallback, blocked
    assistant_messages/{clientMessageId}       stage, question, answer, kind
    investigation_notes/notebook               text
    drafts/current                             text, version, wordCount
  final_reports/{sid}                          text, wordCount, submittedAt
  assessments/{sid}                            criteria (reading/evidence/criticalThinking/writing), writingParts, evidence breakdown,
                                               conclusion result, feedback, recommendation, gamePoints, versions, teacherReview
  usage_counters/{id}  usage_logs/{id}  audit_logs/{id}
platform_audit_logs/{id}
```

Mapping to the spec's collections: `case_documents`, `case_characters`, `case_evidence` live inside `cases/{id}/versions/{n}.dossier`
(versioned together); `investigation_notes` = `investigation_sessions/{sid}/investigation_notes/notebook`.

- IDs prevent duplicates: interview/assistant messages use the client-generated id; assessments use the session id.
- Arrays of arrays are not allowed in Firestore (dossier links are objects `{a, b}`).
- Indexes: `firebase/firestore.indexes.json` (deployed with `firebase deploy --only firestore`).
- Data deletion: Admin → Users → delete data removes sessions (with subcollections), reports, assessments, counters, profile and the
  login account. **The login account is shared with Game 1** – deleting it removes access to both games.
