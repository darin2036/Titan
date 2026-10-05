import { Extension, markInputRule } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import Underline from "@tiptap/extension-underline";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";

// Markdown has no standard underline delimiter. Keep it portable as <u> tags;
// the read view recognizes just those tags without enabling arbitrary HTML.
const MarkdownUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(src) {
      const positions = [src.indexOf("<u>"), src.indexOf("++")].filter(
        (position) => position >= 0,
      );
      return positions.length ? Math.min(...positions) : -1;
    },
    tokenize(src, _tokens, lexer) {
      const match = /^(?:<u>([\s\S]+?)<\/u>|\+\+([\s\S]+?)\+\+)/.exec(src);
      if (!match) return undefined;
      const text = match[1] ?? match[2];
      return {
        type: "underline",
        raw: match[0],
        text,
        tokens: lexer.inlineTokens(text),
      };
    },
  },
  addInputRules() {
    return [
      markInputRule({ find: /(?:^|\s)(\+\+([^+]+)\+\+)$/, type: this.type }),
    ];
  },
});

export function richTextExtensions(onLinkShortcut?: () => void) {
  return [
    StarterKit.configure({
      underline: false,
      link: { openOnClick: false },
      trailingNode: false,
    }),
    MarkdownUnderline,
    TableKit.configure({ table: { resizable: false } }),
    Image.configure({ inline: true, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({
      placeholder: "Write here…",
    }),
    Markdown,
    Extension.create({
      name: "titanShortcuts",
      addKeyboardShortcuts() {
        return {
          "Mod-Shift-x": () => this.editor.commands.toggleStrike(),
          "Mod-k": () => {
            onLinkShortcut?.();
            return !!onLinkShortcut;
          },
        };
      },
    }),
  ];
}
