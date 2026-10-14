/* Anonymous-action prover (x/shield), run off the main thread.
 *
 * Loads Go's wasm_exec.js and shield.wasm (built from the chain repo's
 * tools/zk/wasm) plus the proving key and circuit from the ceremony, all from
 * the versioned asset directory the page passes in. Every file is checked
 * against its pinned sha256 before it is run or loaded: loadKeys skips the
 * proving key's point checks, so the digest is what vouches for it.
 * Messages: {id, assets: {base, digests}, fn, args}; replies: {id, result} or
 * {id, error}. fn is a sparkdreamShield function: version, deriveSecret,
 * publicKey or prove (which loads the proving key on first use). */

let runtime = null;
let runtimeBase = null;
let keys = null;

function hex(buf) {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function fetchChecked(assets, name) {
  const want = assets.digests && assets.digests[name];
  if (!want) throw new Error("no pinned digest for " + name + "; refusing to load it");
  const res = await fetch(assets.base + "/" + name);
  if (!res.ok) throw new Error("could not load " + name + " (" + res.status + ")");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const got = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (got !== String(want).toLowerCase()) {
    throw new Error(name + " does not match its pinned digest; refusing to load it");
  }
  return bytes;
}

function loadRuntime(assets) {
  if (runtime && runtimeBase !== assets.base) {
    return Promise.reject(new Error("The anonymous prover changed while this page was open. Please reload."));
  }
  if (!runtime) {
    runtimeBase = assets.base;
    runtime = (async () => {
      const [glue, wasm] = await Promise.all([
        fetchChecked(assets, "wasm_exec.js"),
        fetchChecked(assets, "shield.wasm"),
      ]);
      const url = URL.createObjectURL(new Blob([glue], { type: "text/javascript" }));
      try {
        importScripts(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const go = new Go();
      const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
      go.run(instance);
    })().catch((err) => {
      runtime = null;
      runtimeBase = null;
      throw err;
    });
  }
  return runtime;
}

function loadKeys(assets) {
  if (!keys) {
    keys = (async () => {
      const [pk, r1cs] = await Promise.all([
        fetchChecked(assets, "proving_key.raw.bin"),
        fetchChecked(assets, "circuit.r1cs"),
      ]);
      const out = JSON.parse(self.sparkdreamShield.loadKeys(pk, r1cs));
      if (out.error) throw new Error(out.error);
    })().catch((err) => {
      keys = null;
      throw err;
    });
  }
  return keys;
}

self.onmessage = async (event) => {
  const { id, assets, fn, args } = event.data;
  try {
    await loadRuntime(assets);
    if (fn === "prove") await loadKeys(assets);
    const out = JSON.parse(self.sparkdreamShield[fn](...args));
    if (out.error) throw new Error(out.error);
    self.postMessage({ id, result: out });
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
