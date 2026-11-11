import { tabFromParam } from "./tabParam";

it("maps ?tab= to a Billing tab", () => {
  expect(tabFromParam("packages")).toBe("Packages");
  expect(tabFromParam("Packages")).toBe("Packages");
  expect(tabFromParam(["credit-notes"])).toBe("Credit Notes");
  expect(tabFromParam("invoices")).toBe("Invoices");
});
it("anything else changes nothing", () => {
  expect(tabFromParam(undefined)).toBeNull();
  expect(tabFromParam("")).toBeNull();
  expect(tabFromParam("bogus")).toBeNull();
});
