// Coach Settings UI (UI restyle step 2.7). Pinned:
//   • the PayNow card says whether a PayNow ID is set — Success when set, Warning
//     when not (it needs doing) — and the fallback upload stays reachable behind
//     its toggle (it is the only writer of tenants.paynow_qr_url);
//   • Sign Out goes through the screen's confirmLogout (confirmAction), in Danger text.
//
// MUTATION PROOFS (§7.25) — each applied, run, reverted:
//   1. PayNowQrCard: `border-status-warning-border bg-status-warning-bg` → the success pair
//      → RED: "no PayNow ID → a Warning panel; set → Success"
//   2. PayNowQrCard: `onPress={() => setShowQrUpload((v) => !v)}` → `onPress={() => {}}`
//      → RED: "the fallback toggle flips, and the expanded card offers the upload"
//   3. SignOutButton: `onPress={confirmLogout}` → `onPress={() => {}}`
//      → RED: "Sign Out is confirmLogout, in Danger text"
//   4. Avatar: `{coachTitle(session?.fullName)}` → `Coach {session?.fullName ?? "—"}`
//      → RED: "the title never doubles 'Coach'"
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { PayNowQrCard } from "./PayNowQrCard";
import { SignOutButton } from "./SignOutButton";
import { Avatar } from "./Avatar";

jest.mock("@expo/vector-icons", () => {
  const { Text } = jest.requireActual("react-native");
  return { Ionicons: (p: { name: string }) => <Text>{`icon:${p.name}`}</Text> };
});

function renderCard(over: Partial<{ hasPaynowId: boolean; showQrUpload: boolean }> = {}) {
  const setShowQrUpload = jest.fn();
  const handleUploadQR = jest.fn();
  render(
    <PayNowQrCard
      hasPaynowId={over.hasPaynowId ?? false}
      showQrUpload={over.showQrUpload ?? false}
      setShowQrUpload={setShowQrUpload}
      paynowUrl={null}
      uploading={false}
      handleUploadQR={handleUploadQR}
    />
  );
  return { setShowQrUpload, handleUploadQR };
}

/** The class string of the bordered panel holding `text` (the nearest ancestor
 *  whose className carries a border — the Text's own parent is a composite). */
function panelOf(text: RegExp): string {
  let node = screen.getByText(text).parent;
  while (node && !/\bborder\b/.test(node.props.className ?? "")) node = node.parent;
  return node?.props.className ?? "";
}

describe("coach Settings UI", () => {
  it("no PayNow ID → a Warning panel; set → Success", () => {
    renderCard({ hasPaynowId: false });
    expect(panelOf(/^No PayNow ID set yet/)).toContain("bg-status-warning-bg");
    renderCard({ hasPaynowId: true });
    expect(panelOf(/^Your PayNow ID is set/)).toContain("bg-status-success-bg");
  });

  it("the fallback toggle flips, and the expanded card offers the upload", () => {
    const { setShowQrUpload } = renderCard();
    fireEvent.press(screen.getByText("Fallback QR image — advanced"));
    const flip = setShowQrUpload.mock.calls[0][0] as (v: boolean) => boolean;
    expect(flip(false)).toBe(true);
    const open = renderCard({ showQrUpload: true });
    fireEvent.press(screen.getByText("Upload QR Code"));
    expect(open.handleUploadQR).toHaveBeenCalledTimes(1);
  });

  it("Sign Out is confirmLogout, in Danger text", () => {
    const confirmLogout = jest.fn();
    render(<SignOutButton confirmLogout={confirmLogout} />);
    fireEvent.press(screen.getByText("Sign Out"));
    expect(confirmLogout).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Sign Out").props.className).toContain("text-status-danger-text");
  });

  it("the title never doubles 'Coach'", () => {
    const session = { fullName: "Coach Marcus", email: "m@x.sg" } as Parameters<typeof Avatar>[0]["session"];
    render(<Avatar session={session} />);
    expect(screen.getByText("Coach Marcus")).toBeTruthy();
    expect(screen.queryByText(/Coach Coach/)).toBeNull();
  });
});
