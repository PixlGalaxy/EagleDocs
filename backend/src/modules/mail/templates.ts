function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface EmailParts {
  appName: string;
  intro: string;
  button?: { label: string; url: string };
  code?: { label: string; value: string };
  footer: string[];
}

/** One plain layout for every email: inline styles only, since mail clients drop <style>. */
export function renderEmail(parts: EmailParts): { html: string; text: string } {
  const e = escapeHtml;
  const button = parts.button
    ? `<p style="margin:28px 0"><a href="${e(parts.button.url)}" style="background:#0f62fe;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${e(parts.button.label)}</a></p>`
    : '';
  const code = parts.code
    ? `<p style="margin:0 0 6px;color:#52525b">${e(parts.code.label)}</p>
       <p style="margin:0 0 24px;font-size:30px;letter-spacing:8px;font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace">${e(parts.code.value)}</p>`
    : '';
  const footer = parts.footer.map((line) => `<p style="margin:6px 0;color:#71717a;font-size:13px">${e(line)}</p>`).join('');

  const html = `<!doctype html>
<html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">
  <div style="max-width:520px;margin:0 auto;padding:32px 16px">
    <div style="background:#ffffff;border-radius:16px;padding:32px;border:1px solid #e4e4e7">
      <p style="margin:0 0 20px;font-weight:700;font-size:18px">${e(parts.appName)}</p>
      <p style="margin:0 0 16px;line-height:1.55">${e(parts.intro)}</p>
      ${button}
      ${code}
      ${footer}
    </div>
  </div>
</body></html>`;

  const text = [
    parts.appName,
    '',
    parts.intro,
    parts.button ? `\n${parts.button.label}: ${parts.button.url}` : '',
    parts.code ? `\n${parts.code.label}: ${parts.code.value}` : '',
    '',
    ...parts.footer,
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  return { html, text };
}
