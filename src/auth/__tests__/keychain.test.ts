import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseKeychainCredentials,
  isTokenExpired,
  type OAuthCredentials,
} from '../keychain.js';

describe('parseKeychainCredentials', () => {
  it('extracts OAuth credentials from valid keychain JSON', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-test-token',
        refreshToken: 'sk-ant-ort01-test-refresh',
        expiresAt: Date.now() + 3600000,
        scopes: ['user:inference'],
        subscriptionType: 'max',
        rateLimitTier: 'default_claude_max_20x',
      },
    });

    const creds = parseKeychainCredentials(raw);
    expect(creds).not.toBeNull();
    expect(creds!.accessToken).toBe('sk-ant-oat01-test-token');
    expect(creds!.refreshToken).toBe('sk-ant-ort01-test-refresh');
    expect(creds!.subscriptionType).toBe('max');
  });

  it('returns null for invalid JSON', () => {
    expect(parseKeychainCredentials('not json')).toBeNull();
  });

  it('returns null when claudeAiOauth is missing', () => {
    const raw = JSON.stringify({ mcpOAuth: {} });
    expect(parseKeychainCredentials(raw)).toBeNull();
  });

  it('returns null when accessToken is missing', () => {
    const raw = JSON.stringify({
      claudeAiOauth: {
        refreshToken: 'sk-ant-ort01-test',
        expiresAt: Date.now() + 3600000,
      },
    });
    expect(parseKeychainCredentials(raw)).toBeNull();
  });

  it('extracts expiresAt as a number', () => {
    const expiry = Date.now() + 7200000;
    const raw = JSON.stringify({
      claudeAiOauth: {
        accessToken: 'sk-ant-oat01-test',
        refreshToken: 'sk-ant-ort01-test',
        expiresAt: expiry,
        subscriptionType: 'max',
      },
    });

    const creds = parseKeychainCredentials(raw);
    expect(creds!.expiresAt).toBe(expiry);
  });
});

describe('isTokenExpired', () => {
  it('returns false when token expires in the future', () => {
    const creds: OAuthCredentials = {
      accessToken: 'sk-ant-oat01-test',
      refreshToken: 'sk-ant-ort01-test',
      expiresAt: Date.now() + 3600000,
      subscriptionType: 'max',
    };
    expect(isTokenExpired(creds)).toBe(false);
  });

  it('returns true when token expired in the past', () => {
    const creds: OAuthCredentials = {
      accessToken: 'sk-ant-oat01-test',
      refreshToken: 'sk-ant-ort01-test',
      expiresAt: Date.now() - 1000,
      subscriptionType: 'max',
    };
    expect(isTokenExpired(creds)).toBe(true);
  });

  it('returns true when token expires within 60s buffer', () => {
    const creds: OAuthCredentials = {
      accessToken: 'sk-ant-oat01-test',
      refreshToken: 'sk-ant-ort01-test',
      expiresAt: Date.now() + 30000, // 30s from now, within 60s buffer
      subscriptionType: 'max',
    };
    expect(isTokenExpired(creds)).toBe(true);
  });
});
