import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const designSystemCss = fs.readFileSync(new URL("../css/design-system.css", import.meta.url), "utf8");
const portalCss = fs.readFileSync(new URL("../css/portal.css", import.meta.url), "utf8");

function themeTokens(theme) {
  const root = designSystemCss.match(/:root\s*\{([^}]+)\}/);
  const role = designSystemCss.match(new RegExp(`body\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`));
  assert.ok(root, "missing shared root tokens");
  assert.ok(role, `missing ${theme} theme tokens`);
  const value = (name, required = true) => {
    const declaration = role[1].match(new RegExp(`--ds-${name}:\\s*(#[0-9a-f]{6})`, "i"))
      || root[1].match(new RegExp(`--ds-${name}:\\s*(#[0-9a-f]{6})`, "i"));
    if (!declaration && !required) return null;
    assert.ok(declaration, `missing --ds-${name} token for ${theme}`);
    return declaration[1];
  };
  return {
    muted: value("muted"),
    paper: value("paper"),
    accent: value("accent"),
    accentSoft: value("accent-soft"),
    sidebar: value("sidebar", false),
    sidebarText: value("sidebar-text", false),
    sidebarLink: value("sidebar-link", false),
    sidebarActive: value("sidebar-active", false),
    focusOutline: value("focus-outline", false),
  };
}

function luminance(color) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

test("all four shared themes meet WCAG AA contrast", () => {
  for (const theme of ["customer", "partner", "admin", "distributor"]) {
    const tokens = themeTokens(theme);
    assert.ok(contrast(tokens.muted, tokens.paper) >= 4.5, `${theme} muted text contrast`);
    assert.ok(contrast(tokens.accent, tokens.accentSoft) >= 4.5, `${theme} accent text contrast`);
    assert.ok(contrast("#ffffff", tokens.accent) >= 4.5, `${theme} button text contrast`);
    if (theme !== "distributor") {
      assert.ok(contrast(tokens.sidebarText, tokens.sidebar) >= 4.5, `${theme} sidebar text contrast`);
      assert.ok(contrast(tokens.sidebarLink, tokens.sidebar) >= 4.5, `${theme} sidebar link contrast`);
      assert.ok(contrast("#ffffff", tokens.sidebar) >= 4.5, `${theme} sidebar focus contrast`);
      if (theme === "admin") {
        assert.ok(contrast(tokens.focusOutline, tokens.sidebar) >= 3, `${theme} focus outline contrast`);
        assert.ok(contrast(tokens.focusOutline, tokens.sidebarActive) >= 3, `${theme} active-navigation focus contrast`);
      }
    }
  }
});

test("customer, partner, admin, and distributor pages consume the shared theme", () => {
  for (const [file, theme] of [
    ["portal.html", "customer"],
    ["partner.html", "partner"],
    ["admin.html", "admin"],
    ["distributor.html", "distributor"],
  ]) {
    const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`<body[^>]*data-theme="${theme}"`), `${file} theme`);
    assert.match(html, /href="css\/design-system\.css/, `${file} shared stylesheet`);
  }
});

test("authenticated portal navigation has mobile toggles and announced current views", () => {
  for (const [file, scriptFile, toggleId, navId, navSelector] of [
    ["portal.html", "portal.js", "customerMobileNavToggle", "customerNavigation", ".nav.is-open"],
    ["partner.html", "partner.js", "partnerMobileNavToggle", "partnerNavigation", ".partner-nav.is-open"],
    ["admin.html", "admin.js", "adminMobileNavToggle", "adminNavigation", ".admin-nav.is-open"],
  ]) {
    const html = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const script = fs.readFileSync(new URL(`../js/${scriptFile}`, import.meta.url), "utf8");
    assert.match(html, new RegExp(`id="${toggleId}"[^>]*aria-expanded="false"[^>]*aria-controls="${navId}"`));
    assert.match(html, new RegExp(`<nav id="${navId}"`));
    assert.match(html, /aria-current="page"/);
    assert.match(script, /setAttribute\('aria-current', 'page'\)/);
    assert.match(script, /classList\.toggle\('is-open'/);
    assert.ok(
      file === "portal.html" ? portalCss.includes(navSelector) : html.includes(navSelector),
      `${file} reveals its navigation when expanded`,
    );
  }
  assert.match(designSystemCss, /:where\(a,button,input,select,textarea,\[tabindex\]\):focus-visible/);
  assert.match(designSystemCss, /outline:3px solid var\(--ds-accent\)/);
  assert.match(designSystemCss, /outline-color:var\(--ds-focus-on-dark\)/);
});
