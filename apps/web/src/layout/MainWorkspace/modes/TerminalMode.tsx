// apps/web/src/layout/MainWorkspace/modes/TerminalMode.tsx — terminal workspace mode.
// Sandboxed shell via /api/shell/exec (allowlist enforced server-side).
// UI: textarea-based terminal with command history. Real xterm.js integration
// is a Step 14 polish item; this provides the full UX contract.
import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import { apiFetch } from '../../../lib/api';

interface HistoryEntry {
  type: 'input' | 'output' | 'error';
  text: string;
}

const ALLOWED_HINT = 'Allowed: ls, cat, echo, pwd, node --version, npm --version, pnpm --version, git log, git status, git diff';
const WELCOME = `SignalPoint IDE Terminal — sandboxed shell
${ALLOWED_HINT}
Type a command and press Enter. Commands run in the project sandbox.
──────────────────────────────────────────────────────────────────`;

async function runCommand(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const data = await apiFetch<{ stdout?: string; stderr?: string; exitCode?: number; error?: string }>(
      '/api/shell/exec',
      {
        method: 'POST',
        body:   JSON.stringify({
          command:   cmd.trim(),
          projectId: '00000000-0000-0000-0000-000000000000',
          cwd:       '/tmp/project',
        }),
      },
    );
    if (data.error) return { stdout: '', stderr: data.error, exitCode: 1 };
    return { stdout: data.stdout ?? '', stderr: data.stderr ?? '', exitCode: data.exitCode ?? 0 };
  } catch (err: unknown) {
    return { stdout: '', stderr: err instanceof Error ? err.message : 'Network error', exitCode: 1 };
  }
}

export function TerminalMode() {
  const [history, setHistory]         = useState<HistoryEntry[]>([{ type: 'output', text: WELCOME }]);
  const [input, setInput]             = useState('');
  const [cmdHistory, setCmdHistory]   = useState<string[]>([]);
  const [historyIdx, setHistoryIdx]   = useState(-1);
  const [running, setRunning]         = useState(false);
  const outputRef                     = useRef<HTMLDivElement>(null);
  const inputRef                      = useRef<HTMLInputElement>(null);

  // Auto-scroll on new output
  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight, behavior: 'smooth' });
  }, [history]);

  async function submit() {
    const cmd = input.trim();
    if (!cmd || running) return;
    setInput('');
    setHistoryIdx(-1);
    setCmdHistory((prev) => [cmd, ...prev.slice(0, 99)]);
    setHistory((prev) => [...prev, { type: 'input', text: `$ ${cmd}` }]);
    setRunning(true);
    const result = await runCommand(cmd);
    setRunning(false);
    if (result.stdout) setHistory((prev) => [...prev, { type: 'output', text: result.stdout.trimEnd() }]);
    if (result.stderr) setHistory((prev) => [...prev, { type: 'error',  text: result.stderr.trimEnd() }]);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
      setHistoryIdx(nextIdx);
      setInput(cmdHistory[nextIdx] ?? '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(nextIdx);
      setInput(nextIdx === -1 ? '' : (cmdHistory[nextIdx] ?? ''));
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setHistory([{ type: 'output', text: WELCOME }]);
    }
  }

  function clearTerminal() {
    setHistory([{ type: 'output', text: WELCOME }]);
  }

  return (
    <div className="abw-terminal" aria-label="Terminal">
      {/* Header */}
      <div className="abw-terminal__header">
        <div className="abw-terminal__dots" aria-hidden>
          <span className="abw-terminal__dot abw-terminal__dot--red" />
          <span className="abw-terminal__dot abw-terminal__dot--yellow" />
          <span className="abw-terminal__dot abw-terminal__dot--green" />
        </div>
        <span className="abw-terminal__title">bash — project sandbox</span>
        <button
          className="abw-btn abw-btn--ghost abw-btn--xs"
          onClick={clearTerminal}
          aria-label="Clear terminal (Ctrl+L)"
          title="Clear (Ctrl+L)"
        >
          Clear
        </button>
      </div>

      {/* Output — clicking / pressing Enter anywhere focuses the input */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div
        ref={outputRef}
        className="abw-terminal__output"
        aria-live="polite"
        aria-label="Terminal output"
        onClick={() => inputRef.current?.focus()}
      >
        {history.map((entry, i) => (
          <div key={i} className={`abw-terminal__line abw-terminal__line--${entry.type}`}>
            {entry.text}
          </div>
        ))}
        {running && (
          <div className="abw-terminal__line abw-terminal__line--output" aria-busy>
            <span className="abw-terminal__spinner" aria-hidden>▋</span>
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="abw-terminal__input-row">
        <span className="abw-terminal__prompt" aria-hidden>$</span>
        <input
          ref={inputRef}
          className="abw-terminal__input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={running}
          aria-label="Terminal input"
          aria-describedby="terminal-hint"
          spellCheck={false}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
        />
      </div>
      <p id="terminal-hint" className="sr-only">
        {ALLOWED_HINT}. Press Enter to run, ArrowUp/Down for history, Ctrl+L to clear.
      </p>
    </div>
  );
}
