import { createHash } from "node:crypto";
import { loadAsset, putAsset } from "./database";

export async function publishAsset(bytes: Buffer, mime: string) {
  const id = createHash("sha256").update(mime).update(bytes).digest("hex");
  const base = process.env.RING_ASSET_ORIGIN || process.env.APP_ORIGIN;
  if (
    !base ||
    (!base.startsWith("https://") && !base.startsWith("http://127.0.0.1:"))
  )
    throw new Error("Configure a permanent HTTPS RING_ASSET_ORIGIN.");
  await putAsset(id, mime, bytes);
  return `${base.replace(/\/$/, "")}/api/assets/${id}`;
}

export async function getAsset(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) return undefined;
  return loadAsset(id);
}

export async function publishImage(data: string) {
  // Resolve only Ring's own immutable image assets, never caller URLs.
  if (!data.startsWith("data:")) {
    const asset = await getAsset(data.split("/").pop() || "");
    if (
      asset &&
      asset.mime.startsWith("image/") &&
      (await publishAsset(Buffer.from(asset.bytes), asset.mime)) === data
    )
      return data;
    throw new Error("Locked image asset is missing.");
  }
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new Error("Invalid locked image.");
  return publishAsset(Buffer.from(match[2], "base64"), match[1]);
}
