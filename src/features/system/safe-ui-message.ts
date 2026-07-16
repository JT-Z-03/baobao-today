const INFRASTRUCTURE_DETAIL = /sqlite|constraint|typeerror|referenceerror|syntaxerror|file:\/\/|content:\/\/|\/data\/|\\|\n\s*at\s|notification identifier|client_request|create_payload_hash/i;

export function toSafeUiMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message || message.length > 120 || !/[\u3400-\u9fff]/.test(message) || INFRASTRUCTURE_DETAIL.test(message)) {
    return fallback;
  }
  return message;
}
