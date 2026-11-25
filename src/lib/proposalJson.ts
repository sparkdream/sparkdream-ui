/**
 * A gov proposal written as the JSON file the chain's CLI takes
 * (`tx gov submit-proposal file.json`): messages in protobuf JSON with an
 * "@type", plus title, summary, deposit, metadata and expedited.
 *
 * The app has no protobuf JSON parser of its own (the generated codecs know
 * no enum names), so the chain node turns the messages into bytes: its
 * /cosmos/tx/v1beta1/encode builds an unsigned tx from them, exactly as the
 * CLI would. That endpoint drops a field it does not know without a word, so
 * the bytes are decoded again by the node and every value of the file is
 * checked against what the chain read. Nothing is signed or broadcast here.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface ProposalFile {
  /** Inner messages as written, each with its "@type". */
  messages: JsonObject[];
  title: string;
  summary: string;
  metadata: string;
  /** Empty when the file names no deposit. */
  deposit: { denom: string; amount: string }[];
  expedited: boolean;
}

/** An inner message as MsgSubmitProposal carries it. */
export interface PackedMessage {
  typeUrl: string;
  value: Uint8Array;
}

const FILE_KEYS = new Set(["messages", "metadata", "deposit", "title", "summary", "expedited"]);

function isObject(v: unknown): v is JsonObject {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** "50000000uspark.sparkdreamtest,5other" as sdk.Coins; denoms may hold "." and "/". */
function parseCoins(s: string): { denom: string; amount: string }[] {
  if (!s.trim()) return [];
  return s.split(",").map((chunk) => {
    const m = chunk.trim().match(/^(\d+)([a-zA-Z][a-zA-Z0-9/:._-]*)$/);
    if (!m) throw new Error(`deposit: "${chunk.trim()}" is not an amount followed by a denom`);
    return { amount: m[1], denom: m[2] };
  });
}

/** Parses the proposal file. Throws with a message fit to show the user. */
export function parseProposalFile(text: string): ProposalFile {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!isObject(doc)) throw new Error("The proposal must be a JSON object");
  for (const key of Object.keys(doc)) {
    if (!FILE_KEYS.has(key)) throw new Error(`Unknown field "${key}" in the proposal`);
  }
  const { messages, title = "", summary = "", metadata = "", deposit = "", expedited = false } = doc;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('"messages" must list at least one message');
  }
  messages.forEach((m, i) => {
    if (!isObject(m) || typeof m["@type"] !== "string" || !m["@type"].startsWith("/")) {
      throw new Error(`messages[${i}] needs an "@type" such as "/sparkdream.service.v1.MsgUpdateServiceTypeConfig"`);
    }
  });
  for (const [name, v] of Object.entries({ title, summary, metadata, deposit })) {
    if (typeof v !== "string") throw new Error(`"${name}" must be a string`);
  }
  if (typeof expedited !== "boolean") throw new Error('"expedited" must be true or false');
  return {
    messages: messages as JsonObject[],
    title: title as string,
    summary: summary as string,
    metadata: metadata as string,
    deposit: parseCoins(deposit as string),
    expedited,
  };
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** "0.50" and "0.5", or 100 and "100", are the same number. */
function sameScalar(given: Json, read: Json): boolean {
  if (given === read) return true;
  const a = String(given);
  const b = String(read);
  if (typeof given === "boolean" || typeof read === "boolean") return false;
  if (!NUMBER.test(a) || !NUMBER.test(b)) return false;
  const norm = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s);
  return norm(a) === norm(b);
}

/**
 * Every place where `given` (what the file says) is not what the chain read
 * back. A field the chain does not know is missing from `read`; a value it
 * understood differently differs. Fields only the chain lists (defaults the
 * file left out) are fine.
 */
export function differencesFromChain(given: Json, read: Json | undefined, path: string): string[] {
  if (read === undefined) return [`${path}: the chain does not know this field`];
  if (Array.isArray(given)) {
    if (!Array.isArray(read) || read.length !== given.length) return [`${path}: the chain read a different list`];
    return given.flatMap((v, i) => differencesFromChain(v, read[i], `${path}[${i}]`));
  }
  if (isObject(given)) {
    if (!isObject(read)) return [`${path}: the chain read ${JSON.stringify(read)}`];
    return Object.keys(given).flatMap((k) => differencesFromChain(given[k], read[k], path ? `${path}.${k}` : k));
  }
  return sameScalar(given, read) ? [] : [`${path}: the file says ${JSON.stringify(given)}, the chain read ${JSON.stringify(read)}`];
}

async function postLcd(path: string, body: unknown, fetchFn: typeof fetch): Promise<JsonObject> {
  const res = await fetchFn(`/api/lcd/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as JsonObject | null;
  if (!res.ok || !data) {
    throw new Error(typeof data?.message === "string" ? data.message : `Chain node answered ${res.status}`);
  }
  return data;
}

/**
 * Has the chain node encode the messages, and checks that it read every
 * value of the file. Returns the messages packed for MsgSubmitProposal and
 * the chain's own reading of them, for display.
 */
export async function encodeProposalMessages(
  messages: JsonObject[],
  fetchFn: typeof fetch = fetch
): Promise<{ packed: PackedMessage[]; chainRead: JsonObject[] }> {
  const GOV_SUBMIT = "/cosmos.gov.v1.MsgSubmitProposal";
  const encoded = await postLcd(
    "cosmos/tx/v1beta1/encode",
    { tx: { body: { messages: [{ "@type": GOV_SUBMIT, messages }] }, auth_info: { fee: {} }, signatures: [] } },
    fetchFn
  );
  if (typeof encoded.tx_bytes !== "string") throw new Error("Chain node returned no encoded transaction");
  const decoded = await postLcd("cosmos/tx/v1beta1/decode", { tx_bytes: encoded.tx_bytes }, fetchFn);

  const tx = decoded.tx;
  const body = isObject(tx) ? tx.body : undefined;
  const outer = isObject(body) && Array.isArray(body.messages) ? body.messages[0] : undefined;
  const chainRead = isObject(outer) && Array.isArray(outer.messages) ? (outer.messages as JsonObject[]) : [];
  const diffs = differencesFromChain(messages, chainRead, "messages");
  if (diffs.length > 0) {
    throw new Error(`The chain does not read the proposal as written. ${diffs.join("; ")}`);
  }

  const { fromBase64 } = await import("@cosmjs/encoding");
  const { Tx } = await import("cosmjs-types/cosmos/tx/v1beta1/tx");
  const { MsgSubmitProposal } = await import("cosmjs-types/cosmos/gov/v1/tx");
  const any = Tx.decode(fromBase64(encoded.tx_bytes)).body?.messages[0];
  if (!any || any.typeUrl !== GOV_SUBMIT) throw new Error("Chain node returned an unexpected transaction");
  const packed = MsgSubmitProposal.decode(any.value).messages.map((m) => ({ typeUrl: m.typeUrl, value: m.value }));
  if (packed.length !== messages.length || packed.some((m, i) => m.typeUrl !== messages[i]["@type"])) {
    throw new Error("Chain node returned different messages than the proposal lists");
  }
  return { packed, chainRead };
}

/** "50000000" micro-units as "50"; "1500000" as "1.5". */
export function microToDisplay(micro: string): string {
  const padded = micro.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(-6).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}
