import { geistCss, GEIST_STACK } from "./geistCss";

describe("geistCss", () => {
  const css = geistCss([
    [400, "/a.ttf"],
    [500, "/b.ttf"],
    [600, "/c.ttf"],
  ]);

  it("declares one Geist face per weight, so font-semibold uses the real 600 file", () => {
    const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
    expect(faces).toHaveLength(3);
    expect(faces.map((f) => f.match(/font-weight:(\d+)/)?.[1])).toEqual(["400", "500", "600"]);
    for (const f of faces) expect(f).toContain("font-family:Geist;");
    expect(faces[2]).toContain('src:url("/c.ttf")');
  });

  it("reaches RN-web Text and TextInput through `dir`, never a dev-only class name", () => {
    expect(css).toContain(`html [dir]{font-family:${GEIST_STACK}}`);
    // RN-web's class is css-text-<hash> in dev but css-<hash> in production.
    expect(css).not.toMatch(/css-text/);
  });
});
