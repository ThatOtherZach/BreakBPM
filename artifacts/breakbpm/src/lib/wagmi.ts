import { http, createConfig } from "wagmi";
import { base, baseSepolia } from "wagmi/chains";
import { injected, walletConnect } from "wagmi/connectors";

/**
 * wagmi config for the self-custody crypto checkout. We support both Base
 * mainnet and Base Sepolia so the same build verifies on testnet first; the
 * server's quote tells the client which chain to actually transact on.
 *
 * Connectors: browser-injected wallets (MetaMask/Rabby/etc.) are always
 * available. WalletConnect is added only when a project id is provided via
 * VITE_WALLETCONNECT_PROJECT_ID — it's optional config added near go-live, so
 * its absence must not break the connect flow.
 */
const wcProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;

const connectors = [
  injected(),
  ...(wcProjectId ? [walletConnect({ projectId: wcProjectId })] : []),
];

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia],
  connectors,
  transports: {
    [base.id]: http(),
    [baseSepolia.id]: http(),
  },
});
