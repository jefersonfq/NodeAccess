import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { UpsertJiraSchema, UpsertLdapSchema, UpsertLocalAiSchema } from '@nodeaccess/shared';
import { encrypt, decrypt } from '../../shared/crypto.js';
import { env } from '../../config/env.js';
import { IntegrationService } from './integration.service.js';
import { LOCAL_AI_DEFAULTS } from './local-ai.service.js';
const trial = vi.hoisted(() => ({ integration: vi.fn(), capability: vi.fn() }));
vi.mock('../trials/trial-outbound.js', () => ({ assertTrialIntegration: trial.integration }));
vi.mock('../trials/trial-policy.js', () => ({ assertTrialCapability: trial.capability }));
type Row = {
    id: number;
    provider: string;
    enabled: boolean;
    config: string;
    updatedAt: Date;
};
function setup() {
    const rows = new Map<string, Row>();
    const put = (provider: string, config: object | string, enabled = true, tenant = 7) => {
        rows.set(`${tenant}:${provider}`, { id: 19, provider, enabled, config: typeof config === 'string' ? config : JSON.stringify(config), updatedAt: new Date() });
    };
    const config = (provider: string, tenant = 7): Record<string, unknown> => JSON.parse(rows.get(`${tenant}:${provider}`)!.config) as Record<string, unknown>;
    const repo = {
        listByTenant: vi.fn((tenant: number) => Promise.resolve().then(() => ([...rows.entries()].filter(([key]) => key.startsWith(`${tenant}:`)).map(([, row]) => row)))),
        findByProvider: vi.fn((tenant: number, provider: string) => Promise.resolve().then(() => (rows.get(`${tenant}:${provider}`) ?? null))),
        upsert: vi.fn((tenant: number, provider: string, enabled: boolean, value: string) => Promise.resolve().then(() => { put(provider, value, enabled, tenant); return rows.get(`${tenant}:${provider}`)!; })),
    };
    const entitlements = {
        requireIntegrationProvider: vi.fn(() => Promise.resolve().then(() => { })), requireFeature: vi.fn(() => Promise.resolve().then(() => { })),
        isSessionAuditAiLicensed: vi.fn(() => Promise.resolve().then(() => (true))),
        getSnapshot: vi.fn(() => Promise.resolve().then(() => (({ featureEntitlements: { integrations: true, localAi: true }, integrationEntitlements: { onepassword: true, google: true, ldap: true, jira: true } })))),
    };
    const result = { ok: true, healthStatus: 'healthy', healthMessage: 'connection verified' };
    const onePassword = { validateToken: vi.fn(() => Promise.resolve().then(() => { })), encryptToken: vi.fn((token: string) => JSON.stringify(encrypt(token))) };
    const google = { upsertConfig: vi.fn((_tenant: number, payload: object) => Promise.resolve().then(() => { put('google', payload); })), syncDirectory: vi.fn(() => Promise.resolve().then(() => (({ synced: 3, deactivated: 1 })))) };
    const ldap = {
        normalizeUrl: vi.fn((value: string) => value.trim()), validateSearchFilter: vi.fn((value: string) => value), encryptBindPassword: vi.fn(encrypt),
        decryptBindPassword: vi.fn((value: Record<string, string>) => decrypt({ encrypted: value.bindPasswordEncrypted!, iv: value.bindPasswordIv! })), testConnection: vi.fn(() => Promise.resolve().then(() => (result))),
    };
    const openai = {
        normalizeBaseUrl: vi.fn((value?: string) => value?.trim() || 'https://ai.example.invalid/v1'), encryptApiKey: vi.fn(encrypt),
        decryptApiKey: vi.fn((value: Record<string, string>) => decrypt({ encrypted: value.apiKeyEncrypted!, iv: value.apiKeyIv! })), testConnection: vi.fn(() => Promise.resolve().then(() => (result))),
    };
    const localAi = {
        normalizeBaseUrl: vi.fn((value?: string) => value?.trim() || null), encryptApiKey: vi.fn(encrypt), testConnection: vi.fn(() => Promise.resolve().then(() => (result))),
        proxyLocalEndpoint: vi.fn(() => Promise.resolve().then(() => (({ statusCode: 200, contentType: 'application/json', body: '{"models":[]}' })))),
    };
    const ticket = { key: 'OPS-1', url: 'https://jira.example.invalid/browse/OPS-1', summary: 'Investigate fixture host', status: 'Open', issueType: 'Task', projectKey: 'OPS', projectName: 'Operations', assigneeDisplayName: 'Fixture operator', labels: ['approved'], updatedAt: new Date() };
    const jira = {
        normalizeBaseUrl: vi.fn((value: string) => value.trim()), encryptApiToken: vi.fn(encrypt),
        decryptApiToken: vi.fn((value: Record<string, string>) => decrypt({ encrypted: value.apiTokenEncrypted!, iv: value.apiTokenIv! })),
        decryptOAuthAccessToken: vi.fn((value: Record<string, string>) => decrypt({ encrypted: value.oauthAccessTokenEncrypted!, iv: value.oauthAccessTokenIv! })),
        decryptOAuthRefreshToken: vi.fn((value: Record<string, string>) => decrypt({ encrypted: value.oauthRefreshTokenEncrypted!, iv: value.oauthRefreshTokenIv! })),
        capabilities: vi.fn(() => ({ comment: true, attachment: true, transition: true })),
        testConnection: vi.fn(() => Promise.resolve().then(() => (result))), testOAuthConnection: vi.fn(() => Promise.resolve().then(() => (result))),
        fetchTicket: vi.fn(() => Promise.resolve().then(() => (ticket))), fetchOAuthTicket: vi.fn(() => Promise.resolve().then(() => (ticket))),
        buildOAuthAuthorizationUrl: vi.fn((input: {
            state: string;
        }) => `https://auth.example.invalid/?state=${encodeURIComponent(input.state)}`),
        exchangeOAuthCode: vi.fn(() => Promise.resolve().then(() => (({ accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresIn: 3600, scope: 'read:jira-work offline_access' })))),
        fetchAccessibleResources: vi.fn(() => Promise.resolve().then(() => ([{ id: 'cloud-fixture', url: 'https://jira.example.invalid', name: 'Fixture site' }]))),
        refreshOAuthToken: vi.fn(() => Promise.resolve().then(() => (({ accessToken: 'fixture-next-access', refreshToken: 'fixture-next-refresh', expiresIn: 3600, scope: 'read:jira-work' })))),
    };
    const logs = { logAdminEvent: vi.fn(() => Promise.resolve().then(() => { })), findRecentAdminEventsByTarget: vi.fn(() => Promise.resolve().then(() => ([] as Array<{
            id: number;
            action: string;
            admin: {
                name: string;
            };
            timestamp: Date;
            details: string | null;
        }>))) };
    const ssh = { getUserGroupIds: vi.fn(() => Promise.resolve().then(() => ([5]))) }, inventory = { findAncestorIdsForHost: vi.fn(() => Promise.resolve().then(() => ([9]))) };
    const interactions = { upsert: vi.fn(() => Promise.resolve().then(() => { })), enqueue: vi.fn(() => Promise.resolve().then(() => { })), close: vi.fn(() => Promise.resolve().then(() => { })), findForUser: vi.fn(() => Promise.resolve().then(() => (({ id: 'interaction-1', state: 'OPEN', ticketKey: 'OPS-1' })))) };
    const service = new IntegrationService(repo as never, onePassword as never, google as never, ldap as never, openai as never, localAi as never, jira as never, entitlements as never, logs as never, ssh as never, inventory as never, interactions as never);
    return { service, rows, put, config, repo, entitlements, onePassword, google, ldap, openai, localAi, jira, logs, ssh, inventory, interactions, ticket };
}
const ldapDto = (extra: object = {}) => UpsertLdapSchema.parse({ enabled: true, url: 'ldaps://directory.example.invalid', baseDn: 'dc=example,dc=invalid', ...extra });
const localDto = (extra: object = {}) => UpsertLocalAiSchema.parse({ enabled: true, mode: 'read_only', routingPolicy: 'local_only', localProvider: 'ollama', localBaseUrl: 'http://127.0.0.1:11434', localModel: 'fixture-model', ...extra });
const jiraDto = (extra: object = {}) => UpsertJiraSchema.parse({ enabled: true, baseUrl: 'https://jira.example.invalid', serviceAccountEmail: 'fixture@example.invalid', apiToken: 'fixture-api-token', ...extra });
const healthy = () => ({ healthStatus: 'healthy', healthMessage: 'verified', lastCheckedAt: new Date().toISOString() });
function jiraConfig(extra: object = {}) { const token = encrypt('fixture-api-token'); return { authMode: 'api_token', baseUrl: 'https://jira.example.invalid', serviceAccountEmail: 'fixture@example.invalid', apiTokenEncrypted: token.encrypted, apiTokenIv: token.iv, ...healthy(), ...extra }; }
function oauthConfig(extra: object = {}) { const access = encrypt('fixture-access'), refresh = encrypt('fixture-refresh'); return { authMode: 'oauth', oauthAccessTokenEncrypted: access.encrypted, oauthAccessTokenIv: access.iv, oauthRefreshTokenEncrypted: refresh.encrypted, oauthRefreshTokenIv: refresh.iv, oauthCloudId: 'cloud-fixture', oauthSiteUrl: 'https://jira.example.invalid', oauthExpiresAt: new Date(Date.now() + 3600000).toISOString(), ...healthy(), ...extra }; }
const oauthEnv = { JIRA_CLIENT_ID: 'fixture-client', JIRA_CLIENT_SECRET: 'fixture-client-secret', JIRA_OAUTH_REDIRECT_URI: 'https://app.example.invalid/oauth', JIRA_BASE_URL: 'https://jira.example.invalid', JIRA_OAUTH_ALLOW_WRITE_SCOPES: false };
let originalEnv: typeof oauthEnv;
beforeEach(() => { trial.integration.mockReset().mockResolvedValue(null); trial.capability.mockReset().mockResolvedValue(null); originalEnv = Object.fromEntries(Object.keys(oauthEnv).map(k => [k, env[k as keyof typeof env]])) as typeof oauthEnv; Object.assign(env, oauthEnv); });
afterEach(() => { Object.assign(env, originalEnv); vi.restoreAllMocks(); });
describe('IntegrationService configuration boundaries', () => {
    it('lists only licensed tenant configuration and never credential material', async () => {
        const f = setup();
        f.put('onepassword', 'encrypted-opaque');
        f.put('jira', { secret: 'other-tenant' }, true, 8);
        const list = await f.service.list(7);
        expect(list).toHaveLength(6);
        expect(list.find(r => r.provider === 'onepassword')).toMatchObject({ enabled: true, hasToken: true });
        expect(list.find(r => r.provider === 'jira')).toMatchObject({ enabled: false, hasToken: false });
        expect(JSON.stringify(list)).not.toContain('encrypted-opaque');
        f.entitlements.getSnapshot.mockResolvedValue({ featureEntitlements: { integrations: false, localAi: false }, integrationEntitlements: { onepassword: false, google: false, ldap: false, jira: false } });
        f.put('openai', '{}');
        const restricted = await f.service.list(7);
        expect(restricted.filter(r => r.enabled).map(r => r.provider)).toEqual(['openai']);
        expect(restricted.find(r => r.provider === 'onepassword')!.updatedAt).toEqual(new Date(0));
    });
    it('requires and validates the initial 1Password token, preserves it on toggles and refuses denied licenses', async () => {
        const f = setup();
        await expect(f.service.upsertOnePassword(7, { enabled: true })).rejects.toThrow('obrigatório');
        expect(f.repo.upsert).not.toHaveBeenCalled();
        const result = await f.service.upsertOnePassword(7, { enabled: true, serviceAccountToken: 'fixture-service-token' });
        expect(result.hasToken).toBe(true);
        expect(f.onePassword.validateToken).toHaveBeenCalledWith('fixture-service-token', 7);
        const saved = f.rows.get('7:onepassword')!.config;
        expect(saved).not.toContain('fixture-service-token');
        await f.service.upsertOnePassword(7, { enabled: false });
        expect(f.rows.get('7:onepassword')!.config).toBe(saved);
        f.entitlements.requireIntegrationProvider.mockRejectedValue(new Error('license denied'));
        await expect(f.service.upsertOnePassword(7, { enabled: true, serviceAccountToken: 'replacement' })).rejects.toThrow('license denied');
        expect(f.onePassword.validateToken).toHaveBeenCalledTimes(1);
    });
    it('does not persist a rejected 1Password token', async () => { const f = setup(); f.onePassword.validateToken.mockRejectedValue(new Error('remote rejected')); await expect(f.service.upsertOnePassword(7, { enabled: true, serviceAccountToken: 'bad' })).rejects.toThrow('remote rejected'); expect(f.repo.upsert).not.toHaveBeenCalled(); });
    it('returns Google defaults, forwards optional settings, and scopes synchronization to tenant', async () => {
        const f = setup();
        expect(await f.service.getGoogleConfig(7)).toMatchObject({ enabled: false, clientId: null, syncIntervalMinutes: 60, hasServiceAccount: false });
        const dto = { enabled: true, clientId: 'client', adminEmail: 'admin@example.invalid', domain: 'example.invalid', syncIntervalMinutes: 15, autoProvision: false, serviceAccountJson: '{"fixture":true}' };
        await f.service.upsertGoogle(7, dto);
        expect(f.google.upsertConfig).toHaveBeenCalledWith(7, dto);
        expect(await f.service.syncGoogle(7)).toEqual({ synced: 3, deactivated: 1 });
        expect(f.google.syncDirectory).toHaveBeenCalledWith(7);
        await f.service.upsertGoogle(7, { enabled: false, clientId: 'minimal' });
        expect(f.google.upsertConfig).toHaveBeenLastCalledWith(7, { enabled: false, clientId: 'minimal' });
        f.put('google', { clientId: 'client', serviceAccountEncrypted: 'cipher', autoProvision: true });
        expect(await f.service.getGoogleConfig(7)).toMatchObject({ hasServiceAccount: true, autoProvision: true });
        f.put('google', '');
        expect((await f.service.getGoogleConfig(7)).clientId).toBeNull();
    });
    it('keeps LDAP anonymous access distinct from bind credentials and invalidates health after connection changes', async () => {
        const f = setup();
        expect(await f.service.getLdapConfig(7)).toMatchObject({ enabled: false, tlsRejectUnauthorized: true, hasBindPassword: false });
        await expect(f.service.upsertLdap(7, ldapDto({ bindDn: 'cn=service' }))).rejects.toThrow('Senha de bind');
        expect(f.repo.upsert).not.toHaveBeenCalled();
        await f.service.upsertLdap(7, ldapDto({ bindDn: ' cn=service ', bindPassword: ' fixture-bind ', startTls: true, autoProvision: true }));
        const saved = f.config('ldap');
        expect(f.ldap.decryptBindPassword(saved as Record<string, string>)).toBe('fixture-bind');
        expect(saved.bindDn).toBe('cn=service');
        expect(saved.healthStatus).toBe('unknown');
        f.put('ldap', { ...saved, ...healthy() });
        await f.service.upsertLdap(7, ldapDto({ bindDn: 'cn=service', startTls: true, autoProvision: false }));
        expect(f.config('ldap').healthStatus).toBe('healthy');
        await f.service.upsertLdap(7, ldapDto({ startTls: false, tlsRejectUnauthorized: false }));
        expect(f.config('ldap')).not.toHaveProperty('bindDn');
        expect(f.config('ldap').healthStatus).toBe('unknown');
    });
    it('updates LDAP health only when testing the saved endpoint and reuses encrypted bind credentials', async () => {
        const f = setup();
        await f.service.upsertLdap(7, ldapDto({ bindDn: 'cn=service', bindPassword: 'fixture-bind' }));
        f.repo.upsert.mockClear();
        expect((await f.service.testLdap(7, ldapDto({ bindDn: 'cn=service' }))).ok).toBe(true);
        expect(f.ldap.testConnection).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, bindPassword: 'fixture-bind', tlsRejectUnauthorized: true }));
        expect(f.config('ldap').healthStatus).toBe('healthy');
        f.repo.upsert.mockClear();
        await f.service.testLdap(7, ldapDto({ url: 'ldaps://unsaved.example.invalid' }));
        expect(f.repo.upsert).not.toHaveBeenCalled();
        await f.service.testLdap(8, ldapDto({ bindDn: 'cn=other', bindPassword: 'new-bind', startTls: true, tlsRejectUnauthorized: false }));
        expect(f.ldap.testConnection).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: 8, bindPassword: 'new-bind' }));
        expect(f.repo.upsert).not.toHaveBeenCalled();
    });
    it.each(['ldap', 'openai', 'local_ai', 'jira'])('treats corrupt %s configuration as unconfigured without exposing it', async (provider) => {
        const f = setup();
        f.put(provider, 'not-json');
        const value = provider === 'ldap' ? await f.service.getLdapConfig(7) : provider === 'openai' ? await f.service.getOpenAiConfig(7) : provider === 'local_ai' ? await f.service.getLocalAiConfig(7) : await f.service.getJiraConfig(7);
        expect(JSON.stringify(value)).not.toContain('not-json');
        expect(value.healthStatus).toBe('unknown');
    });
    it('encrypts OpenAI credentials, preserves them on policy-only changes and enforces licensing', async () => {
        const f = setup();
        expect(await f.service.getOpenAiConfig(7)).toMatchObject({ hasApiKey: false, defaultModel: null });
        await expect(f.service.upsertOpenAi(7, { enabled: true, defaultModel: 'fixture' })).rejects.toThrow('API key');
        await f.service.upsertOpenAi(7, { enabled: true, apiKey: 'fixture-openai-key', defaultModel: 'fixture', auditInstructions: ' redact credentials ' });
        const saved = f.config('openai');
        expect(f.openai.decryptApiKey(saved as Record<string, string>)).toBe('fixture-openai-key');
        expect(saved.auditInstructions).toBe('redact credentials');
        expect(JSON.stringify(await f.service.getOpenAiConfig(7))).not.toContain('fixture-openai-key');
        f.put('openai', { ...saved, ...healthy() });
        await f.service.upsertOpenAi(7, { enabled: true, defaultModel: 'fixture', baseUrl: String(saved.baseUrl) });
        expect(f.config('openai').healthStatus).toBe('healthy');
        await f.service.upsertOpenAi(7, { enabled: true, defaultModel: 'changed' });
        expect(f.config('openai').healthStatus).toBe('unknown');
        f.entitlements.isSessionAuditAiLicensed.mockResolvedValue(false);
        await expect(f.service.upsertOpenAi(7, { enabled: false, defaultModel: 'x' })).rejects.toThrow('Licença');
        await expect(f.service.testOpenAi(7)).rejects.toThrow('Licença');
    });
    it('tests stored OpenAI credentials without sending encrypted data or persisting plaintext', async () => {
        const f = setup();
        await expect(f.service.testOpenAi(7)).rejects.toThrow('não configurada');
        const token = encrypt('fixture-key');
        f.put('openai', { apiKeyEncrypted: token.encrypted, apiKeyIv: token.iv }, false);
        const tested = await f.service.testOpenAi(7);
        expect(tested.ok).toBe(true);
        expect(f.openai.testConnection).toHaveBeenCalledWith({ apiKey: 'fixture-key', tenantId: 7 });
        expect(f.rows.get('7:openai')!.enabled).toBe(false);
        expect(f.config('openai').healthStatus).toBe('healthy');
        expect(f.rows.get('7:openai')!.config).not.toContain('fixture-key');
    });
});
describe('IntegrationService local AI diagnostics and configuration', () => {
    it.each(['local_only', 'network_only', 'prefer_local', 'prefer_network'])('requires a usable endpoint before enabling %s', async (routingPolicy) => {
        const f = setup();
        const dto = UpsertLocalAiSchema.parse({ enabled: true, mode: 'read_only', routingPolicy });
        await expect(f.service.upsertLocalAi(7, dto)).rejects.toThrow(/Configura|Configure/);
        expect(f.repo.upsert).not.toHaveBeenCalled();
        await f.service.upsertLocalAi(7, { ...dto, enabled: false });
        expect(f.rows.get('7:local_ai')!.enabled).toBe(false);
    });
    it('encrypts network keys, preserves them for policy-only changes, and bounds trial requests', async () => {
        const f = setup();
        trial.capability.mockResolvedValue({ profileJson: { maxAiRequests: 40 } });
        await expect(f.service.upsertLocalAi(7, localDto({ monthlyRequestLimit: 41 }))).rejects.toThrow('Limite');
        expect(f.repo.upsert).not.toHaveBeenCalled();
        await f.service.upsertLocalAi(7, localDto({ routingPolicy: 'prefer_network', networkProvider: 'ollama', networkBaseUrl: 'https://ai.example.invalid', networkModel: 'fixture-network', networkApiKey: ' fixture-network-key ', auditInstructions: ' redact ', assistantInstructions: ' explain ', interactionRetentionDays: 14 }));
        const saved = f.config('local_ai');
        expect(saved.monthlyRequestLimit).toBe(40);
        expect(saved.interactionRetentionDays).toBe(14);
        expect(saved.auditInstructions).toBe('redact');
        expect(saved.assistantInstructions).toBe('explain');
        expect(decrypt({ encrypted: String(saved.networkApiKeyEncrypted), iv: String(saved.networkApiKeyIv) })).toBe('fixture-network-key');
        expect(JSON.stringify(await f.service.getLocalAiConfig(7))).not.toContain('fixture-network-key');
        f.put('local_ai', { ...saved, ...healthy() });
        await f.service.upsertLocalAi(7, localDto({ routingPolicy: 'prefer_network', networkProvider: 'ollama', networkBaseUrl: 'https://ai.example.invalid', networkModel: 'fixture-network' }));
        expect(f.config('local_ai').networkApiKeyEncrypted).toBe(saved.networkApiKeyEncrypted);
        expect(f.config('local_ai').healthStatus).toBe('healthy');
        await f.service.upsertLocalAi(7, localDto({ localModel: 'different' }));
        expect(f.config('local_ai').healthStatus).toBe('unknown');
    });
    it('applies default trial limit and disabled defaults without fabricating readiness', async () => {
        const f = setup();
        const absent = await f.service.getLocalAiConfig(7);
        expect(absent).toMatchObject({ enabled: false, localProvider: LOCAL_AI_DEFAULTS.localProvider, hasNetworkApiKey: false, interactionRetentionDays: 30, operational: false });
        trial.capability.mockResolvedValue({ profileJson: {} });
        await f.service.upsertLocalAi(7, localDto({ enabled: false, monthlyRequestLimit: null }));
        expect(f.config('local_ai').monthlyRequestLimit).toBe(100);
    });
    it.each(['local_only', 'network_only', 'prefer_local'])('evaluates configured routing and stale health for %s', async (routingPolicy) => {
        const f = setup();
        f.put('local_ai', { routingPolicy, localProvider: 'ollama', localBaseUrl: 'http://127.0.0.1:11434', localModel: 'fixture', networkProvider: 'ollama', networkBaseUrl: 'https://ai.example.invalid', networkModel: 'fixture', ...healthy() });
        expect((await f.service.getLocalAiConfig(7)).operational).toBe(true);
        f.put('local_ai', { ...f.config('local_ai'), lastCheckedAt: '2000-01-01T00:00:00Z' });
        expect(await f.service.getLocalAiConfig(7)).toMatchObject({ operational: false, readinessStatus: 'stale' });
    });
    it('persists failed diagnostic state and keeps admin logging best effort', async () => {
        const f = setup();
        f.localAi.testConnection.mockResolvedValue({ ok: false, healthStatus: 'unhealthy', healthMessage: 'connection refused' });
        f.logs.logAdminEvent.mockRejectedValue(new Error('log offline'));
        expect(await f.service.testLocalAi(7, 3)).toMatchObject({ ok: false, healthStatus: 'unhealthy' });
        expect(f.rows.get('7:local_ai')!.enabled).toBe(false);
        expect(f.config('local_ai').lastCheckedAt).toEqual(expect.any(String));
        expect(f.logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ adminId: 3, targetId: 0, action: 'TEST_LOCAL_AI' }));
        f.put('local_ai', { localBaseUrl: 'http://127.0.0.1:11434' });
        expect((await f.service.createLocalAiProxyLink(7, 3)).expiresIn).toBe('5m');
    });
    it('signs a tenant-scoped short-lived diagnostic link and rejects forged, expired or wrong-stage tokens', async () => {
        const f = setup();
        await expect(f.service.createLocalAiProxyLink(7, 3)).rejects.toThrow('Base URL');
        f.put('local_ai', { localBaseUrl: 'http://127.0.0.1:11434' });
        const link = await f.service.createLocalAiProxyLink(7, 3, '/api/tags');
        const token = new URL(link.url).searchParams.get('token')!;
        const payload = jwt.verify(token, env.JWT_SECRET) as jwt.JwtPayload;
        expect(payload).toMatchObject({ tenantId: 7, stage: 'local_ai_proxy', path: '/api/tags' });
        expect(payload.exp! - payload.iat!).toBe(300);
        expect(await f.service.proxyLocalAi(token)).toMatchObject({ statusCode: 200 });
        expect(f.localAi.proxyLocalEndpoint).toHaveBeenCalledWith('http://127.0.0.1:11434', '/api/tags', 7);
        expect(trial.capability).toHaveBeenCalledWith(7, 'localAi');
        for (const bad of ['forged', jwt.sign({ stage: 'other', tenantId: 7 }, env.JWT_SECRET), jwt.sign({ stage: 'local_ai_proxy', tenantId: 7 }, env.JWT_SECRET, { expiresIn: -1 })])
            await expect(f.service.proxyLocalAi(bad)).rejects.toThrow('inválido ou expirado');
        f.rows.delete('7:local_ai');
        await expect(f.service.proxyLocalAi(token)).rejects.toThrow('Base URL');
        expect(f.localAi.proxyLocalEndpoint).toHaveBeenCalledTimes(1);
    });
    it('maps activity only from the authorized tenant and integration target', async () => {
        const f = setup();
        expect(await f.service.getLocalAiRecentActivity(7)).toEqual([]);
        expect(f.logs.findRecentAdminEventsByTarget).not.toHaveBeenCalled();
        f.put('local_ai', {});
        f.logs.findRecentAdminEventsByTarget.mockResolvedValue([{ id: 1, action: 'TEST_LOCAL_AI', admin: { name: 'Fixture operator' }, timestamp: new Date('2026-01-01Z'), details: null }]);
        expect(await f.service.getLocalAiRecentActivity(7)).toEqual([{ id: 1, action: 'TEST_LOCAL_AI', adminName: 'Fixture operator', timestamp: '2026-01-01T00:00:00.000Z', details: null }]);
        expect(f.logs.findRecentAdminEventsByTarget).toHaveBeenCalledWith(7, 'Integration', 19, ['TEST_LOCAL_AI', 'OPEN_LOCAL_AI_DIAGNOSTIC'], 10);
    });
});
describe('IntegrationService Jira configuration and OAuth', () => {
    it('requires API credentials or retained OAuth and a nonempty selected enforcement scope', async () => {
        const f = setup();
        expect(await f.service.getJiraConfig(7)).toMatchObject({ enabled: false, authMode: null, hasApiToken: false, ticketEnforcementMode: 'off' });
        await expect(f.service.upsertJira(7, jiraDto({ apiToken: undefined }))).rejects.toThrow('API token');
        await expect(f.service.upsertJira(7, jiraDto({ ticketEnforcementMode: 'selected' }))).rejects.toThrow('Selecione');
        await f.service.upsertJira(7, jiraDto({ ticketEnforcementMode: 'selected', ticketUserIds: [3], closeTransitionId: '31' }));
        const saved = f.config('jira');
        expect(f.jira.decryptApiToken(saved as Record<string, string>)).toBe('fixture-api-token');
        expect(saved.ticketUserIds).toEqual([3]);
        expect(saved.closeTransitionId).toBe('31');
        expect(JSON.stringify(await f.service.getJiraConfig(7))).not.toContain('fixture-api-token');
        f.put('jira', { ...saved, ...healthy() });
        await f.service.upsertJira(7, jiraDto({ apiToken: undefined, ticketEnforcementMode: 'tenant' }));
        expect(f.config('jira')).toMatchObject({ healthStatus: 'healthy', ticketRequirement: 'required' });
        f.put('jira', oauthConfig());
        await f.service.upsertJira(7, jiraDto({ apiToken: undefined, serviceAccountEmail: undefined }));
        expect(f.config('jira').authMode).toBe('oauth');
    });
    it('tests API credentials and rejects unconfigured OAuth without contacting provider', async () => {
        const f = setup();
        await expect(f.service.testJira(7)).rejects.toThrow('não configurada');
        f.put('jira', jiraConfig());
        expect((await f.service.testJira(7)).ok).toBe(true);
        expect(f.jira.testConnection).toHaveBeenCalledWith({ apiToken: 'fixture-api-token', baseUrl: 'https://jira.example.invalid', serviceAccountEmail: 'fixture@example.invalid' });
        expect(f.config('jira').lastCheckedAt).toEqual(expect.any(String));
        f.put('jira', { authMode: 'oauth' });
        await expect(f.service.testJira(7)).rejects.toThrow('OAuth');
        expect(f.jira.testOAuthConnection).not.toHaveBeenCalled();
    });
    it('requests read-only OAuth by default and write scopes only when installation permits', async () => {
        const f = setup();
        const first = await f.service.beginJiraOAuth(7, 3, true);
        expect(first.expiresInSeconds).toBe(600);
        expect(f.jira.buildOAuthAuthorizationUrl).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ['offline_access', 'read:jira-work', 'read:jira-user'] }));
        const token = new URL(first.authorizationUrl).searchParams.get('state')!;
        expect(f.config('jira').pendingOAuthStateHash).not.toBe(token);
        expect(jwt.verify(token, env.JWT_SECRET)).toMatchObject({ tenantId: 7, userId: 3, stage: 'jira_oauth' });
        env.JIRA_OAUTH_ALLOW_WRITE_SCOPES = true;
        await f.service.beginJiraOAuth(7, 3, true);
        expect(f.jira.buildOAuthAuthorizationUrl).toHaveBeenLastCalledWith(expect.objectContaining({ scopes: ['offline_access', 'read:jira-work', 'read:jira-user', 'write:jira-work'] }));
        env.JIRA_CLIENT_ID = undefined;
        await expect(f.service.beginJiraOAuth(7, 3)).rejects.toThrow('não configurado');
        await expect(f.service.completeJiraOAuth('code', token)).rejects.toThrow('não configurado');
    });
    it('consumes OAuth state, encrypts tokens and rejects replay without another exchange', async () => {
        const f = setup();
        const link = await f.service.beginJiraOAuth(7, 3);
        const state = new URL(link.authorizationUrl).searchParams.get('state')!;
        const result = await f.service.completeJiraOAuth('fixture-code', state);
        expect(result).toEqual({ ok: true, siteName: 'Fixture site', scopes: ['read:jira-work', 'offline_access'] });
        const saved = f.config('jira');
        expect(saved).not.toHaveProperty('pendingOAuthStateHash');
        expect(f.jira.decryptOAuthAccessToken(saved as Record<string, string>)).toBe('fixture-access');
        expect(f.jira.decryptOAuthRefreshToken(saved as Record<string, string>)).toBe('fixture-refresh');
        expect(JSON.stringify(await f.service.getJiraConfig(7))).not.toContain('fixture-access');
        await expect(f.service.completeJiraOAuth('replay-code', state)).rejects.toThrow('já utilizado');
        expect(f.jira.exchangeOAuthCode).toHaveBeenCalledTimes(1);
    });
    it.each(['malformed', 'stage', 'tenant', 'nonce', 'expired-pending', 'different-hash'])('rejects invalid OAuth state %s before exchange', async (kind) => {
        const f = setup();
        const link = await f.service.beginJiraOAuth(7, 3);
        let state = new URL(link.authorizationUrl).searchParams.get('state')!;
        if (kind === 'malformed')
            state = 'not-a-jwt';
        if (kind === 'stage')
            state = jwt.sign({ stage: 'other', tenantId: 7, nonce: 'n' }, env.JWT_SECRET);
        if (kind === 'tenant')
            state = jwt.sign({ stage: 'jira_oauth', tenantId: '7', nonce: 'n' }, env.JWT_SECRET);
        if (kind === 'nonce')
            state = jwt.sign({ stage: 'jira_oauth', tenantId: 7 }, env.JWT_SECRET);
        if (kind === 'expired-pending')
            f.put('jira', { ...f.config('jira'), pendingOAuthExpiresAt: '2000-01-01Z' });
        if (kind === 'different-hash')
            f.put('jira', { ...f.config('jira'), pendingOAuthStateHash: 'invalid-hash' });
        await expect(f.service.completeJiraOAuth('code', state)).rejects.toThrow(/State OAuth/);
        expect(f.jira.exchangeOAuthCode).not.toHaveBeenCalled();
    });
    it('does not accept an unauthorized site and consumes state even when external authorization fails', async () => {
        const f = setup();
        const link = await f.service.beginJiraOAuth(7, 3);
        const state = new URL(link.authorizationUrl).searchParams.get('state')!;
        f.jira.fetchAccessibleResources.mockResolvedValue([]);
        await expect(f.service.completeJiraOAuth('code', state)).rejects.toThrow('não foi autorizado');
        expect(f.config('jira')).not.toHaveProperty('pendingOAuthStateHash');
        await expect(f.service.completeJiraOAuth('code', state)).rejects.toThrow('já utilizado');
    });
    it.each([true, false])('refreshes expiring OAuth and handles replacement refresh token=%s', async (replaceRefresh) => {
        const f = setup();
        const original = oauthConfig({ oauthExpiresAt: '2000-01-01Z', oauthScope: 'read:jira-work' });
        f.put('jira', original);
        f.jira.refreshOAuthToken.mockResolvedValue({ accessToken: 'next-access', refreshToken: replaceRefresh ? 'next-refresh' : '', expiresIn: 3600, scope: replaceRefresh ? 'new-scope' : '' });
        await f.service.testJira(7);
        const saved = f.config('jira');
        expect(f.jira.decryptOAuthAccessToken(saved as Record<string, string>)).toBe('next-access');
        expect(f.jira.decryptOAuthRefreshToken(saved as Record<string, string>)).toBe(replaceRefresh ? 'next-refresh' : 'fixture-refresh');
        expect(saved.oauthScope).toBe(replaceRefresh ? 'new-scope' : 'read:jira-work');
        expect(f.jira.testOAuthConnection).toHaveBeenCalledWith({ accessToken: 'next-access', cloudId: 'cloud-fixture' });
    });
    it('uses a valid access token without refresh, rejects missing refresh client and disconnects credentials', async () => {
        const f = setup();
        f.put('jira', oauthConfig());
        await f.service.testJira(7);
        expect(f.jira.refreshOAuthToken).not.toHaveBeenCalled();
        expect(f.jira.testOAuthConnection).toHaveBeenCalledWith({ accessToken: 'fixture-access', cloudId: 'cloud-fixture' });
        env.JIRA_CLIENT_SECRET = undefined;
        f.put('jira', oauthConfig({ oauthExpiresAt: undefined }));
        await expect(f.service.testJira(7)).rejects.toThrow('Cliente OAuth');
        env.JIRA_CLIENT_SECRET = oauthEnv.JIRA_CLIENT_SECRET;
        await f.service.disconnectJiraOAuth(7);
        expect(f.rows.get('7:jira')!.enabled).toBe(false);
        expect(f.config('jira')).not.toHaveProperty('oauthAccessTokenEncrypted');
        expect(f.config('jira')).not.toHaveProperty('authMode');
        f.put('jira', { ...jiraConfig(), ...oauthConfig() });
        await f.service.disconnectJiraOAuth(7);
        expect(f.config('jira').authMode).toBe('api_token');
    });
});
describe('IntegrationService Jira ticket and session boundaries', () => {
    it('normalizes and coalesces the same ticket while separating tenants', async () => {
        const f = setup();
        f.put('jira', jiraConfig({ projectKeys: ['OPS'] }));
        f.put('jira', jiraConfig(), true, 8);
        const [a, b] = await Promise.all([f.service.getJiraTicket(7, ' ops-1 '), f.service.getJiraTicket(7, 'OPS-1')]);
        expect(a.key).toBe('OPS-1');
        expect(b).toEqual(a);
        expect(f.jira.fetchTicket).toHaveBeenCalledTimes(1);
        expect(f.jira.fetchTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketKey: 'OPS-1' }));
        await f.service.getJiraTicket(8, 'OPS-1');
        expect(f.jira.fetchTicket).toHaveBeenCalledTimes(2);
        expect(f.repo.findByProvider).toHaveBeenCalledWith(8, 'jira');
        await expect(f.service.getJiraTicket(7, 'OTHER-1')).rejects.toThrow('fora dos projetos');
        expect(f.jira.fetchTicket).toHaveBeenCalledTimes(2);
    });
    it('fails closed for disabled, unhealthy or stale Jira before fetching tickets', async () => {
        for (const [enabled, extra] of [[false, {}], [true, { healthStatus: 'unhealthy' }], [true, { lastCheckedAt: '2000-01-01Z' }]] as const) {
            const f = setup();
            f.put('jira', jiraConfig(extra), enabled);
            await expect(f.service.getJiraTicket(7, 'OPS-1')).rejects.toThrow();
            expect(f.jira.fetchTicket).not.toHaveBeenCalled();
        }
    });
    it('fetches an OAuth ticket from the connected cloud and rejects a missing site', async () => {
        const f = setup();
        f.put('jira', oauthConfig());
        expect((await f.service.getJiraTicket(7, 'OPS-1')).key).toBe('OPS-1');
        expect(f.jira.fetchOAuthTicket).toHaveBeenCalledWith({ accessToken: 'fixture-access', cloudId: 'cloud-fixture', siteUrl: 'https://jira.example.invalid', ticketKey: 'OPS-1' });
        expect(f.jira.fetchTicket).not.toHaveBeenCalled();
        f.put('jira', oauthConfig({ oauthSiteUrl: undefined }));
        await expect(f.service.getJiraTicket(7, 'OPS-2')).rejects.toThrow('não configurada');
    });
    it.each([{ ticketUserIds: [3] }, { ticketGroupIds: [5] }, { ticketInventoryFolderIds: [9] }])('requires Jira for selected user, group or inventory ancestor %j', async (selector) => {
        const f = setup();
        f.put('jira', jiraConfig({ ticketEnforcementMode: 'selected', ...selector }));
        expect(await f.service.getJiraSessionPolicy(7, 3, 12)).toMatchObject({ enabled: true, required: true, ticketRequirement: 'required' });
        expect(f.ssh.getUserGroupIds).toHaveBeenCalledWith(3);
        expect(f.inventory.findAncestorIdsForHost).toHaveBeenCalledWith(12, 7);
        f.put('jira', jiraConfig({ ticketEnforcementMode: 'selected', ticketUserIds: [99] }));
        expect((await f.service.getJiraSessionPolicy(7, 3, 12)).required).toBe(false);
    });
    it('handles legacy tenant enforcement and an unavailable integration without requiring a ticket', async () => {
        const f = setup();
        f.put('jira', jiraConfig({ ticketRequirement: 'required', breakGlassEnabled: true }));
        expect(await f.service.getJiraSessionPolicy(7)).toEqual({ enabled: true, required: true, ticketRequirement: 'required', breakGlassEnabled: true });
        f.put('jira', jiraConfig({ ticketRequirement: 'required' }), false);
        expect(await f.service.getJiraSessionPolicy(7, 3, 12)).toEqual({ enabled: false, required: false, ticketRequirement: 'optional', breakGlassEnabled: false });
        const result = await f.service.authorizeJiraSession(7, 3, 12);
        expect(result.ticketKey).toBeNull();
        expect(jwt.verify(result.sessionGrant, env.JWT_SECRET)).toMatchObject({ stage: 'jira_session_grant', tenantId: 7, userId: 3, hostId: 12, ticketKey: null, breakGlass: false });
    });
    it.each([{ isAdmin: false, breakGlassReason: 'incident' }, { isAdmin: true, breakGlassReason: ' ' }, {}])('rejects missing required ticket unless every break-glass condition holds %j', async (options) => {
        const f = setup();
        f.put('jira', jiraConfig({ ticketEnforcementMode: 'tenant', breakGlassEnabled: true }));
        await expect(f.service.authorizeJiraSession(7, 3, 12, undefined, undefined, options)).rejects.toThrow('obrigatório');
        expect(f.interactions.upsert).not.toHaveBeenCalled();
    });
    it('audits an administrator emergency grant and binds it to the same tenant, user and host', async () => {
        const f = setup();
        f.put('jira', jiraConfig({ ticketEnforcementMode: 'tenant', breakGlassEnabled: true }));
        const result = await f.service.authorizeJiraSession(7, 3, 12, undefined, ' emergency-1 ', { isAdmin: true, breakGlassReason: ' restore availability ' });
        expect(result.interactionId).toBe('emergency-1');
        expect(f.interactions.upsert).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, userId: 3, hostId: 12, breakGlass: true, breakGlassReason: 'restore availability' }));
        expect(f.logs.logAdminEvent).toHaveBeenCalledWith(expect.objectContaining({ action: 'JIRA_BREAK_GLASS_USED', adminId: 3, targetId: 12 }));
        expect(jwt.verify(result.sessionGrant, env.JWT_SECRET)).toMatchObject({ tenantId: 7, userId: 3, hostId: 12, breakGlass: true });
        expect(f.jira.fetchTicket).not.toHaveBeenCalled();
    });
    it('validates ticket policy before storing the interaction and queues one idempotent start action', async () => {
        const f = setup();
        f.put('jira', jiraConfig({ allowedIssueTypes: ['Task'], allowedStatuses: ['Open'], requiredLabels: ['approved'], requireAssignee: true, maxTicketAgeHours: 24, publishStartComment: true }));
        const result = await f.service.authorizeJiraSession(7, 3, 12, ' ops-1 ', ' interaction-1 ');
        expect(result).toMatchObject({ ticketKey: 'OPS-1', ticketSummary: f.ticket.summary, ticketStatus: 'Open', interactionId: 'interaction-1' });
        expect(f.interactions.upsert).toHaveBeenCalledWith(expect.objectContaining({ ticketKey: 'OPS-1', ticketUrl: f.ticket.url, breakGlass: false }));
        expect(f.interactions.enqueue).toHaveBeenCalledWith({ tenantId: 7, interactionId: 'interaction-1', action: 'COMMENT_START', idempotencyKey: 'interaction-1:COMMENT_START', payload: { ticketKey: 'OPS-1', hostId: 12 } });
    });
    it.each([
        [{ allowedIssueTypes: ['Incident'] }, {}, 'Tipo'],
        [{ allowedStatuses: ['Closed'] }, {}, 'Status'],
        [{ requiredLabels: ['missing'] }, {}, 'labels'],
        [{ requireAssignee: true }, { assigneeDisplayName: null }, 'responsável'],
        [{ maxTicketAgeHours: 24 }, { updatedAt: null }, 'data de atualização'],
        [{ maxTicketAgeHours: 1 }, { updatedAt: new Date('2000-01-01Z') }, 'sem atualização'],
    ])('rejects a ticket that violates policy %j', async (policy, ticketPatch, message) => {
        const f = setup();
        f.put('jira', jiraConfig(policy));
        Object.assign(f.ticket, ticketPatch);
        await expect(f.service.authorizeJiraSession(7, 3, 12, 'OPS-1')).rejects.toThrow(String(message));
        expect(f.interactions.upsert).not.toHaveBeenCalled();
        expect(f.interactions.enqueue).not.toHaveBeenCalled();
    });
    it('scopes interaction lookup and queues only supported close actions before closing', async () => {
        const f = setup();
        expect((await f.service.getJiraInteraction(7, 3, 'interaction-1')).id).toBe('interaction-1');
        expect(f.interactions.findForUser).toHaveBeenCalledWith('interaction-1', 7, 3);
        f.put('jira', jiraConfig({ publishEndComment: true, attachAuditOnClose: true, transitionOnClose: true, closeTransitionId: '31' }));
        expect(await f.service.closeJiraInteraction(7, 3, 'interaction-1', '/audit/fixture')).toEqual({ ok: true, queuedActions: ['COMMENT_END', 'ATTACH_AUDIT', 'TRANSITION'] });
        expect(f.interactions.enqueue).toHaveBeenCalledTimes(3);
        expect(f.interactions.enqueue).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, idempotencyKey: 'interaction-1:TRANSITION', payload: { ticketKey: 'OPS-1', auditUrl: '/audit/fixture', transitionId: '31' } }));
        expect(f.interactions.close).toHaveBeenCalledWith('interaction-1', 7, 3);
        f.interactions.enqueue.mockClear();
        f.jira.capabilities.mockReturnValue({ comment: false, attachment: false, transition: false });
        expect((await f.service.closeJiraInteraction(7, 3, 'interaction-1', '/audit/fixture')).queuedActions).toEqual([]);
        expect(f.interactions.enqueue).not.toHaveBeenCalled();
        f.interactions.findForUser.mockResolvedValue(null);
        await expect(f.service.getJiraInteraction(7, 3, 'foreign')).rejects.toThrow('não encontrado');
        await expect(f.service.closeJiraInteraction(7, 3, 'foreign', '/audit')).rejects.toThrow('não está aberto');
    });
});
