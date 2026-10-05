import React, { useEffect, useRef, useState } from "react";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { createPortal } from "react-dom";
import { richTextExtensions } from "./rich-text-extensions";

type Props = {
  value: string;
  disabled: boolean;
  onChange: (markdown: string) => void;
};
const mac = /Mac|iPhone|iPad/.test(navigator.platform);
const modifier = mac ? "⌘" : "Ctrl+";
export default function RichTextEditor({ value, disabled, onChange }: Props) {
  type Menu = {
    mode: "selection" | "commands";
    left: number;
    top: number;
    from?: number;
    to?: number;
    query: string;
  };
  const [menu, setMenu] = useState<Menu | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const menuRef = useRef<Menu | null>(null);
  const dismissed = useRef<number | null>(null);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const refresh = useRef<(editor: Editor) => void>(() => {});
  const [linkPosition, setLinkPosition] = useState({ left: 8, top: 8 });
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const instance = useRef<Editor | null>(null);
  const lastValue = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  function openLink() {
    if (instance.current)
      setLinkPosition(position(instance.current, "commands"));
    setLinkUrl(instance.current?.getAttributes("link").href ?? "");
    setLinkError("");
    setMenu(null);
    setLinkOpen(true);
  }
  const editor = useEditor({
    extensions: richTextExtensions(openLink),
    content: value,
    contentType: "markdown",
    editable: !disabled,
    editorProps: {
      attributes: {
        id: "page-body",
        role: "textbox",
        "aria-label": "Page content",
        "aria-multiline": "true",
        "aria-describedby": "rich-editor-help",
        class: "rich-editor markdown",
      },
      handleKeyDown(_view, event) {
        return keyHandler.current(event);
      },
      handlePaste(_view, event) {
        const text = event.clipboardData?.getData("text/plain") ?? "";
        const html = event.clipboardData?.getData("text/html");
        if (
          html ||
          !/(?:^|\n)(?:#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```|\|.*\|)|\*\*[^*]+\*\*|~~[^~]+~~|\[[^\]]+\]\([^\)]+\)/.test(
            text,
          )
        )
          return false;
        if (!instance.current) return false;
        event.preventDefault();
        instance.current.commands.insertContent(text, {
          contentType: "markdown",
        });
        return true;
      },
    },
    onSelectionUpdate({ editor }) {
      refresh.current(editor);
    },
    onFocus({ editor }) {
      refresh.current(editor);
    },
    onBlur({ event }) {
      if (
        event.relatedTarget instanceof Element &&
        event.relatedTarget.closest(".editor-popover")
      )
        return;
      menuRef.current = null;
      setMenu(null);
    },
    onUpdate({ editor }) {
      refresh.current(editor);
      const markdown = editor.getMarkdown();
      lastValue.current = markdown;
      onChangeRef.current(markdown);
    },
  });
  instance.current = editor;
  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      const heading = [1, 2, 3, 4, 5, 6].find((level) =>
        editor.isActive("heading", { level }),
      );
      return {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        strike: editor.isActive("strike"),
        code: editor.isActive("code"),
        link: editor.isActive("link"),
        bulletList: editor.isActive("bulletList"),
        orderedList: editor.isActive("orderedList"),
        taskList: editor.isActive("taskList"),
        table: editor.isActive("table"),
        block: heading
          ? "h" + heading
          : editor.isActive("codeBlock")
            ? "codeBlock"
            : editor.isActive("blockquote")
              ? "blockquote"
              : "paragraph",
        undo: editor.can().undo(),
        redo: editor.can().redo(),
      };
    },
  });
  function position(editor: Editor, mode: Menu["mode"], extra = {}) {
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const menuHeight = mode === "commands" ? 330 : 96;
    const below = coords.bottom + 8;
    return {
      mode,
      query: "",
      left: Math.max(
        leftEdge + 8,
        Math.min(coords.left, leftEdge + width - 320),
      ),
      top: Math.max(
        topEdge + 8,
        below + menuHeight > topEdge + height
          ? coords.top - menuHeight - 8
          : below,
      ),
      ...extra,
    };
  }
  refresh.current = (editor) => {
    if (!editor.isFocused || !editor.isEditable || linkOpen) return;
    const { from, to, $from, empty } = editor.state.selection;
    const before = $from.parent.textBetween(
      0,
      $from.parentOffset,
      "\n",
      "\ufffc",
    );
    const match =
      empty &&
      !editor.isActive("codeBlock") &&
      /(?:^|\s)~ ([^~\n]*)$/.exec(before);
    if (match) {
      const start = from - match[1].length - 2;
      if (dismissed.current === start) return;
      const next = position(editor, "commands", {
        from: start,
        to: from,
        query: match[1],
      });
      if (
        menuRef.current?.query !== next.query ||
        menuRef.current?.mode !== "commands"
      )
        setActiveIndex(0);
      menuRef.current = next;
      setMenu(next);
    } else {
      dismissed.current = null;
      const next =
        !empty && editor.state.doc.textBetween(from, to).trim()
          ? position(editor, "selection")
          : null;
      menuRef.current = next;
      setMenu(next);
    }
  };
  useEffect(() => {
    const reposition = (event: Event) => {
      if (
        event.target instanceof Element &&
        event.target.closest(".editor-popover")
      )
        return;
      const current = menuRef.current;
      const instanceEditor = instance.current;
      if (
        !current ||
        !instanceEditor?.isInitialized ||
        !instanceEditor.isFocused
      )
        return;
      const next = position(instanceEditor, current.mode, {
        from: current.from,
        to: current.to,
        query: current.query,
      });
      menuRef.current = next;
      setMenu(next);
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, []);
  useEffect(() => {
    editor?.setEditable(!disabled, false);
    if (disabled) {
      menuRef.current = null;
      setMenu(null);
      setLinkOpen(false);
    }
  }, [editor, disabled]);
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    editor.commands.setContent(value, {
      contentType: "markdown",
      emitUpdate: false,
    });
    lastValue.current = value;
  }, [editor, value]);
  useEffect(() => {
    if (linkOpen) document.getElementById("editor-link-url")?.focus();
  }, [linkOpen]);
  useEffect(() => {
    if (!editor?.isInitialized) return;
    const dom = editor.view.dom;
    if (menu?.mode === "commands") {
      dom.setAttribute("aria-controls", "editor-style-menu");
      dom.setAttribute(
        "aria-activedescendant",
        "editor-command-" + activeIndex,
      );
      document
        .getElementById("editor-command-" + activeIndex)
        ?.scrollIntoView({ block: "nearest" });
    } else {
      dom.removeAttribute("aria-controls");
      dom.removeAttribute("aria-activedescendant");
    }
  }, [editor, menu?.mode, activeIndex, menu?.query]);
  if (!editor || !state) return <p className="hint">Opening editor…</p>;
  function button(
    label: string,
    active: boolean,
    shortcut: string,
    action: () => void,
    available = true,
  ) {
    return (
      <button
        type="button"
        disabled={disabled || !available}
        aria-label={label}
        aria-pressed={active}
        title={label + (shortcut ? " (" + modifier + shortcut + ")" : "")}
        aria-keyshortcuts={
          shortcut ? (mac ? "Meta+" : "Control+") + shortcut : undefined
        }
        onMouseDown={(e) => e.preventDefault()}
        onClick={action}
      >
        {label === "Bold" ? (
          <strong>B</strong>
        ) : label === "Italic" ? (
          <em>I</em>
        ) : label === "Underline" ? (
          <u>U</u>
        ) : label === "Strikethrough" ? (
          <s>S</s>
        ) : (
          label
        )}
      </button>
    );
  }
  function applyLink() {
    let href = linkUrl.trim();
    if (!href) {
      setLinkError("Enter a link, or choose Remove link.");
      return;
    }
    if (!/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^[/#?]/.test(href))
      href = "https://" + href;
    if (!/^(?:https?:|mailto:|tel:|\/(?!\/)|#|\?)/i.test(href)) {
      setLinkError("Use a web address, email address, or page link.");
      return;
    }
    if (editor!.state.selection.empty && !editor!.isActive("link")) {
      editor!
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: href,
          marks: [{ type: "link", attrs: { href } }],
        })
        .run();
    } else {
      editor!.chain().focus().extendMarkRange("link").setLink({ href }).run();
    }
    setLinkOpen(false);
  }
  const commands = [
    {
      label: "Text",
      hint: "Plain paragraph",
      run: () => editor.chain().focus().clearNodes().setParagraph().run(),
    },
    ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({
      label: "Heading " + level,
      hint: "#".repeat(level),
      run: () => editor.chain().focus().setHeading({ level }).run(),
    })),
    {
      label: "Bold",
      hint: modifier + "B",
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "Italic",
      hint: modifier + "I",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "Underline",
      hint: modifier + "U",
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "Strikethrough",
      hint: modifier + "Shift+X",
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: "Code",
      hint: modifier + "E",
      run: () => editor.chain().focus().toggleCode().run(),
    },
    { label: "Link", hint: modifier + "K", run: openLink },
    {
      label: "Bullet list",
      hint: "-",
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: "Numbered list",
      hint: "1.",
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      label: "Checklist",
      hint: "Tasks",
      run: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      label: "Quote",
      hint: ">",
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      label: "Code block",
      hint: "```",
      run: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: "Table",
      hint: "3 × 3",
      run: () =>
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
  ];
  const filteredCommands = commands.filter((command) =>
    command.label.toLowerCase().includes(menu?.query.toLowerCase() ?? ""),
  );
  function closeMenu() {
    dismissed.current = menuRef.current?.from ?? null;
    menuRef.current = null;
    setMenu(null);
  }
  function runCommand(command: (typeof commands)[number]) {
    const current = menuRef.current;
    closeMenu();
    if (current?.from !== undefined && current.to !== undefined)
      editor!
        .chain()
        .focus()
        .deleteRange({ from: current.from, to: current.to })
        .run();
    command.run();
    menuRef.current = null;
    setMenu(null);
  }
  keyHandler.current = (event) => {
    if (event.isComposing || !menuRef.current) return false;
    if (event.key === "Escape") {
      closeMenu();
      return true;
    }
    if (menuRef.current.mode !== "commands") return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      setActiveIndex((index) =>
        filteredCommands.length
          ? (index +
              (event.key === "ArrowDown" ? 1 : -1) +
              filteredCommands.length) %
            filteredCommands.length
          : 0,
      );
      return true;
    }
    if (event.key === "Enter") {
      if (filteredCommands[activeIndex])
        runCommand(filteredCommands[activeIndex]);
      return true;
    }
    return false;
  };
  return (
    <div className="rich-editor-surface">
      {menu &&
        !disabled &&
        !linkOpen &&
        createPortal(
          <div
            className={
              "editor-popover " +
              (menu.mode === "commands"
                ? "editor-command-menu"
                : "editor-selection-menu")
            }
            style={{ left: menu.left, top: menu.top }}
            onMouseDown={(e) => e.preventDefault()}
            onBlur={(e) => {
              if (
                e.relatedTarget instanceof Node &&
                (e.currentTarget.contains(e.relatedTarget) ||
                  editor.view.dom.contains(e.relatedTarget))
              )
                return;
              closeMenu();
            }}
            onKeyDown={(e) => {
              if (keyHandler.current(e.nativeEvent)) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            {menu.mode === "selection" ? (
              <div role="toolbar" aria-label="Text formatting">
                <button
                  type="button"
                  onClick={() => {
                    const next = position(editor, "commands");
                    menuRef.current = next;
                    setMenu(next);
                    setActiveIndex(0);
                  }}
                >
                  Style
                </button>
                {button("Bold", state.bold, "B", () =>
                  editor.chain().focus().toggleBold().run(),
                )}
                {button("Italic", state.italic, "I", () =>
                  editor.chain().focus().toggleItalic().run(),
                )}
                {button("Underline", state.underline, "U", () =>
                  editor.chain().focus().toggleUnderline().run(),
                )}
                {button("Strikethrough", state.strike, "Shift+X", () =>
                  editor.chain().focus().toggleStrike().run(),
                )}
                {button("Link", state.link, "K", openLink)}
              </div>
            ) : (
              <div
                role="listbox"
                id="editor-style-menu"
                aria-label="Text style"
              >
                {filteredCommands.length ? (
                  filteredCommands.map((command, index) => (
                    <button
                      type="button"
                      role="option"
                      id={"editor-command-" + index}
                      aria-selected={activeIndex === index}
                      key={command.label}
                      onMouseMove={() => setActiveIndex(index)}
                      onClick={() => runCommand(command)}
                    >
                      {command.label}
                      <span>{command.hint}</span>
                    </button>
                  ))
                ) : (
                  <p className="hint">No matching styles</p>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
      {linkOpen &&
        createPortal(
          <div
            className="editor-link-form editor-popover"
            style={linkPosition}
            role="group"
            aria-label="Edit link"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setLinkOpen(false);
                editor.commands.focus();
              }
            }}
          >
            <label htmlFor="editor-link-url">Link address</label>
            <input
              id="editor-link-url"
              disabled={disabled}
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://example.com"
            />
            {linkError && (
              <p role="alert" className="hint">
                {linkError}
              </p>
            )}
            <div className="button-row">
              <button type="button" disabled={disabled} onClick={applyLink}>
                Apply link
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  editor
                    .chain()
                    .focus()
                    .extendMarkRange("link")
                    .unsetLink()
                    .run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </button>
              <button
                type="button"
                onClick={() => {
                  setLinkOpen(false);
                  editor.commands.focus();
                }}
              >
                Cancel
              </button>
            </div>
          </div>,
          document.body,
        )}
      {state.table && (
        <div
          className="editor-table-actions"
          role="group"
          aria-label="Table actions"
        >
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            Add row
          </button>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            Add column
          </button>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            Delete row
          </button>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            Delete column
          </button>
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            Delete table
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
