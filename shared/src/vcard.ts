import type { ContactDTO } from "./types";
import { isEmail, normalizeEmail } from "./utils";

export interface VCardContact {
  name: string;
  email: string;
}

function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function unescapeValue(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

export function contactsToVCard(contacts: Array<ContactDTO | VCardContact>): string {
  const cards = contacts.map((contact) => {
    const name = contact.name || "";
    const email = contact.email;
    return [
      "BEGIN:VCARD",
      "VERSION:3.0",
      `FN:${escapeValue(name || email)}`,
      `N:${escapeValue(name)};;;;`,
      `EMAIL;TYPE=INTERNET:${email}`,
      "END:VCARD",
    ].join("\r\n");
  });
  return `${cards.join("\r\n")}\r\n`;
}

export function parseVCard(input: string): VCardContact[] {
  const unfolded = input.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const cards = unfolded.split(/END:VCARD/i);
  const contacts: VCardContact[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    if (!/BEGIN:VCARD/i.test(card)) continue;
    const lines = card.split(/\r?\n/);
    let fn = "";
    const emails: string[] = [];
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon === -1) continue;
      const rawKey = line.slice(0, colon);
      const value = line.slice(colon + 1);
      const key = rawKey.split(";")[0].toUpperCase();
      if (key === "FN") {
        fn = unescapeValue(value).trim();
      } else if (key === "EMAIL") {
        const email = normalizeEmail(value.replace(/^.*:</, "").trim());
        if (isEmail(email)) emails.push(email);
      }
    }
    for (const email of emails) {
      if (seen.has(email)) continue;
      seen.add(email);
      contacts.push({ name: fn, email });
    }
  }
  return contacts;
}
