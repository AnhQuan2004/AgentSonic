import type { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer.ts";
import quizGen from "./actions/quiz_gen.ts";
// import { WalletProvider, walletProvider } from "./providers/wallet.ts";

// export { WalletProvider, transferToken as TransferAptosToken };

//export all actions
export { quizGen };

export const aptosPlugin: Plugin = {
    name: "aptos",
    description: "Aptos Plugin for Eliza",
    actions: [quizGen],
    evaluators: [],
    // providers: [walletProvider],
};

export default aptosPlugin;
