// The legal documents are written in a small part of Markdown, and this turns
// that into blocks the app and the public web pages both draw. One reader for
// both means a heading, a list or a link looks the same wherever the document
// is opened, and the text people agree to in the app is the text on the web.
//
// What is understood, and nothing else:
//   # Title              once, on the first line
//   ## Heading           and  ### Smaller heading
//   plain paragraphs     lines separated by a blank line (lines in between are joined)
//   - bullet item        and  1. numbered item
//   **bold**             inside any text
//   [link text](https://...)   also http:, mailto: and tel: addresses
// Anything else is shown exactly as written. A bracketed placeholder such as
// "[Registered company name]", with no address after it, stays as it is.

/** One stretch of text inside a heading, paragraph or list item. */
export type LegalInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; text: string; href: string };

export type LegalBlock =
  | { type: "title" | "h2" | "h3" | "p"; content: LegalInline[] }
  | { type: "ul"; items: LegalInline[][] }
  | { type: "ol"; start: number; items: LegalInline[][] };

// A link is only made for these kinds of address. Anything else (a "javascript:"
// address, a relative path) is shown as the words that were typed.
const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i;

// `**bold**`, or `[words](address)` with no space between "]" and "(".
const INLINE = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** Splits one line of text into plain, bold and link stretches. */
export function parseLegalInline(text: string): LegalInline[] {
  const runs: LegalInline[] = [];
  const addText = (value: string) => {
    if (!value) return;
    const previous = runs[runs.length - 1];
    if (previous?.type === "text") previous.text += value;
    else runs.push({ type: "text", text: value });
  };
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const [whole, bold, linkText, href] = match;
    const start = match.index;
    if (bold !== undefined) {
      addText(text.slice(last, start));
      runs.push({ type: "bold", text: bold });
    } else if (linkText !== undefined && href !== undefined && SAFE_LINK.test(href)) {
      addText(text.slice(last, start));
      runs.push({ type: "link", text: linkText, href });
    } else {
      // Not a link we make: left in place, so it is shown as typed.
      continue;
    }
    last = start + whole.length;
  }
  addText(text.slice(last));
  return runs;
}

const BULLET = /^- +(.*)$/;
const NUMBERED = /^(\d+)\. +(.*)$/;
const HEADING = /^(#{1,3}) +(.*)$/;

/** Turns a legal document's Markdown into blocks, in order. Never throws. */
export function parseLegalMarkdown(markdown: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  // Text of the paragraph or list being read, line by line.
  let paragraph = null as string[] | null;
  let list = null as { type: "ul" | "ol"; start: number; items: string[][] } | null;

  const closeParagraph = () => {
    if (paragraph) blocks.push({ type: "p", content: parseLegalInline(paragraph.join(" ")) });
    paragraph = null;
  };
  const closeList = () => {
    if (list) {
      const items = list.items.map((lines) => parseLegalInline(lines.join(" ")));
      blocks.push(list.type === "ul" ? { type: "ul", items } : { type: "ol", start: list.start, items });
    }
    list = null;
  };
  const addItem = (type: "ul" | "ol", start: number, text: string) => {
    closeParagraph();
    if (list?.type !== type) {
      closeList();
      list = { type, start, items: [] };
    }
    list.items.push([text.trim()]);
  };

  const lines = markdown.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      closeParagraph();
      closeList();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      closeParagraph();
      closeList();
      const level = heading[1]!.length;
      // The title is the first thing in the document; a "# " further down is read as a heading.
      const type = level === 1 ? (blocks.length === 0 ? "title" : "h2") : level === 2 ? "h2" : "h3";
      blocks.push({ type, content: parseLegalInline(heading[2]!.trim()) });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      addItem("ul", 1, bullet[1]!);
      continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      addItem("ol", Number(numbered[1]), numbered[2]!);
      continue;
    }
    // A line straight after a list item, with no blank line between, carries on that item
    // (text pasted from elsewhere is often wrapped this way). Otherwise it is part of a paragraph.
    if (list) {
      list.items[list.items.length - 1]!.push(line);
      continue;
    }
    (paragraph ??= []).push(line);
  }
  closeParagraph();
  closeList();
  return blocks;
}

/** The words of some inline stretches without their marks, e.g. for a page title. */
export const legalPlainText = (content: readonly LegalInline[]) => content.map((run) => run.text).join("");
