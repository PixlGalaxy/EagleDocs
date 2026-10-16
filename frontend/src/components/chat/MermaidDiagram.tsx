import { useEffect, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';

type Mermaid = typeof import('mermaid').default;

let mermaid: Promise<Mermaid> | null = null;
let counter = 0;

/** Loaded the first time an answer has a diagram (it is large). */
const loadMermaid = () => (mermaid ??= import('mermaid').then((m) => m.default));

/**
 * A ```mermaid block drawn as a diagram. The SVG is shown as an image, so it
 * cannot run scripts or load anything (the agent's text is untrusted), and
 * labels are plain SVG text for the same reason. While it loads, while the
 * answer is still arriving, or if the code is wrong, the code is shown instead.
 */
const MermaidDiagram = ({ code }: { code: string }) => {
  const { mode } = useTheme();
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Waits for the code to stop changing (a streaming answer) before drawing.
    const timer = setTimeout(() => {
      void loadMermaid()
        .then(async (m) => {
          m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: mode === 'dark' ? 'dark' : 'default', htmlLabels: false, flowchart: { htmlLabels: false } });
          const { svg: drawn } = await m.render(`mermaid-${++counter}`, code);
          if (!cancelled) setSvg(drawn);
        })
        .catch(() => {
          if (!cancelled) setSvg(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, mode]);

  if (!svg) {
    return (
      <pre>
        <code className="language-mermaid">{code}</code>
      </pre>
    );
  }
  return (
    <img
      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
      alt="Diagram"
      className="my-2 max-w-full rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
    />
  );
};

export default MermaidDiagram;
