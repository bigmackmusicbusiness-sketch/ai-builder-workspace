// apps/web/src/features/editor/MonacoEditor.tsx — Monaco editor wrapper.
// Theme follows the app token system. Cmd+S saves. Cmd+P opens file palette.
import { useCallback, useRef } from 'react';
import MonacoEditorReact, { type OnMount } from '@monaco-editor/react';
import type * as Monaco from 'monaco-editor';

interface MonacoEditorProps {
  fileId: string;
  path: string;
  content: string;
  language: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
}

// Map our token colors to a Monaco theme definition.
const ABW_THEME: Monaco.editor.IStandaloneThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0f1117',
    'editor.foreground': '#e2e8f0',
    'editorLineNumber.foreground': '#4a5568',
    'editorLineNumber.activeForeground': '#718096',
    'editor.selectionBackground': '#553c9a55',
    'editor.inactiveSelectionBackground': '#553c9a30',
    'editorCursor.foreground': '#7c3aed',
    'editor.lineHighlightBackground': '#ffffff08',
    'editorIndentGuide.background': '#1a202c',
    'editorIndentGuide.activeBackground': '#2d3748',
    'scrollbarSlider.background': '#4a556840',
    'scrollbarSlider.hoverBackground': '#4a556860',
  },
};

export function MonacoEditor({
  fileId,
  path,
  content,
  language,
  readOnly = false,
  onChange,
  onSave,
}: MonacoEditorProps) {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Register theme
      monaco.editor.defineTheme('abw-dark', ABW_THEME);
      monaco.editor.setTheme('abw-dark');

      // Cmd/Ctrl+S → save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave();
      });

      // Cmd/Ctrl+P → quick open file palette (stub; real integration in Step 6 file search)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyP, () => {
        // Will dispatch a custom event that FilesMode/FileTree picks up
        window.dispatchEvent(new CustomEvent('abw:open-file-palette'));
      });

      // Cmd/Ctrl+Shift+P → command palette (Monaco built-in)
      // Monaco exposes this via F1 by default; we can also add Ctrl+Shift+P:
      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyP,
        () => { editor.trigger('keyboard', 'editor.action.quickCommand', {}); },
      );

      // Focus the editor
      editor.focus();
    },
    [onSave],
  );

  return (
    <MonacoEditorReact
      height="100%"
      language={language}
      value={content}
      theme="abw-dark"
      onChange={(val) => onChange(val ?? '')}
      onMount={handleMount}
      path={path} // unique path key so Monaco tracks per-file undo history
      options={{
        readOnly,
        fontSize: 13,
        fontFamily: '"Fira Code", "Cascadia Code", "Consolas", monospace',
        fontLigatures: true,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: 'off',
        smoothScrolling: true,
        cursorSmoothCaretAnimation: 'on',
        renderLineHighlight: 'gutter',
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        glyphMargin: false,
        folding: true,
        lineNumbersMinChars: 4,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
        },
        suggest: { showWords: false },
        quickSuggestions: { other: true, comments: false, strings: false },
      }}
    />
  );
}
