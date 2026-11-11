// The Profile tab's own copy of Add Child (Profile → Add Child Profile), so the
// tab bar keeps Profile highlighted instead of jumping to Home. Same screen as
// app/(parent)/home/add-child.tsx; its exits are router.back() and its Join link
// follows the current stack (features/add-child/domain/joinTenantHref).
export { default } from "../home/add-child";
