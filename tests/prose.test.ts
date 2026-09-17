import { describe, expect, test } from "bun:test";
import { renderInline } from "../viewer/src/prose";

describe("safe guide inline formatting", () => {
  test("formats code, strong text and emphasis while preserving identifier underscores", () => {
    expect(
      renderInline("Read `_dieVisual`, **then** *initialize* _EMISSION and Die_Indices."),
    ).toBe(
      "Read <code>_dieVisual</code>, <strong>then</strong> <em>initialize</em> _EMISSION and Die_Indices.",
    );
  });

  test("formats nesting without interpreting formatting markers inside code", () => {
    expect(renderInline("**Read *this* and `a * b`**; *a **bold** choice*; ***both***.")).toBe(
      "<strong>Read <em>this</em> and <code>a * b</code></strong>; <em>a <strong>bold</strong> choice</em>; <strong><em>both</em></strong>.",
    );
  });

  test("escapes HTML in plain prose, formatted text and source-link labels", () => {
    expect(renderInline('**<img src=x onerror="alert(1)">** & `<script>`\'')).toBe(
      "<strong>&lt;img src=x onerror=&quot;alert(1)&quot;&gt;</strong> &amp; <code>&lt;script&gt;</code>&#39;",
    );
    expect(renderInline('&lt;script&gt; <a href="javascript:alert(1)">')).toBe(
      "&amp;lt;script&amp;gt; &lt;a href=&quot;javascript:alert(1)&quot;&gt;",
    );
  });

  test("does not create arbitrary Markdown links or block formatting", () => {
    const text = "# Heading\n[click](javascript:alert(1))\n- item\n![image](https://example.com/x)";
    expect(renderInline(text)).toBe(text);
  });

  test("preserves unsupported and unmatched delimiters as text", () => {
    for (const text of [
      "plain",
      "",
      "*unfinished",
      "**unfinished",
      "`unfinished",
      "****",
      "``code``",
    ]) {
      expect(renderInline(text)).toBe(text);
    }
    expect(renderInline("**unfinished *nested* text")).toBe("**unfinished <em>nested</em> text");
    expect(renderInline("2 * 3 and ** spaced **")).toBe("2 * 3 and ** spaced **");
  });

  test("backslash escapes apply only to delimiters and backslashes outside code", () => {
    expect(
      renderInline("\\*literal\\* \\`code\\` \\*\\*strong?\\*\\* \\_name C:\\temp \\\\server"),
    ).toBe("*literal* `code` **strong?** \\_name C:\\temp \\server");
    expect(renderInline("`\\*literal\\*` and `a `` b`")).toBe(
      "<code>\\*literal\\*</code> and <code>a `` b</code>",
    );
  });

  test("keeps generated HTML balanced even for malformed nesting", () => {
    expect(renderInline("*outer **inner* tail")).toBe("*outer **inner* tail");
    expect(renderInline("**outer *inner** tail")).toBe("**outer <em>inner</em>* tail");
  });
});
