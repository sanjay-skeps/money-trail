import "server-only";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

const localRoot = join(process.cwd(), ".data", "receipts");
function remoteUrl(key: string) { return `${process.env.RECEIPT_STORAGE_URL!.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`; }
export async function putReceipt(key: string, bytes: Uint8Array, contentType: string) {
  if (process.env.RECEIPT_STORAGE_URL) {
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    const response = await fetch(remoteUrl(key), { method: "PUT", headers: { Authorization: `Bearer ${process.env.RECEIPT_STORAGE_TOKEN ?? ""}`, "Content-Type": contentType }, body });
    if (!response.ok) throw new Error("Receipt storage rejected upload");
    return;
  }
  const path = join(localRoot, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
export async function getReceipt(key: string) {
  if (process.env.RECEIPT_STORAGE_URL) {
    const response = await fetch(remoteUrl(key), { headers: { Authorization: `Bearer ${process.env.RECEIPT_STORAGE_TOKEN ?? ""}` } });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  }
  try { return new Uint8Array(await readFile(join(localRoot, key))); } catch { return null; }
}
export async function deleteReceipt(key: string) {
  if (process.env.RECEIPT_STORAGE_URL) {
    const response = await fetch(remoteUrl(key), { method: "DELETE", headers: { Authorization: `Bearer ${process.env.RECEIPT_STORAGE_TOKEN ?? ""}` } });
    if (!response.ok && response.status !== 404) throw new Error("Receipt storage rejected deletion");
    return;
  }
  try { await unlink(join(localRoot, key)); } catch { /* already removed */ }
}
