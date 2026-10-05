import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownManager } from "@tiptap/markdown";
import type { JSONContent } from "@tiptap/core";
import { richTextExtensions } from "../apps/web/src/rich-text-extensions.ts";
import RecordMarkdown from "../apps/web/src/record-markdown.tsx";

function descendants(node: JSONContent): JSONContent[] {
  return [node, ...(node.content ?? []).flatMap(descendants)];
}
function manager() {
  return new MarkdownManager({ extensions: richTextExtensions() });
}

test("rich text round-trips headings, inline marks, links, code, lists, and calendar tables", () => {
  const markdown = manager();
  const source =
    "## Company calendar\n\n**Bold**, *italic*, ~~old date~~, <u>underlined **and bold**</u>, `code`, and [policy](https://example.com/policy).\n\n- Team one\n- Team two\n\n1. First\n2. Second\n\n> A quoted note\n\n```text\n## literal heading\n```\n\n| Date | Event |\n| --- | --- |\n| 2027-01-01 | Office closed |";
  const first = markdown.parse(source);
  const stored = markdown.serialize(first);
  const restored = markdown.parse(stored);
  const nodes = descendants(restored);
  assert.ok(
    nodes.some((node) => node.type === "heading" && node.attrs?.level === 2),
  );
  for (const mark of [
    "bold",
    "italic",
    "strike",
    "underline",
    "code",
    "link",
  ]) {
    assert.ok(
      nodes.some((node) => node.marks?.some((value) => value.type === mark)),
      "Lost " + mark,
    );
  }
  const nested = nodes.find((node) => node.text === "and bold");
  assert.ok(nested?.marks?.some((mark) => mark.type === "underline"));
  assert.ok(nested?.marks?.some((mark) => mark.type === "bold"));
  for (const type of [
    "bulletList",
    "orderedList",
    "blockquote",
    "codeBlock",
    "table",
  ]) {
    assert.ok(
      nodes.some((node) => node.type === type),
      "Lost " + type,
    );
  }
  assert.ok(nodes.some((node) => node.text === "2027-01-01"));
  assert.ok(nodes.some((node) => node.text === "Office closed"));
  assert.ok(
    nodes.some(
      (node) =>
        node.type === "codeBlock" &&
        node.content?.[0].text === "## literal heading",
    ),
  );
  assert.match(stored, /<u>/);
  const rendered = renderToStaticMarkup(
    React.createElement(RecordMarkdown, { children: stored }),
  );
  assert.match(rendered, /<u>underlined <strong>and bold<\/strong><\/u>/);
  assert.match(rendered, /<table>/);
});

test("underline survives mixed adjacent marks and doesn't enable arbitrary HTML in record views", () => {
  const markdown = manager();
  const document: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "first",
            marks: [{ type: "underline" }, { type: "bold" }],
          },
          {
            type: "text",
            text: " second",
            marks: [{ type: "underline" }, { type: "italic" }],
          },
          { type: "text", text: " plain" },
        ],
      },
    ],
  };
  const stored = markdown.serialize(document);
  const restored = descendants(markdown.parse(stored));
  assert.ok(
    restored
      .find((node) => node.text === "first")
      ?.marks?.some((mark) => mark.type === "underline"),
  );
  assert.ok(
    restored
      .find((node) => node.text === "second")
      ?.marks?.some((mark) => mark.type === "underline"),
  );
  const rendered = renderToStaticMarkup(
    React.createElement(RecordMarkdown, { children: stored }),
  );
  assert.match(rendered, /<u>/);
  assert.doesNotMatch(rendered, /&lt;u&gt;/);
  const unsafe = renderToStaticMarkup(
    React.createElement(RecordMarkdown, {
      children:
        '<u onclick="alert(1)">unsafe</u> <script>alert(1)</script> `<u>literal</u>`',
    }),
  );
  assert.doesNotMatch(unsafe, /<script>|<u onclick/);
  assert.match(unsafe, /<code>&lt;u&gt;literal&lt;\/u&gt;<\/code>/);
});

test("checklists and images remain meaningful when reopening Markdown records", () => {
  const markdown = manager();
  const stored = markdown.serialize(
    markdown.parse(
      "- [x] Published\n- [ ] Review\n\n![Office map](https://example.com/map.png)",
    ),
  );
  const nodes = descendants(markdown.parse(stored));
  assert.ok(
    nodes.some(
      (node) => node.type === "taskItem" && node.attrs?.checked === true,
    ),
  );
  assert.ok(
    nodes.some(
      (node) => node.type === "taskItem" && node.attrs?.checked === false,
    ),
  );
  assert.ok(
    nodes.some(
      (node) =>
        node.type === "image" &&
        node.attrs?.src === "https://example.com/map.png",
    ),
  );
});
