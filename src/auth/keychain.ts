import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const TOKEN_EXPIRY_BUFFER_MS = 60_000; // Treat tokens as expired 60s early

export interface OAuthCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  subscriptionType: string;
}

/**
 * Parse raw keychain JSON into OAuthCredentials.
 * Returns null if the JSON is invalid or missing required fields.
 */
export function parseKeychainCredentials(raw: string): OAuthCredentials | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const oauth = obj['claudeAiOauth'];
  if (typeof oauth !== 'object' || oauth === null) return null;

  const oauthObj = oauth as Record<string, unknown>;
  const accessToken = oauthObj['accessToken'];
  const refreshToken = oauthObj['refreshToken'];
  const expiresAt = oauthObj['expiresAt'];
  const subscriptionType = oauthObj['subscriptionType'];

  if (typeof accessToken !== 'string' || !accessToken) return null;
  if (typeof refreshToken !== 'string') return null;
  if (typeof expiresAt !== 'number') return null;

  return {
    accessToken,
    refreshToken,
    expiresAt,
    subscriptionType: typeof subscriptionType === 'string' ? subscriptionType : 'unknown',
  };
}

/**
 * Check if an OAuth token is expired (or within the expiry buffer).
 */
export function isTokenExpired(credentials: OAuthCredentials): boolean {
  return Date.now() + TOKEN_EXPIRY_BUFFER_MS >= credentials.expiresAt;
}

/**
 * Read Claude Code OAuth credentials from macOS Keychain.
 * Returns null if not on macOS, keychain entry doesn't exist, or parsing fails.
 */
export async function readClaudeCodeCredentials(
  account?: string,
): Promise<OAuthCredentials | null> {
  if (process.platform !== 'darwin') return null;

  try {
    const acct = account ?? '';
    const cmd = acct
      ? `security find-generic-password -s "${KEYCHAIN_SERVICE}" -a "${acct}" -w`
      : `security find-generic-password -s "${KEYCHAIN_SERVICE}" -w`;

    const { stdout } = await execAsync(cmd, { timeout: 5000 });
    return parseKeychainCredentials(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Get a valid access token, reading from keychain.
 * Returns the token string or null if unavailable/expired.
 *
 * Note: Token refresh is not implemented — when the token expires,
 * Claude Code itself will refresh it on next launch. The user can
 * re-run `kairn init` if the token is stale.
 */
export async function getAccessToken(
  account?: string,
): Promise<string | null> {
  const creds = await readClaudeCodeCredentials(account);
  if (!creds) return null;
  if (isTokenExpired(creds)) return null;
  return creds.accessToken;
}
