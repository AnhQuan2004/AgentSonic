import type { Plugin } from "@elizaos/core";
import transferToken from "./actions/transfer.ts";
// import quizGen from "./actions/quiz_gen.ts";
import createBounty from "./actions/create_bounty.ts";
import giveInsightData from "./actions/give-insight-data.ts";
// import GET_PINATA_DATA from './actions/get_pinata_data';
// import TEST_PINATA from './actions/test_pinata';

// import { WalletProvider, walletProvider } from "./providers/wallet.ts";

// export { WalletProvider, transferToken as TransferAptosToken };

//export all actions
export { createBounty, giveInsightData};

export const aptosPlugin: Plugin = {
    name: "aptos",
    description: "Aptos Plugin for Eliza",
    actions: [createBounty, giveInsightData],
    evaluators: [],
    // providers: [walletProvider],
};

export default aptosPlugin;
