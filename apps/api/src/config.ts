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
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
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
}
