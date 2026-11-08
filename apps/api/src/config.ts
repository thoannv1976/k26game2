/** Runtime configuration from environment variables (see .env.example). */
export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  projectId: string;
  /** Firestore database id. English Detective uses its own database ("detective") in the shared project. */
  firestoreDatabase: string;
  vertexLocation: string;
  geminiModel: string | null; // overrides the school's aiConfig.model when set
  aiProvider: 'vertex' | 'fake';
  aiTimeoutMs: number;
  gradingTimeoutMs: number;
  aiMaxRetries: number;
  logLevel: string;
  /** Requests per minute per user (rate limit). */
  rateLimitPerMinute: number;
  /** D4: service accounts (e.g. vstep-api@…) allowed to read learner evidence; empty = disabled. */
  lmsServiceAccounts: string[];
  lmsServiceAudience: string;
  /** UniGame Hub (LTI 1.3) single sign-on + grade sync. Off unless LTI_ENABLED=true. */
  ltiEnabled: boolean;
  ltiHubUrl: string;
  ltiGameId: string;
  ltiGameSecret: string;
  /** Hub tenant id -> this app's tenant id, e.g. {"aiedu-local":"demo-university"}. */
  ltiTenantMap: Record<string, string>;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

/** "hubTenant=appTenant;hub2=app2" (deploy-friendly) or a JSON object. */
export function parseTenantMap(v: string): Record<string, string> {
  const s = v.trim();
  if (!s) return {};
  if (s.startsWith('{')) return JSON.parse(s) as Record<string, string>;
  return Object.fromEntries(
    s.split(';').map((pair) => pair.split('=').map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]) as [string, string][],
  );
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = str('NODE_ENV', 'development') as AppConfig['env'];
  const prod = env === 'production';
  const cfg: AppConfig = {
    env,
    port: Number(str('PORT', '8080')),
    projectId: str('GCP_PROJECT_ID', str('GOOGLE_CLOUD_PROJECT', str('GCLOUD_PROJECT', 'demo-ed'))),
    firestoreDatabase: str('FIRESTORE_DATABASE', 'detective'),
    vertexLocation: str('VERTEX_LOCATION', 'global'),
    geminiModel: process.env.GEMINI_MODEL || null,
    aiProvider: str('AI_PROVIDER', prod ? 'vertex' : 'fake') as AppConfig['aiProvider'],
    aiTimeoutMs: Number(str('AI_TIMEOUT_MS', '20000')),
    gradingTimeoutMs: Number(str('GRADING_TIMEOUT_MS', '60000')),
    aiMaxRetries: Number(str('AI_MAX_RETRIES', '2')),
    logLevel: str('LOG_LEVEL', prod ? 'info' : 'debug'),
    rateLimitPerMinute: Number(str('RATE_LIMIT_PER_MINUTE', '240')),
    lmsServiceAccounts: str('LMS_SERVICE_ACCOUNTS', '').split(',').map((x) => x.trim()).filter(Boolean),
    lmsServiceAudience: str('LMS_SERVICE_AUDIENCE', 'k26-lms'),
    ltiEnabled: str('LTI_ENABLED', 'false') === 'true',
    ltiHubUrl: str('LTI_HUB_URL', '').replace(/\/+$/, ''),
    ltiGameId: str('LTI_GAME_ID', 'k26game2'),
    ltiGameSecret: str('LTI_GAME_SECRET', ''),
    ltiTenantMap: parseTenantMap(str('LTI_TENANT_MAP', '')),
    ...overrides,
  };
  assertSafeConfig(cfg);
  return cfg;
}

/** The offline (fake) AI provider exists for development and tests only. */
export function assertSafeConfig(cfg: AppConfig): void {
  if (cfg.env === 'production' && cfg.aiProvider !== 'vertex') {
    throw new Error('Refusing to start in production with offline providers: AI_PROVIDER');
  }
  if (cfg.ltiEnabled) {
    const missing: string[] = [];
    if (!cfg.ltiHubUrl.startsWith('https://')) missing.push('LTI_HUB_URL (https)');
    if (cfg.ltiGameSecret.length < 32) missing.push('LTI_GAME_SECRET');
    if (Object.keys(cfg.ltiTenantMap).length === 0) missing.push('LTI_TENANT_MAP');
    if (missing.length) throw new Error(`LTI_ENABLED=true but missing: ${missing.join(', ')}`);
  }
}
