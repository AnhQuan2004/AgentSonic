import type { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer.ts";
import quizGen from "./actions/quiz_gen.ts";
import createBounty from "./actions/create_bounty.ts";
// import GET_PINATA_DATA from './actions/get_pinata_data';
// import TEST_PINATA from './actions/test_pinata';

// import { WalletProvider, walletProvider } from "./providers/wallet.ts";

// export { WalletProvider, transferToken as TransferAptosToken };

//export all actions
export { quizGen, createBounty};

export const aptosPlugin: Plugin = {
    name: "aptos",
    description: "Aptos Plugin for Eliza",
    actions: [quizGen, createBounty],
    evaluators: [],
    // providers: [walletProvider],
};

export default aptosPlugin;
