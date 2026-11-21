import { test } from "node:test";
import assert from "node:assert/strict";
import { imageBlobType, sniffImageType } from "./contentScan/media";
import { bodyPreviewText, buildImageMarkdown, splitBodyImages } from "./contentScan/bodyImages";
import { dropTitleHeading, markdownTooDeep } from "./markdownPreview";
import { bodyFormat, firstImage, previewText } from "./contentScan/bodyFormat";
import { htmlBodyImages, parseHtmlBody, scannerUris, type HtmlNode } from "./contentScan/htmlBody";

test("plain text is one text segment", () => {
  assert.deepEqual(splitBodyImages("hello\nworld"), [{ type: "text", text: "hello\nworld" }]);
  assert.deepEqual(splitBodyImages(""), []);
});

test("an image link splits the body and drops the line breaks around it", () => {
  assert.deepEqual(splitBodyImages("before\n![a cat](https://example.com/cat.png)\nafter"), [
    { type: "text", text: "before" },
    { type: "image", uri: "https://example.com/cat.png", alt: "a cat" },
    { type: "text", text: "after" },
  ]);
});

test("titles, empty descriptions and several images", () => {
  assert.deepEqual(splitBodyImages('![](http://a.test/1.jpg "one") and ![two]( https://b.test/2.jpg )'), [
    { type: "image", uri: "http://a.test/1.jpg", alt: "" },
    { type: "text", text: " and " },
    { type: "image", uri: "https://b.test/2.jpg", alt: "two" },
  ]);
});

test("the captured URI is what the scanner's pattern captures", () => {
  // Scheme case is kept as written; the URI stops at whitespace, quotes,
  // parentheses and angle brackets.
  const [img] = splitBodyImages("![x](HTTPS://Example.com/a_(1).png)");
  assert.deepEqual(img, { type: "text", text: "![x](HTTPS://Example.com/a_(1).png)" });
  const segs = splitBodyImages("![x](HTTPS://Example.com/a%281%29.png)");
  assert.deepEqual(segs, [{ type: "image", uri: "HTTPS://Example.com/a%281%29.png", alt: "x" }]);
});

test("incomplete or non-image syntax stays text", () => {
  for (const s of [
    "![x](https://example.com/a.png",
    "[x](https://example.com/a.png)",
    "![x](javascript:alert(1))",
    "![x](data:image/png;base64,AAAA)",
    "![x](/relative.png)",
  ]) {
    assert.deepEqual(splitBodyImages(s), [{ type: "text", text: s }], s);
  }
});

test("previews replace images with a label", () => {
  assert.equal(bodyPreviewText("look\n![a cat](https://example.com/cat.png)\nnice"), "look [image: a cat] nice");
  assert.equal(bodyPreviewText("![](https://example.com/cat.png)"), "[image]");
  assert.equal(bodyPreviewText("![a](https://example.com/a.png)", { skipFirstImage: true }), "");
  assert.equal(
    bodyPreviewText("look\n![a](https://example.com/a.png)\n![b](https://example.com/b.png)", { skipFirstImage: true }),
    "look [image: b]"
  );
});

test("buildImageMarkdown round-trips through the parser", () => {
  const md = buildImageMarkdown(" https://example.com/a (1).png ", "x");
  assert.equal(md, null);
  const ok = buildImageMarkdown("https://example.com/a_(1).png", "a [nice]\ncat");
  assert.equal(ok, "![a nice cat](https://example.com/a_%281%29.png)");
  assert.deepEqual(splitBodyImages(ok!), [
    { type: "image", uri: "https://example.com/a_%281%29.png", alt: "a nice cat" },
  ]);
  assert.equal(buildImageMarkdown("ftp://example.com/a.png", ""), null);
  assert.equal(buildImageMarkdown("example.com/a.png", ""), null);
});

test("sniffImageType recognises raster images by their bytes only", () => {
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  assert.equal(sniffImageType(bytes("\x89PNG\r\n\x1a\n....")), "image/png");
  assert.equal(sniffImageType(bytes("\xff\xd8\xff\xe0..")), "image/jpeg");
  assert.equal(sniffImageType(bytes("GIF89a....")), "image/gif");
  assert.equal(sniffImageType(bytes("BM\x36\x00\x00\x00")), "image/bmp");
  assert.equal(sniffImageType(bytes("RIFF\x00\x00\x00\x00WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(bytes("\x00\x00\x00\x1cftypavif")), "image/avif");
  assert.equal(sniffImageType(bytes("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.equal(sniffImageType(bytes("<!doctype html>")), null);
  assert.equal(sniffImageType(new Uint8Array()), null);
});

test("imageBlobType refuses SVG and falls back to the bytes", () => {
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const png = bytes("\x89PNG\r\n\x1a\n....");
  const svg = bytes("<svg xmlns='http://www.w3.org/2000/svg'/>");
  assert.equal(imageBlobType("image/png", png), "image/png");
  assert.equal(imageBlobType("application/octet-stream", png), "image/png");
  assert.equal(imageBlobType("", png), "image/png");
  assert.equal(imageBlobType("application/octet-stream", bytes("BM\x36\x00\x00\x00")), "image/bmp");
  assert.equal(imageBlobType("image/svg+xml", svg), null);
  assert.equal(imageBlobType("Image/SVG+XML; charset=utf-8", svg), null);
  assert.equal(imageBlobType("text/xml", svg), null);
  assert.equal(imageBlobType("application/octet-stream", svg), null);
});

test("ar:// addresses are fetchable and name one Arweave id", async () => {
  const { arweaveId, isFetchableUri } = await import("./contentScan/media");
  const id = "JNC6vBhjHY1EPwV3pEeNmrsgFMxH5d38_LHsZ7jful8";
  assert.equal(arweaveId(`ar://${id}`), id);
  assert.equal(arweaveId(`ar://${id}/extra`), null);
  assert.equal(arweaveId(`https://arweave.net/${id}`), null);
  assert.ok(isFetchableUri(`ar://${id}`) && isFetchableUri("https://example.com/a.png") && !isFetchableUri("ipfs://bafy"));
});

test("markdown previews drop the markup and keep the words", () => {
  const md = "## Release v1.1.1\n\nNew since v1.0.58:\n\n- **Storage (x/storage):** copy a PNG.\n1. `code` and *soft* and snake_case_name\n> [docs](https://example.com) \\*kept\\*\n---\n```\nraw **code**\n```";
  assert.equal(
    bodyPreviewText(md, { markdown: true }),
    "Release v1.1.1\n\nNew since v1.0.58:\n\nStorage (x/storage): copy a PNG.\ncode and soft and snake_case_name\ndocs *kept*\nraw **code**"
  );
  // Plain text bodies are left as written.
  assert.equal(bodyPreviewText("## not a heading"), "## not a heading");
  assert.equal(
    bodyPreviewText("# Hi\n![a cat](https://example.com/cat.png)\n- one", { markdown: true }),
    "Hi [image: a cat] one"
  );
});

test("an opening heading that repeats the title is dropped", () => {
  assert.equal(dropTitleHeading("## Spark  Dream v1.1.1 ##\n\nBody\n## Spark Dream v1.1.1", "spark dream v1.1.1"), "Body\n## Spark Dream v1.1.1");
  assert.equal(dropTitleHeading("\n# **Hello**", "Hello"), "");
  assert.equal(dropTitleHeading("## Other\nBody", "Hello"), "## Other\nBody");
  assert.equal(dropTitleHeading("Hello\n## Hello", "Hello"), "Hello\n## Hello");
  assert.equal(dropTitleHeading("## \nBody", ""), "## \nBody");
  assert.equal(bodyPreviewText("## Hello\n\n- one", { markdown: true, title: "Hello" }), "one");
  assert.equal(bodyPreviewText("## Hello\n\n- one", { title: "Hello" }), "## Hello\n\n- one");
});

test("an HTML body keeps formatting and drops everything active", () => {
  const tree = parseHtmlBody(
    '<h2 onclick="x()">Hi</h2><p style="color:red">a <b>bold</b> <a href="javascript:alert(1)" target="_blank">link</a></p>' +
      "<script>alert(1)</script><style>p{}</style><iframe src=\"https://e.com\"></iframe><custom-el>kept <i>words</i></custom-el>"
  );
  assert.deepEqual(tree, [
    { type: "element", tag: "h2", children: [{ type: "text", text: "Hi" }] },
    {
      type: "element",
      tag: "p",
      children: [
        { type: "text", text: "a " },
        { type: "element", tag: "strong", children: [{ type: "text", text: "bold" }] },
        { type: "text", text: " " },
        { type: "element", tag: "a", children: [{ type: "text", text: "link" }], href: "javascript:alert(1)" },
      ],
    },
    { type: "text", text: "kept " },
    { type: "element", tag: "em", children: [{ type: "text", text: "words" }] },
  ]);
});

test("an HTML image is drawn only when its address is one the scanner finds", () => {
  const img = (html: string) => htmlBodyImages(html);
  assert.deepEqual(img('<img src="https://example.com/a.png" alt=" a cat ">'), [{ uri: "https://example.com/a.png", alt: "a cat" }]);
  assert.deepEqual(img("<IMG SRC=https://example.com/a.png>"), [{ uri: "https://example.com/a.png", alt: "" }]);
  // The scanner sees the raw text: an address it reads differently, or not at
  // all, has no verdict, so the image stays text.
  assert.deepEqual(img('<img src="https://example.com/a.png?x=1&amp;y=2">'), []);
  assert.deepEqual(img('<img src="https://example.com/a_(1).png">'), []);
  assert.deepEqual(img('<img src="data:image/png;base64,AAAA">'), []);
  assert.deepEqual(img('<img src="/relative.png">'), []);
  assert.deepEqual(img('<img src="&#104;ttps://example.com/a.png">'), []);
  // The composer's Markdown image link works inside HTML too, but not in code.
  assert.deepEqual(img("<p>x ![a](https://example.com/b.png)</p><pre>![c](https://example.com/c.png)</pre>"), [
    { uri: "https://example.com/b.png", alt: "a" },
  ]);
  assert.deepEqual(firstImage('<p><img src="https://example.com/a.png"></p>', "html"), { uri: "https://example.com/a.png", alt: "" });
  assert.deepEqual([...scannerUris('<a href = "https://e.com/x">y</a> xsrc="https://no.example/z"')], ["https://e.com/x"]);
});

test("HTML previews are the words, without a heading that repeats the title", () => {
  const html = "<h1>My  Title</h1>\n<p>First   line<br>second &amp; third</p><ul><li>one</li><li><b>two</b></li></ul><img src=\"https://example.com/a.png\" alt=\"pic\"><script>x</script>";
  assert.equal(previewText(html, { format: "html", title: "my title" }), "First line\nsecond & third\none\ntwo\n[image: pic]");
  assert.equal(previewText(html, { format: "html", skipFirstImage: true }), "My Title\nFirst line\nsecond & third\none\ntwo");
  assert.equal(previewText("<b>x</b>"), "<b>x</b>");
  assert.equal(previewText("## Hello\n\n- one", { format: "markdown", title: "Hello" }), "one");
  assert.equal(bodyFormat("CONTENT_TYPE_HTML"), "html");
  assert.equal(bodyFormat(3), "markdown");
  assert.equal(bodyFormat("CONTENT_TYPE_TEXT"), null);
});

test("a body nested thousands deep is flattened, never thrown on", () => {
  const depth = (nodes: HtmlNode[]): number =>
    nodes.reduce((d, n) => Math.max(d, n.type === "element" ? 1 + depth(n.children) : 0), 0);
  for (const open of ["<div>", "<b>", "<ul><li>", "<table><tr><td>", "<blockquote>"]) {
    const tree = parseHtmlBody(open.repeat(2000) + "deep words");
    assert.ok(depth(tree) <= 32, `${open} nests ${depth(tree)} deep`);
    assert.doesNotThrow(() => previewText(open.repeat(2000) + "deep words", { format: "html" }));
  }
  assert.equal(previewText("<div>".repeat(100) + "deep words", { format: "html" }), "deep words");
  assert.equal(markdownTooDeep(">".repeat(5000) + " x"), true);
  assert.equal(markdownTooDeep("- + ".repeat(500) + "x"), true);
  assert.equal(markdownTooDeep("> - 1. nested a little\n    - and indented\n> > quote"), false);
  // A long body's preview is worked out from its start only.
  assert.ok(previewText("**a ".repeat(50_000), { format: "markdown" }).length < 4100);
});
