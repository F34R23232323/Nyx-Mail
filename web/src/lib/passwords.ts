import argon2 from "argon2";

const OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function passwordLooksAcceptable(password: string, email: string): string | null {
  if (password.length < 10) return "Use at least 10 characters";
  if (password.length > 200) return "Password is too long";
  if (!/[a-z]/i.test(password)) return "Include at least one letter";
  if (!/[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return "Include a number or symbol";
  }
  if (password.toLowerCase().includes(email.split("@")[0]?.toLowerCase() || "___")) {
    return "Password must not contain your email name";
  }
  return null;
}
