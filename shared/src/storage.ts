import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";

let cachedRoot: string | null = null;

/** Find the workspace root by walking up from cwd looking for the root package.json. */
export function projectRoot(): string {
  if (cachedRoot) return cachedRoot;
  let current = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    try {
      const pkg = requirePackage(path.join(current, "package.json"));
      if (pkg && Array.isArray(pkg.workspaces)) {
        cachedRoot = current;
        return current;
      }
    } catch {
      // keep walking
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  cachedRoot = process.cwd();
  return cachedRoot;
}

function requirePackage(file: string): { workspaces?: unknown } | null {
  // Deliberately synchronous and tiny: used only during module init paths.
  if (!fsSync.existsSync(file)) return null;
  try {
    return JSON.parse(fsSync.readFileSync(file, "utf8")) as { workspaces?: unknown };
  } catch {
    return null;
  }
}

export function uploadRoot(): string {
  const configured = process.env.UPLOAD_DIR?.trim() || "uploads";
  return path.isAbsolute(configured) ? configured : path.resolve(projectRoot(), configured);
}

export function resolveUploadPath(relativePath: string): string {
  const root = uploadRoot();
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid upload path");
  }
  return resolved;
}

export async function ensureUploadDir(): Promise<string> {
  const root = uploadRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
}

export async function writeUpload(relativePath: string, data: Uint8Array): Promise<void> {
  const target = resolveUploadPath(relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

export async function readUpload(relativePath: string): Promise<Buffer> {
  return fs.readFile(resolveUploadPath(relativePath));
}

export async function deleteUpload(relativePath: string): Promise<void> {
  try {
    await fs.unlink(resolveUploadPath(relativePath));
  } catch {
    // Already gone.
  }
}

export async function uploadExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(resolveUploadPath(relativePath));
    return true;
  } catch {
    return false;
  }
}
