import { describe, expect, it } from "vitest";
import { parseAuthResults, parseEml, parseMboxToArray, splitMbox } from "../src/parsers";

const eml = `From: Alice Example <alice@example.com>
To: Demo User <demo@localhost>
Subject: Hello from EML
Message-ID: <hello-1@example.com>
In-Reply-To: <root@example.com>
References: <root@example.com>
Date: Tue, 01 Oct 2024 10:00:00 +0000
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="boundary-1"

--boundary-1
Content-Type: text/plain; charset=utf-8

Plain text body.
--boundary-1
Content-Type: text/html; charset=utf-8

<p>HTML body.</p>
--boundary-1
Content-Type: text/plain; name="note.txt"
Content-Disposition: attachment; filename="note.txt"
Content-Transfer-Encoding: base64

aGVsbG8gYXR0YWNobWVudA==
--boundary-1--`;

describe("EML parser", () => {
  it("parses headers, body and attachments", async () => {
    const parsed = await parseEml(eml);
    expect(parsed.subject).toBe("Hello from EML");
    expect(parsed.from.email).toBe("alice@example.com");
    expect(parsed.from.name).toBe("Alice Example");
    expect(parsed.to[0].email).toBe("demo@localhost");
    expect(parsed.messageId).toBe("<hello-1@example.com>");
    expect(parsed.inReplyTo).toBe("<root@example.com>");
    expect(parsed.references).toContain("<root@example.com>");
    expect(parsed.text).toContain("Plain text body");
    expect(parsed.html).toContain("HTML body");
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe("note.txt");
    expect(parsed.attachments[0].content.toString()).toBe("hello attachment");
  });

  it("rejects empty input", async () => {
    await expect(parseEml(Buffer.alloc(0))).rejects.toThrow();
  });
});

describe("mbox parser", () => {
  const mbox = `From alice@example.com Tue Oct 01 10:00:00 2024
${eml.replace(/^From: Alice/m, "From: Alice")}

From bob@example.com Tue Oct 01 11:00:00 2024
From: Bob <bob@example.com>
To: demo@localhost
Subject: Second message
Message-ID: <second@example.com>
Date: Tue, 01 Oct 2024 11:00:00 +0000

Second body.
`;

  it("splits an mbox into messages", async () => {
    const chunks = splitMbox(mbox);
    expect(chunks.length).toBe(2);
    const messages = await parseMboxToArray(mbox);
    expect(messages).toHaveLength(2);
    expect(messages[0].subject).toBe("Hello from EML");
    expect(messages[1].subject).toBe("Second message");
    expect(messages[1].from.email).toBe("bob@example.com");
  });

  it("unescapes mboxrd From lines", () => {
    const chunks = splitMbox("From alice@example.com Tue Oct 01 10:00:00 2024\nSubject: x\n\n>From the archives\n");
    expect(chunks[0].toString()).toContain("From the archives");
  });
});

describe("authentication headers", () => {
  it("parses SPF, DKIM and DMARC results", () => {
    expect(
      parseAuthResults("mx.example; spf=pass smtp.mailfrom=a@b; dkim=fail header.i=@b; dmarc=pass"),
    ).toEqual({ spf: "pass", dkim: "fail", dmarc: "pass" });
    expect(parseAuthResults(undefined)).toEqual({});
  });
});
