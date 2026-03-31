import { createOpenGradientClient, DEFAULT_OPEN_GRADIENT_MODEL } from "../src/lib/opengradient.js";

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
  const result = await client.getWalletStatus();
  console.log(`Address: ${result.address}`);
  console.log(`Base Sepolia ETH: ${result.ethBalance}`);
  console.log(`OPG balance: ${result.opgBalance}`);
  console.log(`Permit2 allowance: ${result.permit2Allowance}`);
} catch (error) {
  console.error(error.message || "Wallet check failed.");
  process.exit(1);
}
