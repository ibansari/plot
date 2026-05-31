import * as crypto from "crypto";
import { NonUserGatewayService } from "../src/non-user-gateway/non-user.service";
import { config } from "../src/common/config";
import { VoteValue } from "@plot/db";

// Non-user vote reconciliation: a signed link maps a guest's vote back to the plan as a Contact,
// tagged with the token for provenance. A tampered signature is rejected.
describe("NonUserGatewayService (non-user bridge)", () => {
  const planId = "p1";
  const contactId = "c_sam";
  const tokenId = "tok_123";
  const goodSig = crypto
    .createHmac("sha256", config.linkSigningSecret)
    .update([tokenId, contactId, planId, "vote"].join("|"))
    .digest("hex")
    .slice(0, 32);

  function makeService() {
    const tokenRow = {
      id: tokenId, contactId, planId, purpose: "vote",
      signature: goodSig, expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
    };
    const prisma: any = {
      nonUserToken: {
        findUnique: jest.fn(async () => tokenRow),
        update: jest.fn(async () => ({})),
      },
      contact: { findUniqueOrThrow: jest.fn(async () => ({ id: contactId, displayName: "Sam" })) },
    };
    const audit: any = { record: jest.fn() };
    const notify: any = { sendSms: jest.fn() };
    const plans: any = {
      castVote: jest.fn(async () => ({ id: planId, state: "VOTING" })),
      setRsvp: jest.fn(),
      getPlan: jest.fn(async () => ({ id: planId })),
    };
    return { svc: new NonUserGatewayService(prisma, audit, notify, plans), prisma, plans };
  }

  it("reconciles a valid signed vote as the Contact (with viaToken provenance)", async () => {
    const { svc, prisma, plans } = makeService();
    await svc.vote(tokenId, goodSig, "o1", VoteValue.UP);

    expect(plans.castVote).toHaveBeenCalledWith(
      planId,
      { contactId, viaToken: tokenId },
      "o1",
      VoteValue.UP,
    );
    // token marked used
    expect(prisma.nonUserToken.update).toHaveBeenCalled();
  });

  it("rejects a tampered signature", async () => {
    const { svc, plans } = makeService();
    await expect(svc.vote(tokenId, "deadbeef", "o1", VoteValue.UP)).rejects.toThrow(/signature/);
    expect(plans.castVote).not.toHaveBeenCalled();
  });
});
