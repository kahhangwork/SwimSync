import { joinTenantHref } from "./joinTenantHref";

// Profile → Add Child Profile → "+ Add another coach or school" must stay in the
// Profile stack, so the tab bar keeps Profile highlighted.
it("from the Profile stack, opens the Profile copy", () => {
  expect(joinTenantHref(["(parent)", "profile", "add-child"])).toBe("/(parent)/profile/join-tenant");
});
it("from the Home stack (and anywhere else), opens the Home copy", () => {
  expect(joinTenantHref(["(parent)", "home", "add-child"])).toBe("/(parent)/home/join-tenant");
  expect(joinTenantHref([])).toBe("/(parent)/home/join-tenant");
});
