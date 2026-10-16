import { closeSync, existsSync, openSync, readSync, statSync, truncateSync } from 'fs';
import { logBuffer, type LogEntry } from '../../log-buffer.js';

const POLL_MS = 1000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

type Parsed = Omit<LogEntry, 'id'> | null;

/**
 * Follows a log file written by another process in the container (nginx, the
 * entrypoint) and feeds its lines into the log buffer, like `tail -f`. Off
 * Docker (Windows dev) the files never appear and this stays silent.
 */
function tail(path: string, parse: (line: string) => Parsed, after: Date): void {
  let offset: number | null = null;
  let carry = '';

  const poll = () => {
    if (!existsSync(path)) return;
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return;
    }
    const initial = offset === null;
    if (offset === null) offset = 0;
    if (size < offset) {
      offset = 0; // the file was replaced or truncated: start over
      carry = '';
    }
    if (size <= offset) return;

    const fd = openSync(path, 'r');
    try {
      const buffer = Buffer.alloc(size - offset);
      readSync(fd, buffer, 0, buffer.length, offset);
      offset = size;
      const lines = (carry + buffer.toString('utf-8')).split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        const parsed = parse(line.trimEnd());
        // On the first read, skip what a previous backend process already shipped.
        if (parsed && (!initial || new Date(parsed.time) > after)) logBuffer.push(parsed);
      }
    } finally {
      closeSync(fd);
    }
    // Everything up to here is already in the buffer. Both writers append
    // (O_APPEND), so emptying the file keeps /tmp from growing forever.
    if (size > MAX_FILE_BYTES) {
      try {
        truncateSync(path, 0);
        offset = 0;
      } catch {
        // Not ours to truncate (permissions): it is only disk space.
      }
    }
  };
  setInterval(poll, POLL_MS).unref();
}

// Mirrors nginx.conf's `studyhawk` log_format:
// $time_iso8601 $status $request_method $request_uri ${body_bytes_sent}b ${request_time}s "..."
const NGINX_LINE = /^(\S+) (\d{3}) (\S+) (\S+) \d+b ([\d.]+)s/;
// entrypoint.sh: `2026-10-13T22:09:01Z message`
const ENTRYPOINT_LINE = /^(\S+Z) (.+)$/;

/**
 * nginx's page and asset requests (FRONTEND) and the entrypoint's restart
 * notes (ENTRYPOINT). API requests are not in the nginx file: the backend's
 * own request logger already covers them.
 */
export function startFileTailers(lastShipped: Partial<Record<'FRONTEND' | 'ENTRYPOINT', Date>>): void {
  // Without a record (new node), only the last moments matter: e.g. why this backend was just restarted.
  const fallback = new Date(Date.now() - 30_000);

  tail(
    '/tmp/nginx-access.log',
    (line) => {
      const match = NGINX_LINE.exec(line);
      if (!match) return null;
      const [, time, status, method, uri, requestTime] = match;
      const code = Number(status);
      return {
        time: new Date(time!).toISOString(),
        channel: 'FRONTEND',
        level: code >= 500 ? 'ERROR' : code >= 400 ? 'WARN' : 'INFO',
        message: `${method} ${uri} ${status} ${(Number(requestTime) * 1000).toFixed(1)}ms`,
      };
    },
    lastShipped.FRONTEND ?? fallback,
  );

  tail(
    '/tmp/entrypoint.log',
    (line) => {
      const match = ENTRYPOINT_LINE.exec(line);
      if (!match) return null;
      const message = match[2]!;
      return {
        time: new Date(match[1]!).toISOString(),
        channel: 'ENTRYPOINT',
        level: /crash-looping|failed/i.test(message) ? 'ERROR' : /exited|restarting/i.test(message) ? 'WARN' : 'INFO',
        message,
      };
    },
    lastShipped.ENTRYPOINT ?? fallback,
  );
}
