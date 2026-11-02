// What goes in latest.json, the file the desktop app reads to find out about new versions.
export function releaseManifest(version: string, signature: string, url: string, now = new Date()) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`"${version}" isn't a version like 1.2.3`);
  if (!signature.trim()) throw new Error('The installer has no signature');
  if (!url.startsWith('https://') && !url.startsWith('http://localhost')) throw new Error(`"${url}" isn't a secure address`);
  return { version, pub_date: now.toISOString(), platforms: { 'windows-x86_64': { signature: signature.trim(), url } } };
}
