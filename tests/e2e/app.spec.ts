import { expect, test, type Page } from '@playwright/test';
import CASE01 from '../../content/cases/CASE01.json' with { type: 'json' };

const PASSWORD = 'Demo-12345';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).not.toHaveURL(/\/login/);
}

const waitApi = (page: Page, part: string, method = 'POST') =>
  page.waitForResponse((r) => r.url().includes(part) && r.request().method() === method && r.status() < 400);

test.describe.configure({ mode: 'serial' });

test('student solves CASE01 end to end', async ({ page }) => {
  await login(page, 'student1@demo.edu.vn');
  await expect(page).toHaveURL(/\/office/);
  await expect(page.getByTestId('office')).toBeVisible();
  await page.getByTestId('case-card-CASE01').click();
  const cont = page.getByTestId('case-continue');
  const start = page.getByTestId('case-start');
  await expect(cont.or(start).first()).toBeVisible();
  await ((await cont.isVisible()) ? cont : start).click();
  await expect(page).toHaveURL(/\/investigate\//);
  // The briefing dialog renders together with the workspace; wait for the workspace before checking for it,
  // otherwise isVisible() (which does not wait) can run too early and the dialog later blocks every click.
  await expect(page.getByTestId('tab-interviews')).toBeVisible();
  const ack = page.getByTestId('briefing-ack');
  if (await ack.isVisible()) {
    await ack.click();
    await expect(ack).toBeHidden();
  }

  // Interviews (unlock the IT report).
  await page.getByTestId('tab-interviews').click();
  for (const iq of CASE01.sampleSolution.interviewQuestions) {
    await page.getByTestId(`character-${iq.characterId}`).click();
    await page.getByTestId('interview-input').fill(iq.question);
    const r = waitApi(page, '/interviews');
    await page.getByTestId('interview-send').click();
    await r;
    await expect(page.getByTestId('interview-reply')).toBeVisible();
  }

  // Evidence via sentence-select mode (works without mouse selection).
  await page.getByTestId('tab-documents').click();
  for (const h of CASE01.sampleSolution.highlights) {
    await page.getByTestId(`doc-item-${h.documentId}`).click();
    await expect(page.getByTestId(`doc-item-${h.documentId}`)).toHaveAttribute('data-locked', 'false');
    const toggle = page.getByTestId('select-mode-toggle');
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    // Select mode: tap the sentence, then save it as evidence.
    const chip = page.getByTestId('sentence-chip').filter({ hasText: h.text.replace(/\.$/, '').slice(0, 40) }).first();
    await chip.click();
    const r = waitApi(page, '/highlights');
    await page.getByTestId('save-evidence').click();
    await r;
  }

  // Reading questions.
  await page.getByTestId('tab-questions').click();
  for (const q of CASE01.questions) {
    const box = page.getByTestId(`question-${q.id}`);
    // Wait for the card first: isVisible() does not wait, so checking right after the tab switch skipped
    // questions that had not rendered yet and left required ones unanswered (submit stayed disabled).
    await expect(box).toBeVisible();
    if ((await page.getByTestId(`question-submit-${q.id}`).count()) === 0) continue; // already answered (resumed session)
    const value = (CASE01.sampleSolution.answers as Record<string, string | number>)[q.id]!;
    if (q.type === 'mcq') await box.getByRole('radio').nth(value as number).check();
    else if (q.type === 'tfng') await box.getByRole('radio').nth(['true', 'false', 'not_given'].indexOf(String(value))).click();
    else await box.locator('input, textarea').first().fill(String(value));
    const r = waitApi(page, '/answers');
    await page.getByTestId(`question-submit-${q.id}`).click();
    await page.getByTestId('question-confirm').click();
    await r;
  }

  // Case Board: categorize, conclusion.
  await page.getByTestId('tab-board').click();
  for (const h of CASE01.sampleSolution.highlights) {
    const cat = CASE01.evidence.find((e) => e.id === h.evidenceId)!.category;
    await page.getByTestId(`move-${h.evidenceId}`).selectOption(cat);
  }
  const saved = waitApi(page, '/board', 'PUT');
  await page.getByTestId('board-save').click();
  await saved;
  await page.getByTestId(`conclusion-option-${CASE01.sampleSolution.conclusion.optionId}`).check();
  for (const id of CASE01.sampleSolution.conclusion.supportingEvidenceIds) await page.getByTestId(`support-${id}`).check();
  await page.getByTestId('conclusion-justification').fill(CASE01.sampleSolution.conclusion.justification);
  const concl = waitApi(page, '/conclusion');
  await page.getByTestId('conclusion-save').click();
  await concl;

  // Report.
  await page.getByTestId('tab-report').click();
  await page.getByTestId('report-editor').fill(CASE01.sampleSolution.report);
  await expect(page.getByTestId('report-wordcount')).toContainText(/1[5-9]\d/);
  await page.getByTestId('report-submit').click();
  // Fails fast with the dialog's blocker list instead of a 2-minute click timeout.
  await expect(page.getByTestId('submit-confirm')).toBeEnabled();
  const sub = waitApi(page, '/submit');
  await page.getByTestId('submit-confirm').click();
  await sub;
  await expect(page).toHaveURL(/\/results\//, { timeout: 30_000 });
  await expect(page.getByTestId('results-percent')).toContainText('%', { timeout: 60_000 });
  await expect(page.getByTestId('criterion-evidence')).toBeVisible();
});

test('teacher sees the class and exports CSV', async ({ page }) => {
  await login(page, 'teacher@demo.edu.vn');
  await expect(page).toHaveURL(/\/teacher/);
  await page.getByTestId('teacher-class-eng-comm-1').click();
  await expect(page.getByText('Trần Minh Anh').first()).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-csv').click();
  expect((await dl).suggestedFilename()).toMatch(/\.csv$/);
});

test('school admin sees the case bank', async ({ page }) => {
  await login(page, 'admin@demo.edu.vn');
  await expect(page).toHaveURL(/\/admin/);
  await page.goto('/admin/cases');
  await expect(page.getByTestId('cases-admin-row-CASE06')).toBeVisible();
});

test('students cannot open admin pages', async ({ page }) => {
  await login(page, 'student2@demo.edu.vn');
  await page.goto('/admin/users');
  await expect(page.getByText('student1@demo.edu.vn')).toHaveCount(0);
});

test('office works on a phone @mobile', async ({ page }) => {
  await login(page, 'student3@demo.edu.vn');
  await expect(page.getByTestId('office')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
