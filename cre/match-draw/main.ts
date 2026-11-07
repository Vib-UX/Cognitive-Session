import {
  EVMClient,
  HTTPCapability,
  Runner,
  bytesToHex,
  decodeJson,
  handler,
  logTriggerConfig,
  prepareReportRequest,
  type EVMLog,
  type HTTPPayload,
  type Runtime,
} from "@chainlink/cre-sdk";
import { decodeAbiParameters, encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";
import { z } from "zod";

const configSchema = z.object({
  consumerAddress: z.string(),
});

type Config = z.infer<typeof configSchema>;

const BASE = EVMClient.SUPPORTED_CHAIN_SELECTORS["ethereum-mainnet-base-1"];
const DRAW_FULFILLED = keccak256(stringToBytes("DrawFulfilled(bytes32,uint256,uint256,bool)"));

const pairSchema = z.object({
  pairId: z.string(),
  first: z.string(),
  second: z.string(),
  firstHash: z.string().optional(),
  secondHash: z.string().optional(),
});

function hashOf(id: string, supplied?: string): Hex {
  if (supplied && /^0x[a-fA-F0-9]{64}$/.test(supplied)) return supplied as Hex;
  return keccak256(stringToBytes(id));
}

/** The relay's HTTP body is the pair. The report is what SessionMatchDraw.onReport decodes. */
const onPair = (runtime: Runtime<Config>, payload: HTTPPayload): string => {
  const body = pairSchema.parse(decodeJson(payload.input));
  if (!/^0x[a-fA-F0-9]{64}$/.test(body.pairId)) throw new Error("pairId must be bytes32");
  const encoded = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes32" }],
    [body.pairId as Hex, hashOf(body.first, body.firstHash), hashOf(body.second, body.secondHash)],
  );
  const report = runtime.report(prepareReportRequest(encoded)).result();
  const evm = new EVMClient(BASE);
  const reply = evm
    .writeReport(runtime, {
      receiver: runtime.config.consumerAddress,
      report,
      gasConfig: { gasLimit: "500000" },
    })
    .result();
  runtime.log(`match draw write ${String(reply.txStatus)}`);
  return String(reply.txStatus);
};

/** Second trigger. The relay reads this same DrawFulfilled log from Base. */
const onFulfilled = (runtime: Runtime<Config>, log: EVMLog): string => {
  const [word, whiteIsFirst] = decodeAbiParameters(
    [{ type: "uint256" }, { type: "bool" }],
    bytesToHex(log.data),
  );
  const pairId = log.topics[1] ? bytesToHex(log.topics[1]) : "0x";
  runtime.log(`draw ${pairId} word ${word.toString()} whiteIsFirst ${String(whiteIsFirst)}`);
  return word.toString();
};

function initWorkflow(config: Config) {
  const http = new HTTPCapability();
  const evm = new EVMClient(BASE);
  return [
    handler(http.trigger({ authorizedKeys: [] }), onPair),
    handler(
      evm.logTrigger(
        logTriggerConfig({
          addresses: [config.consumerAddress as Hex],
          topics: [[DRAW_FULFILLED]],
        }),
      ),
      onFulfilled,
    ),
  ];
}

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
