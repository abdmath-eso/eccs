import { describe, expect, it } from "vitest";
import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_KEYS,
  acceptLegalSchema,
  documentsToAccept,
  isLegalDocumentKey,
  legalPlainText,
  parseLegalInline,
  parseLegalMarkdown,
  pendingDocuments,
  type LegalDocument,
} from "./index.js";

const keys = (documents: readonly LegalDocument[]) => documents.map((document) => document.key);
const current = (key: string) => {
  const document = LEGAL_DOCUMENTS.find((entry) => entry.key === key);
  if (!document) throw new Error(`no ${key}`);
  return { key, version: document.version };
};

describe("LEGAL_DOCUMENTS", () => {
  it("has the five documents, each once, in the order of the keys", () => {
    expect(keys(LEGAL_DOCUMENTS)).toEqual([...LEGAL_DOCUMENT_KEYS]);
    expect(new Set(keys(LEGAL_DOCUMENTS)).size).toBe(5);
  });

  it("dates every version and names its title key after the document", () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(document.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${document.version}T00:00:00Z`))).toBe(false);
      expect(document.titleKey).toBe(`legal.doc.${document.key}`);
    }
  });

  it("gives every document someone must agree to a tick box, and the disclaimer none", () => {
    for (const document of LEGAL_DOCUMENTS) {
      expect(document.checkbox === null).toBe(document.mustAgree.length === 0);
    }
    expect(LEGAL_DOCUMENTS.find((document) => document.key === "privacy")?.checkbox).toBe("privacy");
  });

  it("holds Markdown that opens with a title and has sections", () => {
    for (const document of LEGAL_DOCUMENTS) {
      const blocks = parseLegalMarkdown(document.markdown);
      expect(blocks[0]?.type).toBe("title");
      expect(blocks.some((block) => block.type === "h2")).toBe(true);
      expect(blocks.filter((block) => block.type === "title")).toHaveLength(1);
    }
  });

  it("recognises its own keys only", () => {
    expect(isLegalDocumentKey("dataProcessing")).toBe(true);
    expect(isLegalDocumentKey("cookies")).toBe(false);
  });
});

describe("documentsToAccept", () => {
  it("asks the Manager and the Head Chef for the terms and the privacy policy", () => {
    expect(keys(documentsToAccept("MANAGER"))).toEqual(["terms", "privacy"]);
    expect(keys(documentsToAccept("HEAD_CHEF"))).toEqual(["terms", "privacy"]);
  });

  it("asks the Owner for four, and never for the disclaimer on its own", () => {
    expect(keys(documentsToAccept("OWNER"))).toEqual(["terms", "privacy", "refunds", "dataProcessing"]);
  });

  it("asks ECCS's own staff for nothing", () => {
    for (const role of ["SUPER_ADMIN", "OPS_MANAGER", "SUPERVISOR"] as const) {
      expect(documentsToAccept(role)).toEqual([]);
    }
  });

  it("takes several roles at once, listing each document once", () => {
    expect(keys(documentsToAccept(["HEAD_CHEF", "OWNER"]))).toEqual(["terms", "privacy", "refunds", "dataProcessing"]);
  });
});

describe("pendingDocuments", () => {
  it("is everything the role needs when nothing has been agreed", () => {
    expect(keys(pendingDocuments("HEAD_CHEF", []))).toEqual(["terms", "privacy"]);
  });

  it("is empty once the current versions are agreed", () => {
    expect(pendingDocuments("HEAD_CHEF", [current("terms"), current("privacy")])).toEqual([]);
    const owner = ["terms", "privacy", "refunds", "dataProcessing"].map(current);
    expect(pendingDocuments("OWNER", owner)).toEqual([]);
  });

  it("asks again for a document whose version has changed", () => {
    const agreed = [current("terms"), current("privacy")];
    const updated = LEGAL_DOCUMENTS.map((document) =>
      document.key === "privacy" ? { ...document, version: "2099-01-01" } : document,
    );
    expect(keys(pendingDocuments("MANAGER", agreed, updated))).toEqual(["privacy"]);
  });

  it("does not count an agreement to an older version", () => {
    expect(keys(pendingDocuments("MANAGER", [{ key: "terms", version: "2000-01-01" }, current("privacy")]))).toEqual([
      "terms",
    ]);
  });

  it("ignores agreements to documents the role does not need", () => {
    expect(keys(pendingDocuments("HEAD_CHEF", [current("refunds")]))).toEqual(["terms", "privacy"]);
  });
});

describe("acceptLegalSchema", () => {
  it("takes documents and the app language", () => {
    expect(
      acceptLegalSchema.safeParse({ documents: [current("terms")], language: "TE", appVersion: "1.0.0" }).success,
    ).toBe(true);
  });

  it("refuses an empty list, an unknown document and an unknown language", () => {
    expect(acceptLegalSchema.safeParse({ documents: [], language: "EN" }).success).toBe(false);
    expect(acceptLegalSchema.safeParse({ documents: [{ key: "cookies", version: "1" }], language: "EN" }).success).toBe(false);
    expect(acceptLegalSchema.safeParse({ documents: [current("terms")], language: "FR" }).success).toBe(false);
  });
});

describe("parseLegalInline", () => {
  it("keeps plain text as one stretch", () => {
    expect(parseLegalInline("Just words.")).toEqual([{ type: "text", text: "Just words." }]);
  });

  it("reads bold and links between plain text", () => {
    expect(parseLegalInline("Read **this** at [our site](https://example.com/a) now.")).toEqual([
      { type: "text", text: "Read " },
      { type: "bold", text: "this" },
      { type: "text", text: " at " },
      { type: "link", text: "our site", href: "https://example.com/a" },
      { type: "text", text: " now." },
    ]);
  });

  it("makes links for http, mailto and tel addresses", () => {
    expect(parseLegalInline("[a](http://x.in)")[0]).toEqual({ type: "link", text: "a", href: "http://x.in" });
    expect(parseLegalInline("[mail](mailto:help@x.in)")[0]).toEqual({ type: "link", text: "mail", href: "mailto:help@x.in" });
    expect(parseLegalInline("[call](tel:+919000000000)")[0]).toEqual({ type: "link", text: "call", href: "tel:+919000000000" });
  });

  it("shows a bracketed placeholder exactly as written", () => {
    expect(parseLegalInline("Made by [Registered company name], Hyderabad.")).toEqual([
      { type: "text", text: "Made by [Registered company name], Hyderabad." },
    ]);
    expect(parseLegalInline("[Registered company name] (the Company)")).toEqual([
      { type: "text", text: "[Registered company name] (the Company)" },
    ]);
  });

  it("finds a link after a placeholder on the same line", () => {
    expect(parseLegalInline("[Name] and [site](https://x.in)")).toEqual([
      { type: "text", text: "[Name] and " },
      { type: "link", text: "site", href: "https://x.in" },
    ]);
  });

  it("does not make a link of any other kind of address", () => {
    expect(parseLegalInline("[click](javascript:alert(1))")).toEqual([{ type: "text", text: "[click](javascript:alert(1))" }]);
    expect(parseLegalInline("[page](/legal/terms)")).toEqual([{ type: "text", text: "[page](/legal/terms)" }]);
  });

  it("bolds a placeholder, and leaves an unclosed or single star as written", () => {
    expect(parseLegalInline("**[Company]**")).toEqual([{ type: "bold", text: "[Company]" }]);
    expect(parseLegalInline("a **b")).toEqual([{ type: "text", text: "a **b" }]);
    expect(parseLegalInline("*draft*")).toEqual([{ type: "text", text: "*draft*" }]);
  });
});

describe("parseLegalMarkdown", () => {
  const sample = [
    "# Terms of Service",
    "",
    "First line of a paragraph",
    "carries on here.",
    "",
    "## 1. Who",
    "### Smaller",
    "- one",
    "- two **bold**",
    "  wrapped on",
    "",
    "3. third",
    "4. fourth",
    "",
    "Last.",
  ].join("\r\n");

  it("reads every construct in order", () => {
    expect(parseLegalMarkdown(sample)).toEqual([
      { type: "title", content: [{ type: "text", text: "Terms of Service" }] },
      { type: "p", content: [{ type: "text", text: "First line of a paragraph carries on here." }] },
      { type: "h2", content: [{ type: "text", text: "1. Who" }] },
      { type: "h3", content: [{ type: "text", text: "Smaller" }] },
      {
        type: "ul",
        items: [
          [{ type: "text", text: "one" }],
          [
            { type: "text", text: "two " },
            { type: "bold", text: "bold" },
            { type: "text", text: " wrapped on" },
          ],
        ],
      },
      { type: "ol", start: 3, items: [[{ type: "text", text: "third" }], [{ type: "text", text: "fourth" }]] },
      { type: "p", content: [{ type: "text", text: "Last." }] },
    ]);
  });

  it("reads a later '# ' as a heading, not a second title", () => {
    expect(parseLegalMarkdown("# A\n\n# B").map((block) => block.type)).toEqual(["title", "h2"]);
    expect(parseLegalMarkdown("Intro\n\n# B").map((block) => block.type)).toEqual(["p", "h2"]);
  });

  it("starts a new list when bullets turn to numbers", () => {
    expect(parseLegalMarkdown("- a\n1. b").map((block) => block.type)).toEqual(["ul", "ol"]);
  });

  it("ends a paragraph at a heading or a list without a blank line", () => {
    expect(parseLegalMarkdown("Words\n## H\nMore\n- item").map((block) => block.type)).toEqual(["p", "h2", "p", "ul"]);
  });

  it("shows anything outside the subset as written", () => {
    const blocks = parseLegalMarkdown("#### Deep\n\n| a | b |\n\n<b>html</b>\n\n* star");
    expect(blocks.map((block) => block.type)).toEqual(["p", "p", "p", "p"]);
    expect(blocks.map((block) => (block.type === "p" ? legalPlainText(block.content) : ""))).toEqual([
      "#### Deep",
      "| a | b |",
      "<b>html</b>",
      "* star",
    ]);
  });

  it("copes with nothing, spaces and a byte-order mark", () => {
    expect(parseLegalMarkdown("")).toEqual([]);
    expect(parseLegalMarkdown("  \n\n ")).toEqual([]);
    expect(parseLegalMarkdown("﻿# T")[0]?.type).toBe("title");
  });
});
