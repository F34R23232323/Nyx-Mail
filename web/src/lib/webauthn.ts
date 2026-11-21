import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  AuthenticatorDevice,
  Base64URLString,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";
import type { User } from "@nyxmail/db";
import { expectedOrigin, rpId } from "./env";

export interface StoredCredential {
  id: Base64URLString;
  publicKey: string;
  counter: number;
  transports: AuthenticatorDevice["transports"];
  deviceType?: string;
  backedUp?: boolean;
  createdAt: string;
  name?: string;
}

export function storedCredentials(user: Pick<User, "webauthnCredentials">): StoredCredential[] {
  if (!Array.isArray(user.webauthnCredentials)) return [];
  return (user.webauthnCredentials as unknown[])
    .filter(
      (item): item is StoredCredential =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as StoredCredential).id === "string" &&
        typeof (item as StoredCredential).publicKey === "string",
    )
    .map((item) => ({ ...item, counter: Number(item.counter || 0) }));
}

export async function buildRegistrationOptions(
  user: Pick<User, "id" | "email" | "displayName" | "webauthnCredentials">,
) {
  const credentials = storedCredentials(user);
  return generateRegistrationOptions({
    rpName: "NyxMail",
    rpID: rpId(),
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.displayName,
    attestationType: "none",
    excludeCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: undefined,
    },
    supportedAlgorithmIDs: [-7, -257],
  });
}

export async function verifyRegistration(
  user: Pick<User, "id" | "webauthnCredentials">,
  response: RegistrationResponseJSON,
  challenge: string,
  name?: string,
): Promise<{ credential: StoredCredential; credentials: StoredCredential[] }> {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: expectedOrigin(),
    expectedRPID: rpId(),
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Passkey registration could not be verified");
  }
  const info = verification.registrationInfo;
  const credential: StoredCredential = {
    id: info.credentialID,
    publicKey: Buffer.from(info.credentialPublicKey).toString("base64url"),
    counter: info.counter,
    transports: response.response.transports as AuthenticatorDevice["transports"],
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    createdAt: new Date().toISOString(),
    name: name?.slice(0, 60) || "Passkey",
  };
  const existing = storedCredentials(user).filter((item) => item.id !== credential.id);
  return { credential, credentials: [...existing, credential] };
}

export async function buildAuthenticationOptions(
  user: Pick<User, "webauthnCredentials">,
) {
  const credentials = storedCredentials(user);
  if (credentials.length === 0) throw new Error("No passkeys registered");
  return generateAuthenticationOptions({
    rpID: rpId(),
    allowCredentials: credentials.map((credential) => ({
      id: credential.id,
      transports: credential.transports,
    })),
    userVerification: "preferred",
  });
}

export async function verifyAuthentication(
  user: Pick<User, "webauthnCredentials">,
  response: AuthenticationResponseJSON,
  challenge: string,
): Promise<{ credential: StoredCredential; newCounter: number }> {
  const credentials = storedCredentials(user);
  const credential = credentials.find((item) => item.id === response.id);
  if (!credential) throw new Error("Unknown passkey");
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: expectedOrigin(),
    expectedRPID: rpId(),
    authenticator: {
      credentialID: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey, "base64url"),
      counter: credential.counter,
      transports: credential.transports,
    },
    requireUserVerification: false,
  });
  if (!verification.verified) throw new Error("Passkey verification failed");
  return { credential, newCounter: verification.authenticationInfo.newCounter };
}

export function updateCredentialCounter(
  credentials: StoredCredential[],
  id: string,
  counter: number,
): StoredCredential[] {
  return credentials.map((credential) =>
    credential.id === id ? { ...credential, counter } : credential,
  );
}
