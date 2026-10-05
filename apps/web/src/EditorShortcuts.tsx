export default function EditorShortcuts() {
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <details className="editor-shortcuts" id="rich-editor-help">
      <summary>Formatting shortcuts</summary>
      <p>
        Type ~ and a space for the style menu. Use arrow keys to choose a style
        and Enter to apply it. Highlight text for quick formatting. Start a line
        with # through ###### and a space for headings, - for a list, 1. for a
        numbered list, &gt; for a quote, or ``` for a code block. Wrap text in
        **bold**, *italic*, ~~strikethrough~~, or `code` to format it as you
        type.
      </p>
      <p>
        {modifier}B bold · {modifier}I italic · {modifier}U underline ·{" "}
        {modifier}Shift+X strikethrough · {modifier}E code · {modifier}K link ·{" "}
        {modifier}Z undo · {modifier}Shift+Z redo. Use {modifier}Alt+1 through 6
        for headings.
      </p>
    </details>
  );
}
