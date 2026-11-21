#!/usr/bin/env node
import { randomBytes } from "node:crypto";

console.log(`JWT_SECRET="${randomBytes(48).toString("base64url")}"`);
console.log(`APP_ENCRYPTION_KEY="${randomBytes(32).toString("hex")}"`);
console.log(`RECOVERY_PEPPER="${randomBytes(32).toString("base64url")}"`);
console.log(`INGEST_SECRET="${randomBytes(32).toString("base64url")}"`);
