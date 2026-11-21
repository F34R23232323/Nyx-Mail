#!/usr/bin/env node
/**
 * Prints the current demo TOTP code for the seeded account.
 * The seed script uses the well-known test secret below. Never use this
 * secret for a real account.
 */
import { authenticator } from "otplib";

const secret = process.env.DEMO_TOTP_SECRET || "JBSWY3DPEHPK3PXP";
const code = authenticator.generate(secret);
const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(`Demo TOTP secret: ${secret}`);
console.log(`Current code:     ${code} (valid ${remaining}s)`);
