/* Anonymous-action prover (x/shield), run off the main thread.
 *
 * Loads Go's wasm_exec.js and shield.wasm (built from the chain repo's
 * tools/zk/wasm) plus the proving key and circuit from the ceremony, all from
 * the asset base the page passes in. Messages: {id, base, fn, args}; replies:
 * {id, result} or {id, error}. fn is a sparkdreamShield function: deriveSecret,
 * publicKey or prove (which loads the proving key on first use). */

let runtime = null;
let keys = null;

function loadRuntime(base) {
  if (!runtime) {
    runtime = (async () => {
      importScripts(base + "/wasm_exec.js");
      const go = new Go();
      const { instance } = await WebAssembly.instantiateStreaming(fetch(base + "/shield.wasm"), go.importObject);
      go.run(instance);
    })().catch((err) => {
      runtime = null;
      throw err;
    });
  }
  return runtime;
}

function loadKeys(base) {
  if (!keys) {
    keys = (async () => {
      const fetchBytes = async (name) => {
        const res = await fetch(base + "/" + name);
        if (!res.ok) throw new Error("could not load " + name + " (" + res.status + ")");
        return new Uint8Array(await res.arrayBuffer());
      };
      const [pk, r1cs] = await Promise.all([fetchBytes("proving_key.raw.bin"), fetchBytes("circuit.r1cs")]);
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
  const { id, base, fn, args } = event.data;
  try {
    await loadRuntime(base);
    if (fn === "prove") await loadKeys(base);
    const out = JSON.parse(self.sparkdreamShield[fn](...args));
    if (out.error) throw new Error(out.error);
    self.postMessage({ id, result: out });
  } catch (err) {
    self.postMessage({ id, error: err && err.message ? err.message : String(err) });
  }
};
