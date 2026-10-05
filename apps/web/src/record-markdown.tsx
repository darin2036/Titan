import React from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";

// Interpret only exact formatting tags emitted by the composer. Attributes and
// other raw HTML keep react-markdown's escaping; no HTML execution is enabled.
export function remarkInlineFormatting() {
  return (tree: Root) => {
    const tags = new Set(["u", "strong", "em", "s", "del", "b", "i", "code"]);
    function visit(parent: { children: RootContent[] }) {
      for (const node of parent.children) {
        if ("children" in node) visit(node as { children: RootContent[] });
      }
      const output: RootContent[] = [];
      const stack: {
        tag: string;
        opening: RootContent;
        children: RootContent[];
      }[] = [];
      const append = (node: RootContent) =>
        (stack.at(-1)?.children ?? output).push(node);
      for (const node of parent.children) {
        const match =
          node.type === "html" ? /^<(\/?)([a-z]+)>$/.exec(node.value) : null;
        if (match && tags.has(match[2]) && !match[1]) {
          stack.push({ tag: match[2], opening: node, children: [] });
        } else if (match?.[1] && stack.at(-1)?.tag === match[2]) {
          const group = stack.pop()!;
          append({
            type: "inlineFormatting",
            children: group.children,
            data: { hName: group.tag },
          } as unknown as RootContent);
        } else {
          append(node);
        }
      }
      while (stack.length) {
        const group = stack.pop()!;
        append(group.opening);
        for (const node of group.children) append(node);
      }
      parent.children = output;
    }
    visit(tree);
  };
}

export default function RecordMarkdown(
  props: React.ComponentProps<typeof Markdown>,
) {
  return (
    <Markdown
      {...props}
      remarkPlugins={[
        remarkGfm,
        remarkInlineFormatting,
        ...(props.remarkPlugins ?? []),
      ]}
    />
  );
}
