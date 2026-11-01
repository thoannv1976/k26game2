import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import type { AiProvider } from '@ed/ai';
import { FakeAiProvider, VertexAiProvider } from '@ed/ai';
import type { AppConfig } from './config.js';
import type { ServiceTokenVerifier } from './serviceAuth.js';
import { adminAuth, firestore } from './firebase.js';

export interface Deps {
  config: AppConfig;
  db: Firestore;
  auth: Auth;
  ai: AiProvider;
  now: () => Date;
  /** Test hook: verifies Google service ID tokens (default: Google public keys). */
  serviceTokenVerifier?: ServiceTokenVerifier;
}

export function createDeps(config: AppConfig, overrides: Partial<Deps> = {}): Deps {
  return {
    config,
    db: overrides.db ?? firestore(config.projectId, config.firestoreDatabase),
    auth: overrides.auth ?? adminAuth(config.projectId),
    ai: overrides.ai ?? (config.aiProvider === 'vertex' ? new VertexAiProvider(config.projectId, config.vertexLocation) : new FakeAiProvider()),
    now: overrides.now ?? (() => new Date()),
    serviceTokenVerifier: overrides.serviceTokenVerifier,
  };
}
