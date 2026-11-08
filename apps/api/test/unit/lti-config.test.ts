import { describe, expect, it } from 'vitest';
import { assertSafeConfig, loadConfig, parseTenantMap } from '../../src/config.js';

describe('LTI config', () => {
  it('parses the tenant map from "a=b;c=d" or JSON', () => {
    expect(parseTenantMap('')).toEqual({});
    expect(parseTenantMap(' aiedu-local = demo-university ; aiedu2026=aiedu2026;broken ')).toEqual({ 'aiedu-local': 'demo-university', aiedu2026: 'aiedu2026' });
    expect(parseTenantMap('{"hub":"app"}')).toEqual({ hub: 'app' });
  });

  it('is off by default with this game id, and refuses to enable without Hub URL, secret and tenant map', () => {
    const cfg = loadConfig({ env: 'test', aiProvider: 'fake' });
    expect(cfg.ltiEnabled).toBe(false);
    expect(cfg.ltiGameId).toBe('k26game2');
    expect(() => assertSafeConfig({ ...cfg, ltiEnabled: true })).toThrow(/LTI_HUB_URL.*LTI_GAME_SECRET.*LTI_TENANT_MAP/);
    expect(() => assertSafeConfig({ ...cfg, ltiEnabled: true, ltiHubUrl: 'https://hub.test', ltiGameSecret: 'x'.repeat(32), ltiTenantMap: { a: 'b' } })).not.toThrow();
  });
});
