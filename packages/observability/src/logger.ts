import { activeTraceFields } from './tracing';
import { currentCorrelation } from './context';

type LogSink = (line: string) => void;
type LogFields = Record<string, unknown>;

const sensitiveKey =
  /authorization|cookie|credential|password|secret|signature|token|api[-_]?key/i;
const sensitiveValue =
  /\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+\b|\bwhsec_[A-Za-z0-9]+\b|\bBearer\s+[^\s]+/gi;
const uriCredential = /([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi;

export class JsonLogger {
  constructor(
    private readonly service: string,
    private readonly sink: LogSink = (line) => process.stdout.write(line),
    private readonly errorSink: LogSink = (line) => process.stderr.write(line),
  ) {}

  log(message: unknown, ...optional: unknown[]): void {
    this.emit('info', message, optional);
  }

  info(event: string, fields: LogFields = {}): void {
    this.emit('info', event, [fields]);
  }

  error(message: unknown, ...optional: unknown[]): void {
    this.emit('error', message, optional);
  }

  warn(message: unknown, ...optional: unknown[]): void {
    this.emit('warn', message, optional);
  }

  debug(message: unknown, ...optional: unknown[]): void {
    this.emit('debug', message, optional);
  }

  verbose(message: unknown, ...optional: unknown[]): void {
    this.emit('debug', message, optional);
  }

  fatal(message: unknown, ...optional: unknown[]): void {
    this.emit('fatal', message, optional);
  }

  private emit(level: string, message: unknown, optional: unknown[]): void {
    const fields: LogFields = {};
    for (const value of optional) {
      if (value instanceof Error) {
        fields.error = value;
      } else if (isPlainObject(value)) {
        Object.assign(fields, value);
      } else if (typeof value === 'string') {
        fields.context ??= value;
      }
    }

    const event = typeof message === 'string' ? message : 'application.log';
    if (typeof message !== 'string') {
      fields.message = message;
    }
    const record = sanitize(
      {
        timestamp: new Date().toISOString(),
        level,
        service: this.service,
        event,
        ...currentCorrelation(),
        ...activeTraceFields(),
        ...fields,
      },
      '',
      0,
      environmentSecrets(),
    );
    const line = `${JSON.stringify(record)}\n`;
    (level === 'error' || level === 'fatal' ? this.errorSink : this.sink)(line);
  }
}

function sanitize(
  value: unknown,
  key: string,
  depth: number,
  secrets: string[],
): unknown {
  if (sensitiveKey.test(key)) {
    return '[REDACTED]';
  }
  if (depth > 8) {
    return '[TRUNCATED]';
  }
  if (typeof value === 'string') {
    let redacted = value
      .replace(sensitiveValue, '[REDACTED]')
      .replace(uriCredential, '$1[REDACTED]$2');
    for (const secret of secrets) {
      redacted = redacted.split(secret).join('[REDACTED]');
    }
    return redacted;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitize(value.message, 'errorMessage', depth + 1, secrets),
      stack: sanitize(value.stack, 'stack', depth + 1, secrets),
    };
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitize(item, key, depth + 1, secrets));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        sanitize(entryValue, entryKey, depth + 1, secrets),
      ]),
    );
  }
  return value;
}

function environmentSecrets(): string[] {
  return Object.entries(process.env)
    .filter(
      ([key, value]) =>
        sensitiveKey.test(key) &&
        typeof value === 'string' &&
        value.length >= 8,
    )
    .map(([, value]) => value!);
}

function isPlainObject(value: unknown): value is LogFields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
