// Only deliberately public rule errors may cross the transport boundary.
export class UserError extends Error {}
export function publicError(error) {
  return {message:error instanceof UserError ? error.message : '服务暂时不可用，请稍后重试。',
    ...(error instanceof UserError && ['ROOM_CLOSED','IDENTITY_REVOKED','CHAT_LIMITED'].includes(error.code) ? {code:error.code} : {})};
}
