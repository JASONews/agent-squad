export type ErrorCode =
  | 'validation_error'
  | 'session_not_found'
  | 'subagent_not_found'
  | 'artifact_not_found'
  | 'alias_in_use'
  | 'unknown_cli_type'
  | 'adapter_unavailable'
  | 'permission_profile_unknown'
  | 'send_timeout'
  | 'internal_error';

const HTTP_STATUS: Record<ErrorCode, number> = {
  validation_error: 400,
  session_not_found: 404,
  subagent_not_found: 404,
  artifact_not_found: 404,
  alias_in_use: 409,
  unknown_cli_type: 400,
  adapter_unavailable: 503,
  permission_profile_unknown: 400,
  send_timeout: 504,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
  toHttp(): { status: number; body: { error: { code: ErrorCode; message: string } } } {
    return { status: HTTP_STATUS[this.code], body: { error: { code: this.code, message: this.message } } };
  }
}

export function asAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new AppError('internal_error', msg);
}

/** Map a better-sqlite3 SqliteError to an AppError. Foreign-key violations on a
 * session_id column become session_not_found; anything else is rethrown as-is
 * (via asAppError). Narrowed to SQLITE_CONSTRAINT_FOREIGNKEY so a hypothetical
 * PRIMARY-KEY / UNIQUE / NOT-NULL collision is not mis-mapped to a 404. */
export function mapSqliteError(e: unknown, sessionId?: string): AppError {
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'string' && code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    // FK violations on session_id fire when the referenced session doesn't exist.
    return new AppError('session_not_found', `session not found: ${sessionId ?? '(unknown)'}`);
  }
  return asAppError(e);
}
