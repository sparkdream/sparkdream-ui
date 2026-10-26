/**
 * The protobuf registry and amino converter map every transaction is signed
 * with.
 *
 * Amino (Keplr+Ledger) sign bytes must match the chain's
 * cosmossdk.io/x/tx/signing/aminojson byte for byte. sparkdreamjs (0.0.47+)
 * builds every sparkdream module's AminoConverter map with its schema-driven
 * engine (chain-amino), which renders amino JSON from the protobuf bytes the
 * way the chain does; the gov v1 / upgrade messages proposals use go through
 * the same engine. aminoGolden.test.ts checks the result against the chain's
 * encoder for every message. cosmjs's converters still cover the cosmos-sdk
 * messages (bank, staking, distribution, gov v1beta1), at top level and
 * inside an Any (via configureNestedAminoConverter).
 */
export async function buildSigningTypes(): Promise<{
  registry: import("@cosmjs/proto-signing").Registry;
  aminoTypes: import("@cosmjs/stargate").AminoTypes;
}> {
  const { AminoTypes, defaultRegistryTypes, createDefaultAminoConverters } = await import("@cosmjs/stargate");
  const { Registry } = await import("@cosmjs/proto-signing");
  type GeneratedType = import("@cosmjs/proto-signing").GeneratedType;

  const modules = await Promise.all([
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/blog/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/session/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/commons/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/rep/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/collect/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/name/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/forum/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/season/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/reveal/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/futarchy/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/federation/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/artifact/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/service/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/service/v1/tx.amino")]),
    Promise.all([import("@sparkdreamnft/sparkdreamjs/sparkdream/vault/v1/tx.registry"), import("@sparkdreamnft/sparkdreamjs/sparkdream/vault/v1/tx.amino")]),
  ]);
  // Gov v1 + upgrade types (not in defaultRegistryTypes which only has v1beta1)
  const govV1 = await import("cosmjs-types/cosmos/gov/v1/tx");
  const upgrade = await import("cosmjs-types/cosmos/upgrade/v1beta1/tx");
  const { chainAminoConverters } = await import("@sparkdreamnft/sparkdreamjs/chain-amino");
  const { configureNestedAminoConverter } = await import("@sparkdreamnft/sparkdreamjs/nested-amino");

  const registry = new Registry(defaultRegistryTypes);
  registry.register("/cosmos.gov.v1.MsgSubmitProposal", govV1.MsgSubmitProposal as unknown as GeneratedType);
  registry.register("/cosmos.upgrade.v1beta1.MsgSoftwareUpgrade", upgrade.MsgSoftwareUpgrade as unknown as GeneratedType);
  registry.register("/cosmos.upgrade.v1beta1.MsgCancelUpgrade", upgrade.MsgCancelUpgrade as unknown as GeneratedType);
  for (const [{ load }] of modules) load(registry);

  const aminoTypes = new AminoTypes({
    ...createDefaultAminoConverters(),
    ...Object.assign({}, ...modules.map(([, amino]) => amino.AminoConverter)),
    // cosmjs registers only gov v1beta1 and no upgrade converters; the
    // package's schema covers these (only MsgSubmitProposal of gov v1).
    ...chainAminoConverters("cosmos.gov.v1", { MsgSubmitProposal: govV1.MsgSubmitProposal }),
    ...chainAminoConverters("cosmos.upgrade.v1beta1", upgrade),
  });
  // Inner cosmos-sdk messages inside an Any (a proposal's MsgSend, say)
  // render through cosmjs's converters.
  configureNestedAminoConverter({
    registry: registry as unknown as Parameters<typeof configureNestedAminoConverter>[0]["registry"],
    aminoTypes,
  });

  return { registry, aminoTypes };
}
