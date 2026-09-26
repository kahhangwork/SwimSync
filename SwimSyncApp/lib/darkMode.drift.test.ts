// NativeWind's dark mode must stay "class", and the app must not use `dark:`.
//
// Under the default "media", react-native-css-interop's web runtime threw an
// uncaught "Cannot manually set color scheme, as dark mode is type 'media'" on
// EVERY page load: global.css sets the darkMode flag after color-scheme.js has
// loaded, and the MutationObserver that notices it calls colorScheme.set(),
// which refuses under "media" (found by verify-smoke-app 2026-09-13).
//
// "class" is inert here ONLY because the app is light-only — app.json pins
// userInterfaceStyle "light" and no className carries a `dark:` variant. A
// `dark:` class under "class" would only apply with <html class="dark">, i.e.
// never. Adding dark mode means revisiting this file, not deleting it.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..");

describe("NativeWind dark mode", () => {
  it('tailwind.config.js sets darkMode: "class"', () => {
    const config = require(path.join(ROOT, "tailwind.config.js"));
    expect(config.darkMode).toBe("class");
  });

  it("app.json keeps the app light-only", () => {
    const app = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));
    expect(app.expo.userInterfaceStyle).toBe("light");
  });

  it("no source file uses a dark: variant", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name) && !e.name.includes(".test.") && /\bdark:/.test(fs.readFileSync(p, "utf8")))
          hits.push(path.relative(ROOT, p));
      }
    };
    for (const d of ["app", "components", "features", "lib"]) walk(path.join(ROOT, d));
    expect(hits).toEqual([]);
  });
});
