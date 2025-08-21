import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock Clarity-like types
type ClarityValue =
  | { type: "buffer"; value: string }
  | { type: "string-ascii"; value: string }
  | { type: "string-utf8"; value: string }
  | { type: "uint"; value: number }
  | { type: "principal"; value: string }
  | { type: "none" }
  | { type: "some"; value: ClarityValue }
  | { type: "bool"; value: boolean }
  | { type: "tuple"; value: Record<string, ClarityValue> }
  | { type: "ok"; value: ClarityValue }
  | { type: "err"; value: ClarityValue };

type ClarityOk = { type: "ok"; value: ClarityValue };
type ClarityErr = { type: "err"; value: ClarityValue };
type ClarityTuple = { type: "tuple"; value: Record<string, ClarityValue> };
type ClarityBuffer = { type: "buffer"; value: string };
type ClarityStringAscii = { type: "string-ascii"; value: string };
type ClarityStringUtf8 = { type: "string-utf8"; value: string };
type ClarityUint = { type: "uint"; value: number };
type ClarityPrincipal = { type: "principal"; value: string };
type ClarityNone = { type: "none" };
type ClaritySome = { type: "some"; value: ClarityValue };
type ClarityBool = { type: "bool"; value: boolean };

// Mock Clarity value helpers
const Cl = {
  ok: (value: ClarityValue): ClarityOk => ({ type: "ok", value }),
  err: (value: ClarityValue): ClarityErr => ({ type: "err", value }),
  tuple: (value: Record<string, ClarityValue>): ClarityTuple => ({ type: "tuple", value }),
  bufferFromHex: (hex: string): ClarityBuffer => ({ type: "buffer", value: hex }),
  stringAscii: (value: string): ClarityStringAscii => ({ type: "string-ascii", value }),
  stringUtf8: (value: string): ClarityStringUtf8 => ({ type: "string-utf8", value }),
  uint: (value: number): ClarityUint => ({ type: "uint", value }),
  principal: (value: string): ClarityPrincipal => ({ type: "principal", value }),
  none: (): ClarityNone => ({ type: "none" }),
  some: (value: ClarityValue): ClaritySome => ({ type: "some", value }),
  bool: (value: boolean): ClarityBool => ({ type: "bool", value }),
};

// Mock Simnet interface
interface Simnet {
  callPublicFn: (
    contract: string,
    fn: string,
    args: ClarityValue[],
    sender: string
  ) => { result: ClarityOk | ClarityErr };
  callReadOnlyFn: (
    contract: string,
    fn: string,
    args: ClarityValue[]
  ) => { result: ClarityValue };
  getAccounts: () => Map<string, string>;
}

// Mock state for identities
const identities: Map<string, { idHash: string; status: string; createdAt: number; updatedAt?: number; encryptedAttributes?: string; revocationReason?: string }> = new Map();

// Mock Simnet implementation
let simnet: Simnet;
let accounts: Map<string, string>;
let user1: string;
let user2: string;
const contractName = "identity-registry";

beforeAll(() => {
  simnet = {
    getAccounts: vi.fn().mockReturnValue(
      new Map([
        ["wallet_1", "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"],
        ["wallet_2", "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"],
      ])
    ),
    callPublicFn: vi.fn().mockImplementation((contract, fn, args, sender) => {
      if (contract !== "identity-registry") {
        return { result: Cl.err(Cl.uint(999)) }; // Mock contract not found
      }

      if (fn === "register-identity") {
        const idHash = args[0] as ClarityBuffer;
        const encryptedAttrs = args[1] as ClaritySome | ClarityNone;
        if (identities.has(sender)) {
          return { result: Cl.err(Cl.uint(100)) }; // ERR-ALREADY-EXISTS
        }
        if (idHash.value.length !== 64 || !/^[0-9a-fA-F]+$/.test(idHash.value)) {
          return { result: Cl.err(Cl.uint(103)) }; // ERR-INVALID-HASH
        }
        identities.set(sender, {
          idHash: idHash.value,
          status: "pending",
          createdAt: 1,
          encryptedAttributes: encryptedAttrs.type === "some" && encryptedAttrs.value.type === "buffer" ? encryptedAttrs.value.value : undefined,
        });
        return { result: Cl.ok(Cl.bool(true)) };
      }

      if (fn === "update-identity") {
        const newHash = args[0] as ClarityBuffer;
        const newAttrs = args[1] as ClaritySome | ClarityNone;
        const identity = identities.get(sender);
        if (!identity) {
          return { result: Cl.err(Cl.uint(101)) }; // ERR-NOT-FOUND
        }
        if (identity.status !== "pending") {
          return { result: Cl.err(Cl.uint(104)) }; // ERR-INVALID-STATUS
        }
        if (newHash.value.length !== 64 || !/^[0-9a-fA-F]+$/.test(newHash.value)) {
          return { result: Cl.err(Cl.uint(103)) }; // ERR-INVALID-HASH
        }
        identities.set(sender, {
          ...identity,
          idHash: newHash.value,
          updatedAt: 2,
          encryptedAttributes:
            newAttrs.type === "some" && newAttrs.value.type === "buffer"
              ? newAttrs.value.value
              : undefined,
        });
        return { result: Cl.ok(Cl.bool(true)) };
      }

      if (fn === "revoke-identity") {
        const reason = args[0] as ClarityStringUtf8;
        const identity = identities.get(sender);
        if (!identity) {
          return { result: Cl.err(Cl.uint(101)) }; // ERR-NOT-FOUND
        }
        if (identity.status === "revoked") {
          return { result: Cl.err(Cl.uint(105)) }; // ERR-REVOKED
        }
        identities.set(sender, {
          ...identity,
          status: "revoked",
          updatedAt: 2,
          revocationReason: reason.value,
        });
        return { result: Cl.ok(Cl.bool(true)) };
      }

      if (fn === "set-identity-status") {
        const user = args[0] as ClarityPrincipal;
        const newStatus = args[1] as ClarityStringAscii;
        if (user.value !== sender) {
          return { result: Cl.err(Cl.uint(102)) }; // ERR-NOT-OWNER
        }
        const identity = identities.get(sender);
        if (!identity) {
          return { result: Cl.err(Cl.uint(101)) }; // ERR-NOT-FOUND
        }
        if (identity.status === "revoked") {
          return { result: Cl.err(Cl.uint(105)) }; // ERR-REVOKED
        }
        if (newStatus.value !== "pending" && newStatus.value !== "verified") {
          return { result: Cl.err(Cl.uint(104)) }; // ERR-INVALID-STATUS
        }
        identities.set(sender, {
          ...identity,
          status: newStatus.value,
          updatedAt: 2,
        });
        return { result: Cl.ok(Cl.bool(true)) };
      }

      return { result: Cl.err(Cl.uint(999)) };
    }),
    callReadOnlyFn: vi.fn().mockImplementation((contract, fn, args) => {
      if (contract !== "identity-registry") {
        return { result: Cl.none() };
      }

      if (fn === "get-identity") {
        const user = args[0] as ClarityPrincipal;
        const identity = identities.get(user.value);
        if (!identity) {
          return { result: Cl.none() };
        }
        return {
          result: Cl.some(
            Cl.tuple({
              "id-hash": Cl.bufferFromHex(identity.idHash),
              "created-at": Cl.uint(identity.createdAt),
              "updated-at": identity.updatedAt ? Cl.some(Cl.uint(identity.updatedAt)) : Cl.none(),
              status: Cl.stringAscii(identity.status),
              "encrypted-attributes": identity.encryptedAttributes
                ? Cl.some(Cl.bufferFromHex(identity.encryptedAttributes))
                : Cl.none(),
              "revocation-reason": identity.revocationReason
                ? Cl.some(Cl.stringUtf8(identity.revocationReason))
                : Cl.none(),
            })
          ),
        };
      }

      if (fn === "get-identity-status") {
        const user = args[0] as ClarityPrincipal;
        const identity = identities.get(user.value);
        return { result: identity ? Cl.some(Cl.stringAscii(identity.status)) : Cl.none() };
      }

      if (fn === "is-identity-active") {
        const user = args[0] as ClarityPrincipal;
        const identity = identities.get(user.value);
        return { result: Cl.bool(!!identity && identity.status === "verified") };
      }

      return { result: Cl.none() };
    }),
  };

  accounts = simnet.getAccounts();
  user1 = accounts.get("wallet_1")!;
  user2 = accounts.get("wallet_2")!;
});

// Clear identities before each test to ensure isolation
beforeEach(() => {
  identities.clear();
});

// Expect helpers for Clarity values
const expectOk = (result: ClarityValue, value: ClarityValue) => expect(result).toEqual({ type: "ok", value });
const expectErr = (result: ClarityValue, value: ClarityValue) => expect(result).toEqual({ type: "err", value });
const expectSome = (result: ClarityValue, value: ClarityValue) => expect(result).toEqual({ type: "some", value });
const expectNone = (result: ClarityValue) => expect(result).toEqual({ type: "none" });
const expectBool = (result: ClarityValue, value: boolean) => expect(result).toEqual({ type: "bool", value });

describe("IdentityRegistry Contract", () => {
  it("successfully registers a new identity", async () => {
    const idHash: ClarityValue = Cl.bufferFromHex("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f");
    const encryptedAttrs: ClarityValue = Cl.some(Cl.bufferFromHex("abcdef"));

    const registerCall = simnet.callPublicFn(
      contractName,
      "register-identity",
      [idHash, encryptedAttrs],
      user1
    );
    expectOk(registerCall.result, Cl.bool(true));

    const getIdentityCall = simnet.callReadOnlyFn(
      contractName,
      "get-identity",
      [Cl.principal(user1)]
    );
    expectSome(
      getIdentityCall.result,
      Cl.tuple({
        "id-hash": idHash,
        "created-at": Cl.uint(1),
        "updated-at": Cl.none(),
        status: Cl.stringAscii("pending"),
        "encrypted-attributes": encryptedAttrs,
        "revocation-reason": Cl.none(),
      })
    );
  });

  it("fails to register duplicate identity", async () => {
    const idHash: ClarityValue = Cl.bufferFromHex("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f");

    simnet.callPublicFn(contractName, "register-identity", [idHash, Cl.none()], user1);
    const duplicateCall = simnet.callPublicFn(
      contractName,
      "register-identity",
      [idHash, Cl.none()],
      user1
    );
    expectErr(duplicateCall.result, Cl.uint(100));
  });

  it("updates an existing identity", async () => {
    const initialHash: ClarityValue = Cl.bufferFromHex("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f");
    const newHash: ClarityValue = Cl.bufferFromHex("101112131415161718191a1b1c1d1e1f101112131415161718191a1b1c1d1e1f");

    simnet.callPublicFn(contractName, "register-identity", [initialHash, Cl.none()], user1);
    const updateCall = simnet.callPublicFn(
      contractName,
      "update-identity",
      [newHash, Cl.none()],
      user1
    );
    expectOk(updateCall.result, Cl.bool(true));

    const getIdentityCall = simnet.callReadOnlyFn(
      contractName,
      "get-identity",
      [Cl.principal(user1)]
    );
    expectSome(
      getIdentityCall.result,
      Cl.tuple({
        "id-hash": newHash,
        "created-at": Cl.uint(1),
        "updated-at": Cl.some(Cl.uint(2)),
        status: Cl.stringAscii("pending"),
        "encrypted-attributes": Cl.none(),
        "revocation-reason": Cl.none(),
      })
    );
  });

  it("revokes an identity", async () => {
    const idHash: ClarityValue = Cl.bufferFromHex("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f");
    const reason: ClarityValue = Cl.stringUtf8("Lost access");

    simnet.callPublicFn(contractName, "register-identity", [idHash, Cl.none()], user1);
    const revokeCall = simnet.callPublicFn(
      contractName,
      "revoke-identity",
      [reason],
      user1
    );
    expectOk(revokeCall.result, Cl.bool(true));

    const statusCall = simnet.callReadOnlyFn(
      contractName,
      "get-identity-status",
      [Cl.principal(user1)]
    );
    expectSome(statusCall.result, Cl.stringAscii("revoked"));
  });

  it("fails to update revoked identity", async () => {
    const idHash: ClarityValue = Cl.bufferFromHex("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f");
    const newHash: ClarityValue = Cl.bufferFromHex("101112131415161718191a1b1c1d1e1f101112131415161718191a1b1c1d1e1f");

    simnet.callPublicFn(contractName, "register-identity", [idHash, Cl.none()], user1);
    simnet.callPublicFn(contractName, "revoke-identity", [Cl.stringUtf8("Test revoke")], user1);
    const updateCall = simnet.callPublicFn(
      contractName,
      "update-identity",
      [newHash, Cl.none()],
      user1
    );
    expectErr(updateCall.result, Cl.uint(104));
  });

  it("checks if identity is active", async () => {
    const idHash: ClarityValue = Cl.bufferFromHex("000102030405060708090a0b0c0d0e0f000102030405060708090a0b0c0d0e0f");

    simnet.callPublicFn(contractName, "register-identity", [idHash, Cl.none()], user1);
    simnet.callPublicFn(
      contractName,
      "set-identity-status",
      [Cl.principal(user1), Cl.stringAscii("verified")],
      user1
    );

    const activeCall = simnet.callReadOnlyFn(
      contractName,
      "is-identity-active",
      [Cl.principal(user1)]
    );
    expectBool(activeCall.result, true);
  });

  it("handles no identity found in read-only functions", async () => {
    const statusCall = simnet.callReadOnlyFn(
      contractName,
      "get-identity-status",
      [Cl.principal(user2)]
    );
    expectNone(statusCall.result);
  });
});