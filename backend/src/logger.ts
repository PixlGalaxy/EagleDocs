import { logBuffer, type LogEntry } from './log-buffer.js';

type Level = LogEntry['level'];
type Channel = LogEntry['channel'];

// The container prefixes nginx output with [FRONTEND], so `docker logs` reads as one stream.
function write(channel: Channel, level: Level, rawMessage: string, detail?: unknown) {
  // Parts of a message come from clients (usernames, emails): strip control
  // characters so a crafted value cannot forge extra log lines.
  const message = rawMessage.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  const time = new Date().toISOString();
  const line = `[${channel}] ${time} ${level.padEnd(5)} ${message}`;
  logBuffer.push({
    time,
    channel,
    level,
    message: detail instanceof Error ? `${message} ${detail.message}` : message,
  });
  const stream = level === 'ERROR' ? console.error : level === 'WARN' ? console.warn : console.log;
  if (detail === undefined) stream(line);
  else stream(line, detail);
}

const channel = (name: Channel) => ({
  info: (message: string) => write(name, 'INFO', message),
  warn: (message: string) => write(name, 'WARN', message),
});

export const logger = {
  info: (message: string, detail?: unknown) => write('BACKEND', 'INFO', message, detail),
  warn: (message: string, detail?: unknown) => write('BACKEND', 'WARN', message, detail),
  error: (message: string, detail?: unknown) => write('BACKEND', 'ERROR', message, detail),
  /** Sign-ins, sign-ups, verifications and password changes. */
  auth: channel('AUTH'),
  /** Admin changes to users, institutions and settings. */
  system: channel('SYSTEM'),
};
