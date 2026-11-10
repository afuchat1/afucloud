const DEFAULT_CDN_HOST = "cdn.afuchat.com";
const DEFAULT_OBJECT_PATH = "/cloud/object";
const SHARED_CDN_HOSTNAMES = new Set(["img.afuchat.com", "vid.afuchat.com", DEFAULT_CDN_HOST]);

export function publicStorageBase(configuredHostname: string | null): string {
  const configured = configuredHostname?.toLowerCase().replace(/\.$/, "");
  if (!configured || SHARED_CDN_HOSTNAMES.has(configured)) {
    return `https://${DEFAULT_CDN_HOST}${DEFAULT_OBJECT_PATH}`;
  }
  return `https://${configured}`;
}

export function publicStorageObjectUrl(objectKey: string, configuredHostname: string | null): string {
  const publicKey = objectKey.startsWith("containers/")
    ? objectKey.slice("containers/".length)
    : objectKey;
  const encodedKey = publicKey.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `https://${DEFAULT_CDN_HOST}${DEFAULT_OBJECT_PATH}/${encodedKey}`;
}
