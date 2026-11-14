import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../smriti-vs-shoper9.html", import.meta.url), "utf8");
const products = fs.readFileSync(new URL("../products.html", import.meta.url), "utf8");
const sitemap = fs.readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");

test("SMRITI and Shoper 9 comparison is transparent and sourced", () => {
  assert.match(html, /SMRITI vs Shoper 9/);
  assert.match(html, /Tally Solutions: Shoper 9 product page/);
  assert.match(html, /TallyHelp: Shoper 9 overview and capabilities/);
  assert.match(html, /SMRITI public product truth/);
  assert.match(html, /Shoper 9: pros/);
  assert.match(html, /Shoper 9: cons or watch-outs/);
  assert.match(html, /SMRITI: pros/);
  assert.match(html, /SMRITI: cons or watch-outs/);
});

test("comparison labels unverified and deployment-dependent capabilities", () => {
  assert.match(html, /Deployment dependent/);
  assert.match(html, /Planned \/ deployment dependent/);
  assert.match(html, /offline local capture, queueing and synchronization are planned/);
  assert.match(html, /no price is asserted here/);
});

test("comparison page is linked from product discovery and sitemap", () => {
  assert.match(products, /smriti-vs-shoper9\.html/);
  assert.match(sitemap, /https:\/\/smritisys\.com\/smriti-vs-shoper9\.html/);
});
