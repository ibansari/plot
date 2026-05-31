"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = __importStar(require("crypto"));
const non_user_service_1 = require("../src/non-user-gateway/non-user.service");
const config_1 = require("../src/common/config");
const db_1 = require("@plot/db");
// Non-user vote reconciliation: a signed link maps a guest's vote back to the plan as a Contact,
// tagged with the token for provenance. A tampered signature is rejected.
describe("NonUserGatewayService (non-user bridge)", () => {
    const planId = "p1";
    const contactId = "c_sam";
    const tokenId = "tok_123";
    const goodSig = crypto
        .createHmac("sha256", config_1.config.linkSigningSecret)
        .update([tokenId, contactId, planId, "vote"].join("|"))
        .digest("hex")
        .slice(0, 32);
    function makeService() {
        const tokenRow = {
            id: tokenId, contactId, planId, purpose: "vote",
            signature: goodSig, expiresAt: new Date(Date.now() + 3600_000), usedAt: null,
        };
        const prisma = {
            nonUserToken: {
                findUnique: jest.fn(async () => tokenRow),
                update: jest.fn(async () => ({})),
            },
            contact: { findUniqueOrThrow: jest.fn(async () => ({ id: contactId, displayName: "Sam" })) },
        };
        const audit = { record: jest.fn() };
        const notify = { sendSms: jest.fn() };
        const plans = {
            castVote: jest.fn(async () => ({ id: planId, state: "VOTING" })),
            setRsvp: jest.fn(),
            getPlan: jest.fn(async () => ({ id: planId })),
        };
        return { svc: new non_user_service_1.NonUserGatewayService(prisma, audit, notify, plans), prisma, plans };
    }
    it("reconciles a valid signed vote as the Contact (with viaToken provenance)", async () => {
        const { svc, prisma, plans } = makeService();
        await svc.vote(tokenId, goodSig, "o1", db_1.VoteValue.UP);
        expect(plans.castVote).toHaveBeenCalledWith(planId, { contactId, viaToken: tokenId }, "o1", db_1.VoteValue.UP);
        // token marked used
        expect(prisma.nonUserToken.update).toHaveBeenCalled();
    });
    it("rejects a tampered signature", async () => {
        const { svc, plans } = makeService();
        await expect(svc.vote(tokenId, "deadbeef", "o1", db_1.VoteValue.UP)).rejects.toThrow(/signature/);
        expect(plans.castVote).not.toHaveBeenCalled();
    });
});
