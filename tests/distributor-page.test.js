import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const html = fs.readFileSync(new URL("../distributor.html", import.meta.url), "utf8");
const capabilityMatrix = fs.readFileSync(new URL("../docs/PORTAL_CAPABILITY_MATRIX.md", import.meta.url), "utf8");

test("distributor page describes product capabilities instead of an authenticated workspace", () => {
  assert.match(html, /Distributor product capabilities/);
  assert.match(html, /Availability depends on edition, deployment and agreed implementation scope/);
  assert.doesNotMatch(html, /Distributor workspace|operations in one workspace|DEPLOYMENT DEPENDENT/);
});

test("distributor page uses full-body Saathi artwork in both illustrations", () => {
  assert.equal((html.match(/saathi_(?:male|female)_fullbody_hd\.png/g) || []).length, 2);
  assert.doesNotMatch(html, /pose_(?:male_3_folder_pointing|female_3_laptop)\.png/);

  for (const asset of ["saathi_male_fullbody_hd.png", "saathi_female_fullbody_hd.png"]) {
    const image = fs.readFileSync(new URL(`../assets/SmritiSathi/${asset}`, import.meta.url));
    assert.equal(image.toString("ascii", 1, 4), "PNG");
    assert.ok(image.readUInt32BE(16) >= 300, `${asset} should have a high-resolution width`);
    assert.ok(image.readUInt32BE(20) >= 500, `${asset} should have a full-body height`);
  }
});

test("capability documentation separates the public distributor page from an authenticated portal", () => {
  assert.match(capabilityMatrix, /Distributor public page/);
  assert.match(capabilityMatrix, /No distinct distributor-only order, credit, dispatch, or network-management portal/);
  assert.match(capabilityMatrix, /deployment-dependent wording/);
});
