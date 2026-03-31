import { createOpenGradientClient, DEFAULT_OPEN_GRADIENT_MODEL } from "../src/lib/opengradient.js";

const amountArg = process.argv[2];
const amount = amountArg ? Number(amountArg) : 0.1;

if (!Number.isFinite(amount) || amount < 0.1) {
  console.error("Pass an approval amount of at least 0.1 OPG. Example: npm run og:approve -- 0.1");
  process.exit(1);
}

const client = createOpenGradientClient({
  privateKey: process.env.OG_PRIVATE_KEY || "",
  model: process.env.OG_MODEL || DEFAULT_OPEN_GRADIENT_MODEL,
  maxTokens: Number(process.env.OG_MAX_TOKENS || 350),
  settlementType: process.env.OG_SETTLEMENT_TYPE || "individual",
  pythonExecutable: process.env.OG_PYTHON_EXECUTABLE || "",
  rpcUrl: process.env.OG_RPC_URL || undefined,
  teeRegistryAddress: process.env.OG_TEE_REGISTRY_ADDRESS || undefined
});

try {
  const result = await client.ensureApproval(amount, amount);
  console.log(`Approval checked for ${amount} OPG.`);
  console.log(`Allowance before: ${result.allowanceBefore}`);
  console.log(`Allowance after: ${result.allowanceAfter}`);
  console.log(`Transaction hash: ${result.txHash || "not needed"}`);
} catch (error) {
  console.error(error.message || "Approval failed.");
  process.exit(1);
}
