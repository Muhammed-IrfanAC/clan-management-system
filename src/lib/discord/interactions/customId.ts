/**
 * Component custom ids: `<namespace>:<version>:<arg>:<arg>…`.
 *
 * A button lives on a message for as long as the message exists — weeks, for an alert nobody acted
 * on — so its id outlives the code that wrote it. The version lets a handler change its arguments
 * and still recognise (or politely refuse) an old button instead of misreading it. Discord caps a
 * custom id at 100 characters; args must not contain ':'.
 */

const MAX_LEN = 100;

export function encodeCustomId(namespace: string, version: number, args: string[] = []): string {
  for (const part of [namespace, ...args]) {
    if (part.includes(':')) throw new Error(`custom id part may not contain ':' (${part})`);
  }
  const id = [namespace, `v${version}`, ...args].join(':');
  if (id.length > MAX_LEN) throw new Error(`custom id too long (${id.length} > ${MAX_LEN})`);
  return id;
}

export function decodeCustomId(id: string | undefined): { namespace: string; version: number; args: string[] } | null {
  if (!id) return null;
  const [namespace, v, ...args] = id.split(':');
  const version = /^v\d+$/.test(v ?? '') ? Number(v.slice(1)) : NaN;
  if (!namespace || Number.isNaN(version)) return null;
  return { namespace, version, args };
}
