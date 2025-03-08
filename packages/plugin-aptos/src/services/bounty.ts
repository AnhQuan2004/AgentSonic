import {
  Account,
  Aptos,
  AptosConfig,
  Ed25519PrivateKey,
  InputViewFunctionData,
  Network,
} from "@aptos-labs/ts-sdk";

const aptosConfig = new AptosConfig({ network: Network.TESTNET });
const aptos = new Aptos(aptosConfig);

const privateKey = new Ed25519PrivateKey("0x211f0019d2984999c44aae74c3200ebc6f9207fe9159da80043538bcda1dded0");

const account = await Account.fromPrivateKey({ privateKey });
const accountAddress = account.accountAddress.toString();
const MODULE_ADDRESS="0xc49dbac3840306fba49daedca5393ecc8618cbeae845999ed5452702f872b306"
console.log("Account Address:", accountAddress);
export const createBounty = async (
  bountyId: string,
  data_refer: string,
  stakingAmount: number,
  minimumOfUser: number,
  expireTime: number
) => {
  try {
      const FUNCTION_NAME = `${MODULE_ADDRESS}::bounty_pool_1_1::create_bounty`;

      const transaction = await aptos.transaction.build.simple({
          sender: accountAddress,
          data: {
              function: FUNCTION_NAME,
              functionArguments: [bountyId, data_refer, stakingAmount, minimumOfUser, expireTime],
          },
      });

      const pendingTransaction = await aptos.signAndSubmitTransaction({
          signer: account,
          transaction,
      });

      const executedTransaction = await aptos.waitForTransaction({
          transactionHash: pendingTransaction.hash,
      });

      console.log("✅ Executed Transaction:", executedTransaction);

      // ✅ Trả về giao dịch sau khi thành công
      return executedTransaction;
  } catch (error) {
      console.error("❌ Error executing bounty creation:", error);
      throw error;
  }
};

// Function to add a participant to the bounty reward list
export const participateInBounty = async (
  participantAddress: string,
  point: number,
  bountyId: string
) => {
  try {
    const FUNCTION_NAME = `${MODULE_ADDRESS}::bounty_pool_1_1::participate_in_bounty`;

    const transaction = await aptos.transaction.build.simple({
      sender: accountAddress,
      data: {
        function: FUNCTION_NAME,
        functionArguments: [participantAddress, point, bountyId],
      },
    });

    const pendingTransaction = await aptos.signAndSubmitTransaction({
      signer: account,
      transaction,
    });

    const executedTransaction = await aptos.waitForTransaction({
      transactionHash: pendingTransaction.hash,
    });

    console.log("Participant Added Successfully:", executedTransaction);
  } catch (error) {
    console.error("Error adding participant to bounty:", error);
  }
};

// Function to distribute rewards when the bounty deadline expires
export const distributeRewards = async (bountyId: string) => {
  try {
    const FUNCTION_NAME = `${MODULE_ADDRESS}::bounty_pool_1_1::distribute_rewards`;

    const transaction = await aptos.transaction.build.simple({
      sender: accountAddress,
      data: {
        function: FUNCTION_NAME,
        functionArguments: [bountyId],
      },
    });

    const pendingTransaction = await aptos.signAndSubmitTransaction({
      signer: account,
      transaction,
    });

    const executedTransaction = await aptos.waitForTransaction({
      transactionHash: pendingTransaction.hash,
    });

    console.log("Rewards Distributed Successfully:", executedTransaction);
  } catch (error) {
    console.error("Error distributing rewards:", error);
  }
};
export const get_all_bounties= async()=>{
  const payload: InputViewFunctionData = {
      function: `${MODULE_ADDRESS}::bounty_pool_1_1::get_all_bounties`,
    };
    try {
      const data = await aptos.view({ payload });
      console.log(data)
      // @ts-ignore
    } catch (error) {
      console.log(error)
    }

  
}  
export const get_bounties_by_creator= async()=>{
  const address = accountAddress

  const payload: InputViewFunctionData = {
      function: `${MODULE_ADDRESS}::bounty_pool_1_1::get_bounties_by_creator`,
      functionArguments: [address],

    };
    try {
      const data = await aptos.view({ payload });
      console.log(data)
      // @ts-ignore
    } catch (error) {
      console.log(error)
    }

  
}  
export const get_bounty_by_id= async(bounty_id: string)=>{
  const payload: InputViewFunctionData = {
      function: `${MODULE_ADDRESS}::bounty_pool_1_1::get_bounty_by_id`,
      functionArguments: [bounty_id],

    };
    try {
      const data = await aptos.view({ payload });
      console.log(data)
      // @ts-ignore
    } catch (error) {
      console.log(error)
    }

  
}  
export const get_open_bounty = async(current_timestamp: number)=>{
const payload: InputViewFunctionData = {
    function: `${MODULE_ADDRESS}::bounty_pool_1_1::get_open_bounty`,
    functionArguments: [current_timestamp],

  };
  try {
    const data = await aptos.view({ payload });
    console.log(data)
    // @ts-ignore
  } catch (error) {
    console.log(error)
  }


}