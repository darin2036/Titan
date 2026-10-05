import { SaxesParser } from "saxes";
type Node = {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
};
const escape = (s: string) => s.replace(/[\\`*_{}\[\]<>#|]/g, "\\$&");
export function normalizeConfluence(raw: string, baseUrl?: string) {
  const links = new Set<string>();
  const root: Node = { tag: "root", attrs: {}, children: [] };
  const stack = [root];
  const issues = new Set<string>();
  const parser = new SaxesParser({ xmlns: false });
  parser.on("doctype", () => {
    throw new Error("Unsupported document type");
  });
  parser.on("opentag", (tag) => {
    const node: Node = {
      tag: tag.name.toLowerCase(),
      attrs: tag.attributes as Record<string, string>,
      children: [],
    };
    stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", (text) => stack.at(-1)!.children.push(text));
  parser.on("cdata", (text) => stack.at(-1)!.children.push(text));
  parser.on("error", () => {
    throw new Error("Unsupported source markup");
  });
  try {
    parser
      .write("<root>" + raw.replace(/&nbsp;/g, "&#160;") + "</root>")
      .close();
  } catch {
    return {
      body: "This page contains source formatting Titan cannot safely convert. Open it in Confluence to read the original.",
      issues: ["Source formatting needs review"],
      links: [],
    };
  }
  const text = (n: Node): string =>
    n.children.map((c) => (typeof c === "string" ? c : text(c))).join("");
  const render = (n: Node | string): string => {
    if (typeof n === "string") return escape(n);
    if (n.attrs.style || n.attrs.color || n.attrs.align)
      issues.add("Source styling needs review");
    if (n.tag === "ol" && n.attrs.start && n.attrs.start !== "1")
      issues.add("Custom list numbering needs review");
    const inside = () => n.children.map(render).join("");
    if (/^h[1-6]$/.test(n.tag))
      return "\n\n" + "#".repeat(Number(n.tag[1])) + " " + inside() + "\n\n";
    switch (n.tag) {
      case "root":
      case "span":
        return inside();
      case "p":
      case "div":
        return "\n\n" + inside() + "\n\n";
      case "hr":
        return "\n\n---\n\n";
      case "br":
        return "  \n";
      case "strong":
      case "b":
        return "**" + inside() + "**";
      case "em":
      case "i":
        return "*" + inside() + "*";
      case "u":
        return "<u>" + inside() + "</u>";
      case "s":
      case "del":
        return "~~" + inside() + "~~";
      case "code":
        return "`" + text(n).replace(/`/g, "\\`") + "`";
      case "pre":
        return "\n\n````\n" + text(n) + "\n````\n\n";
      case "blockquote":
        return (
          "\n\n" +
          inside()
            .trim()
            .split("\n")
            .map((l) => "> " + l)
            .join("\n") +
          "\n\n"
        );
      case "a": {
        let href = n.attrs.href ?? "";
        if (href.startsWith("/") && baseUrl) {
          try {
            href = new URL(href, baseUrl).toString();
          } catch {}
        }
        if (/^(https?:\/\/|mailto:|#)/i.test(href) && !/[\s()]/.test(href)) {
          links.add(href);
          return "[" + inside() + "](" + href + ")";
        }
        issues.add("A link needs review");
        return inside();
      }
      case "ul":
      case "ol":
        return (
          "\n\n" +
          n.children
            .filter((c): c is Node => typeof c !== "string")
            .map(
              (c, i) =>
                (n.tag === "ol" ? `${i + 1}. ` : "- ") +
                render(c).trim().replace(/\n/g, "\n  "),
            )
            .join("\n") +
          "\n\n"
        );
      case "li":
        return inside();
      case "table": {
        const rows: Node[] = [];
        const visit = (x: Node) => {
          if (x.tag === "tr") rows.push(x);
          else
            x.children.forEach((c) => {
              if (typeof c !== "string") visit(c);
            });
        };
        visit(n);
        const values = rows.map((r) =>
          r.children
            .filter(
              (c): c is Node =>
                typeof c !== "string" && ["td", "th"].includes(c.tag),
            )
            .map((c) => {
              if (c.attrs.colspan || c.attrs.rowspan)
                issues.add("Merged table cells need review");
              return c.children
                .map(render)
                .join("")
                .trim()
                .replace(/\n+/g, " ");
            }),
        );
        if (!values.length) return "";
        const width = Math.max(...values.map((r) => r.length));
        const line = (r: string[]) =>
          "| " +
          Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ") +
          " |";
        return (
          "\n\n" +
          [
            line(values[0]),
            line(Array(width).fill("---")),
            ...values.slice(1).map(line),
          ].join("\n") +
          "\n\n"
        );
      }
      default:
        issues.add(
          n.tag.startsWith("ac:")
            ? "Macros or embeds need review"
            : n.tag.startsWith("ri:") || n.tag === "img"
              ? "Attachments or internal links need review"
              : "Source formatting needs review",
        );
        return (
          "\n\n[Content preserved in Confluence: " + escape(n.tag) + "]\n\n"
        );
    }
  };
  return {
    body:
      render(root)
        .replace(/\n{3,}/g, "\n\n")
        .trim() || "This page has no text content.",
    issues: [...issues],
    links: [...links],
  };
}

import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { demand } from "./contracts.ts";
const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export function confluenceMarkup(markdown: string) {
  const root = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  const render = (node: any): string => {
    const inside = () => (node.children ?? []).map(render).join("");
    switch (node.type) {
      case "root":
        return inside();
      case "text":
        return xml(node.value);
      case "paragraph":
        return "<p>" + inside() + "</p>";
      case "heading":
        return `<h${node.depth}>` + inside() + `</h${node.depth}>`;
      case "strong":
        return "<strong>" + inside() + "</strong>";
      case "emphasis":
        return "<em>" + inside() + "</em>";
      case "delete":
        return "<del>" + inside() + "</del>";
      case "break":
        return "<br />";
      case "thematicBreak":
        return "<hr />";
      case "blockquote":
        return "<blockquote>" + inside() + "</blockquote>";
      case "inlineCode":
        return "<code>" + xml(node.value) + "</code>";
      case "code":
        return "<pre>" + xml(node.value) + "</pre>";
      case "list":
        return (
          (node.ordered ? "<ol>" : "<ul>") +
          inside() +
          (node.ordered ? "</ol>" : "</ul>")
        );
      case "listItem":
        demand(
          node.checked === null || node.checked === undefined,
          422,
          "Checklists need review before saving to Confluence",
        );
        return "<li>" + inside() + "</li>";
      case "link":
        demand(
          /^(https?:\/\/|mailto:|#)/i.test(node.url) &&
            !node.url.startsWith("#unit-"),
          422,
          "This link needs a Confluence or web destination before saving",
        );
        return '<a href="' + xml(node.url) + '">' + inside() + "</a>";
      case "table":
        return "<table><tbody>" + inside() + "</tbody></table>";
      case "tableRow":
        return "<tr>" + inside() + "</tr>";
      case "tableCell":
        return "<td>" + inside() + "</td>";
      case "html":
        demand(
          ["<u>", "</u>"].includes(node.value),
          422,
          "Embedded HTML needs review before saving to Confluence",
        );
        return node.value;
      default:
        demand(
          false,
          422,
          "Attachments, embeds, or unsupported formatting need review before saving to Confluence",
        );
        return "";
    }
  };
  return render(root);
}
