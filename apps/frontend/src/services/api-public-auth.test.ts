import { describe, expect, it } from 'vitest'
import { isPublicAuthRequest, isPublicJitRequest, isLocalAclRecoveryRequest, isLocalWebhookRecoveryRequest, isLocalForwardingRecoveryRequest, isLocalHostImportRecoveryRequest, isLocalNetworkAccessRecoveryRequest } from './api-auth-classification'

describe('public API authentication isolation', () => {
  it('limits local error recovery to public JIT endpoints', () => {
    expect(isPublicJitRequest({ method: 'post', url: '/host-links/token/public-resolve' })).toBe(true)
    expect(isPublicJitRequest({ method: 'get', url: '/host-links/token/public-info' })).toBe(true)
    expect(isPublicJitRequest({ method: 'post', url: '/auth/login' })).toBe(false)
    expect(isPublicJitRequest({ method: 'get', url: '/host-links/token/resolve' })).toBe(false)
    expect(isPublicJitRequest({ method: 'get', url: '/host-links/token/public-resolve' })).toBe(false)
  })
  it('keeps JIT discovery and entry public even when the browser has an expired session', () => {
    expect(isPublicAuthRequest({ method: 'get', url: '/host-links/jit-token/public-info' })).toBe(true)
    expect(isPublicAuthRequest({ method: 'post', url: '/host-links/jit-token/public-resolve' })).toBe(true)
  })

  it('does not make authenticated host-link operations public', () => {
    expect(isPublicAuthRequest({ method: 'get', url: '/host-links/internal-token/resolve' })).toBe(false)
    expect(isPublicAuthRequest({ method: 'post', url: '/host-links' })).toBe(false)
    expect(isPublicAuthRequest({ method: 'delete', url: '/host-links/42' })).toBe(false)
  })

  it('does not allow a method swap to bypass authentication', () => {
    expect(isPublicAuthRequest({ method: 'post', url: '/host-links/jit-token/public-info' })).toBe(false)
    expect(isPublicAuthRequest({ method: 'get', url: '/host-links/jit-token/public-resolve' })).toBe(false)
  })
})


describe('ACL local retry isolation', () => {
  it.each(['/inventory/nodes/12/acl', '/inventory/nodes/12/acl/users', '/inventory/nodes/12/acl/impact-preview', '/inventory/nodes/12/acl/GROUP/3', '/inventory/nodes/12/effective-permissions/users/3', '/inventory/hosts/4/my-access'])('keeps %s authenticated while handling transient failures locally', url => {
    expect(isLocalAclRecoveryRequest({ url })).toBe(true)
    expect(isPublicAuthRequest({ url })).toBe(false)
  })
  it.each(['/users', '/auth/login', '/inventory/nodes/12', '/inventory/nodes/12/acl/unsupported'])('does not change global recovery for %s', url => {
    expect(isLocalAclRecoveryRequest({ url })).toBe(false)
  })
})

describe('webhook local recovery', () => {
  it.each(['/webhooks/subscriptions', '/webhooks/subscriptions/3/test', '/inbound-webhooks/endpoints', '/inbound-webhooks/endpoints/8/receipts?status=FAILED'])('keeps %s authenticated while allowing local retry', url => {
    expect(isLocalWebhookRecoveryRequest({ url })).toBe(true)
    expect(isPublicAuthRequest({ url })).toBe(false)
  })
  it.each(['/inbound-webhooks/monitoring/token', '/webhooks-other', '/hosts'])('does not change recovery for %s', url => {
    expect(isLocalWebhookRecoveryRequest({ url })).toBe(false)
  })
})

describe('forwarding local recovery', () => {
  it.each(['/forwardings', '/forwardings/7', '/tunnels', '/tunnels/id'])('keeps %s authenticated and handles errors locally', url => {
    expect(isLocalForwardingRecoveryRequest({ url })).toBe(true)
    expect(isPublicAuthRequest({ url })).toBe(false)
  })
})

describe('host import local recovery', () => {
  it.each(['/host-imports/preview', '/host-imports/commit', '/host-imports/history', '/host-imports/4/revert'])('keeps %s authenticated and preserves local dialog state', url => {
    expect(isLocalHostImportRecoveryRequest({ url })).toBe(true)
    expect(isPublicAuthRequest({ url })).toBe(false)
  })
})

describe('network access local recovery', () => {
  it.each(['/network-access', '/network-access/settings', '/network-access/credentials', '/network-access/grants', '/network-access/devices/1'])('preserves forms without making %s public', url => {
    expect(isLocalNetworkAccessRecoveryRequest({url})).toBe(true)
    expect(isPublicAuthRequest({url})).toBe(false)
  })
  it('does not affect another API namespace', () => expect(isLocalNetworkAccessRecoveryRequest({url:'/network-access-other'})).toBe(false))
})
