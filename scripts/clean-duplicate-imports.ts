/**
 * Removes duplicate imported messages by Message-ID, keeping the oldest copy
 * (the original import) and merging labels/stars from the newer copies.
 *
 * Duplicates are deleted through the authenticated permanent-delete endpoint so
 * thread counts, storage usage, attachment rows and orphaned files follow the
 * exact production rules.
 *
 *   DATABASE_URL=... JWT_SECRET=... npx tsx scripts/clean-duplicate-imports.ts --dry-run
 *   DATABASE_URL=... JWT_SECRET=... npx tsx scripts/clean-duplicate-imports.ts --execute
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { prisma } from "@nyxmail/db";
import { SignJWT } from "jose";

const EXECUTE = process.argv.includes("--execute");
const API = process.env.APP_INTERNAL_URL || "http://127.0.0.1:3000";

interface CleanupGroup {
  userId: string;
  messageIdHeader: string;
  kept: {
    id: string;
    folder: string;
    createdAt: string;
    labels: string[];
    starred: boolean;
  };
  deleted: Array<{
    id: string;
    folder: string;
    createdAt: string;
    labels: string[];
    starred: boolean;
  }>;
  mergedLabels: string[];
}

async function main(): Promise<void> {
  const grouped = await prisma.message.groupBy({
    by: ["userId", "messageIdHeader"],
    where: { messageIdHeader: { not: null } },
    _count: { _all: true },
  });
  const duplicates = grouped.filter(
    (group) => Boolean(group.messageIdHeader) && group._count._all > 1,
  );

  let totalDeleted = 0;
  let labelsMerged = 0;
  const byFolder = new Map<string, number>();
  const groups: CleanupGroup[] = [];

  for (const group of duplicates) {
    const messages = await prisma.message.findMany({
      where: {
        userId: group.userId,
        messageIdHeader: group.messageIdHeader!,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        createdAt: true,
        isStarred: true,
        folder: { select: { type: true, name: true } },
        labels: { select: { id: true } },
      },
    });
    if (messages.length < 2) continue;
    const kept = messages[0];
    const extras = messages.slice(1);
    const keptLabelIds = new Set(kept.labels.map((label) => label.id));
    const labelsToMerge = new Set<string>();
    for (const extra of extras) {
      for (const label of extra.labels) {
        if (!keptLabelIds.has(label.id)) labelsToMerge.add(label.id);
      }
    }
    for (const extra of extras) {
      byFolder.set(extra.folder.type, (byFolder.get(extra.folder.type) ?? 0) + 1);
    }
    totalDeleted += extras.length;
    labelsMerged += labelsToMerge.size;
    groups.push({
      userId: group.userId,
      messageIdHeader: group.messageIdHeader!,
      kept: {
        id: kept.id,
        folder: `${kept.folder.type}:${kept.folder.name}`,
        createdAt: kept.createdAt.toISOString(),
        labels: kept.labels.map((label) => label.id),
        starred: kept.isStarred,
      },
      deleted: extras.map((extra) => ({
        id: extra.id,
        folder: `${extra.folder.type}:${extra.folder.name}`,
        createdAt: extra.createdAt.toISOString(),
        labels: extra.labels.map((label) => label.id),
        starred: extra.isStarred,
      })),
      mergedLabels: Array.from(labelsToMerge),
    });
  }

  console.log(`duplicate groups: ${groups.length}`);
  console.log(`messages to delete: ${totalDeleted}`);
  console.log(`label links to merge: ${labelsMerged}`);
  console.log("duplicates by folder:", Object.fromEntries(byFolder));

  const reportPath = new URL(
    `../mobile/credentials/duplicate-cleanup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    import.meta.url,
  ).pathname;
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        execute: EXECUTE,
        groups,
      },
      null,
      2,
    ),
  );
  console.log(`report: ${reportPath}`);

  if (!EXECUTE) {
    console.log("dry run only; pass --execute to delete the duplicate copies");
    await prisma.$disconnect();
    return;
  }

  const users = Array.from(new Set(groups.map((group) => group.userId)));
  if (users.length !== 1) throw new Error(`Expected exactly one mailbox, found ${users.length}`);
  const userId = users[0];
  const session = await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: randomBytes(24).toString("hex"),
      ip: "127.0.0.1",
      userAgent: "nyxmail-duplicate-cleanup",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });
  const accessToken = await new SignJWT({ sid: session.id, purpose: "access" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("30m")
    .setIssuer("nyxmail")
    .setAudience("nyxmail-web")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET || ""));
  const csrf = randomBytes(24).toString("hex");
  const cookie = `nyx_at=${accessToken}; nyx_csrf=${csrf}`;

  const ids = groups.flatMap((group) => group.deleted.map((item) => item.id));
  for (const group of groups) {
    if (group.mergedLabels.length === 0 && !group.deleted.some((item) => item.starred)) continue;
    await prisma.message.update({
      where: { id: group.kept.id },
      data: {
        ...(group.mergedLabels.length
          ? { labels: { connect: group.mergedLabels.map((id) => ({ id })) } }
          : {}),
        ...(group.deleted.some((item) => item.starred) ? { isStarred: true } : {}),
      },
    });
  }

  let done = 0;
  let failed = 0;
  const failures: Array<{ id: string; error: string }> = [];
  const worker = async () => {
    while (true) {
      const index = ids.shift();
      if (index === undefined) return;
      try {
        const response = await fetch(
          `${API}/api/v1/messages/${encodeURIComponent(index)}?permanent=true`,
          {
            method: "DELETE",
            headers: {
              cookie,
              "x-csrf-token": csrf,
              accept: "application/json",
            },
          },
        );
        if (!response.ok) {
          failures.push({ id: index, error: `${response.status}: ${(await response.text()).slice(0, 200)}` });
          failed += 1;
        }
      } catch (error) {
        failures.push({ id: index, error: error instanceof Error ? error.message : String(error) });
        failed += 1;
      }
      done += 1;
      if (done % 50 === 0) console.log(`deleted ${done}/${totalDeleted}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));

  await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
  const remaining = await prisma.message.groupBy({
    by: ["userId", "messageIdHeader"],
    where: { messageIdHeader: { not: null } },
    _count: { _all: true },
  });
  const remainingDuplicates = remaining.filter(
    (group) => Boolean(group.messageIdHeader) && group._count._all > 1,
  );
  console.log(`done: ${done - failed}/${totalDeleted}; failed: ${failed}`);
  console.log(`remaining duplicate groups: ${remainingDuplicates.length}`);
  if (failures.length) {
    await writeFile(
      reportPath.replace(/\.json$/, "-failures.json"),
      JSON.stringify(failures, null, 2),
    );
    console.log(`failure report: ${reportPath.replace(/\.json$/, "-failures.json")}`);
  }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
