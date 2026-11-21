import { test } from "node:test";
import assert from "node:assert/strict";
import { imageBlobType, sniffImageType } from "./contentScan/media";
import { bodyPreviewText, buildImageMarkdown, splitBodyImages } from "./contentScan/bodyImages";

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
