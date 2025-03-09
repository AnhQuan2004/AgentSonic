import { Contract, ethers, JsonRpcProvider, Wallet } from "ethers";
import dotenv from 'dotenv';
dotenv.config();

const contractABI = [
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        },
        {
          "indexed": false,
          "internalType": "address",
          "name": "creator",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        },
        {
          "indexed": false,
          "internalType": "uint64",
          "name": "expiredAt",
          "type": "uint64"
        }
      ],
      "name": "BountyCreated",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        },
        {
          "indexed": false,
          "internalType": "address",
          "name": "participant",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint64",
          "name": "point",
          "type": "uint64"
        }
      ],
      "name": "ParticipantAdded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "totalAmount",
          "type": "uint256"
        }
      ],
      "name": "RewardsDistributed",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        },
        {
          "indexed": false,
          "internalType": "address",
          "name": "creator",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint256",
          "name": "amount",
          "type": "uint256"
        }
      ],
      "name": "RewardsReturned",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "admin",
      "outputs": [
        {
          "internalType": "address",
          "name": "",
          "type": "address"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        },
        {
          "internalType": "uint64",
          "name": "minOfParticipants",
          "type": "uint64"
        },
        {
          "internalType": "uint64",
          "name": "expiredAt",
          "type": "uint64"
        }
      ],
      "name": "createBounty",
      "outputs": [],
      "stateMutability": "payable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "id",
          "type": "string"
        }
      ],
      "name": "distributeRewards",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "getAllBounties",
      "outputs": [
        {
          "components": [
            {
              "internalType": "string",
              "name": "bountyId",
              "type": "string"
            },
            {
              "internalType": "address",
              "name": "creator",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "rewardAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint64",
              "name": "minOfParticipants",
              "type": "uint64"
            },
            {
              "internalType": "uint64",
              "name": "expiredAt",
              "type": "uint64"
            },
            {
              "internalType": "bool",
              "name": "distributed",
              "type": "bool"
            },
            {
              "internalType": "uint256",
              "name": "participantCount",
              "type": "uint256"
            }
          ],
          "internalType": "struct BountyPool.BountyInfo[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "creator",
          "type": "address"
        }
      ],
      "name": "getBountiesByCreator",
      "outputs": [
        {
          "components": [
            {
              "internalType": "string",
              "name": "bountyId",
              "type": "string"
            },
            {
              "internalType": "address",
              "name": "creator",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "rewardAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint64",
              "name": "minOfParticipants",
              "type": "uint64"
            },
            {
              "internalType": "uint64",
              "name": "expiredAt",
              "type": "uint64"
            },
            {
              "internalType": "bool",
              "name": "distributed",
              "type": "bool"
            },
            {
              "internalType": "uint256",
              "name": "participantCount",
              "type": "uint256"
            }
          ],
          "internalType": "struct BountyPool.BountyInfo[]",
          "name": "",
          "type": "tuple[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "creator",
          "type": "address"
        }
      ],
      "name": "getBountyByAddress",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        }
      ],
      "name": "getBountyById",
      "outputs": [
        {
          "components": [
            {
              "internalType": "string",
              "name": "bountyId",
              "type": "string"
            },
            {
              "internalType": "address",
              "name": "creator",
              "type": "address"
            },
            {
              "internalType": "uint256",
              "name": "rewardAmount",
              "type": "uint256"
            },
            {
              "internalType": "uint64",
              "name": "minOfParticipants",
              "type": "uint64"
            },
            {
              "internalType": "uint64",
              "name": "expiredAt",
              "type": "uint64"
            },
            {
              "internalType": "bool",
              "name": "distributed",
              "type": "bool"
            },
            {
              "internalType": "uint256",
              "name": "participantCount",
              "type": "uint256"
            }
          ],
          "internalType": "struct BountyPool.BountyInfo",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        }
      ],
      "name": "getBountyIndexById",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "bountyId",
          "type": "string"
        }
      ],
      "name": "getBountyParticipants",
      "outputs": [
        {
          "internalType": "address[]",
          "name": "",
          "type": "address[]"
        },
        {
          "internalType": "uint64[]",
          "name": "",
          "type": "uint64[]"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "bountyIndex",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "participantIndex",
          "type": "uint256"
        }
      ],
      "name": "getParticipant",
      "outputs": [
        {
          "components": [
            {
              "internalType": "address",
              "name": "addr",
              "type": "address"
            },
            {
              "internalType": "uint64",
              "name": "point",
              "type": "uint64"
            }
          ],
          "internalType": "struct BountyPool.Participant",
          "name": "",
          "type": "tuple"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "participant",
          "type": "address"
        },
        {
          "internalType": "uint64",
          "name": "point",
          "type": "uint64"
        },
        {
          "internalType": "string",
          "name": "taskId",
          "type": "string"
        }
      ],
      "name": "participateInBounty",
      "outputs": [],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [],
      "stateMutability": "nonpayable",
      "type": "constructor"
    }
  ];

  

type Bounty = {
    bountyId: string;
    creator: string;
    rewardAmount: string;
    minOfParticipants: string;
    expiredAt: string;
    distributed: boolean;
    participantCount: string;
}
class SonicServices{
    privateKey: string;
    rpcUrl: string;
    contractAddress: string;
    provider: JsonRpcProvider;
    wallet: Wallet;
    contract: Contract;
    constructor() {
        this.privateKey = process.env.PRIVATE_KEY || '';
        this.rpcUrl = process.env.SONIC_TESTNET_RPC || '';
        this.contractAddress = process.env.SONIC_CONTRACT || '';
        this.provider = new ethers.JsonRpcProvider(this.rpcUrl, undefined, {
            batchMaxCount: 3, // Limit to 3 requests per batch for DRPC free tier
            batchStallTime: 10 // ms to wait for more requests before sending a batch
        });
        this.wallet = new ethers.Wallet(this.privateKey, this.provider);
        this.contract = new ethers.Contract(this.contractAddress, contractABI, this.wallet);
        if (!this.privateKey || !this.rpcUrl || !this.contractAddress) {
            console.error('Error: PRIVATE_KEY or SONIC_TESTNET_RPC or SONIC_CONTRACT not found in environment variables');
            console.log('Create a .env file with your variable');
            process.exit(1);
        }
    }
    async create(bountyId: string, data_refer: string, stakingAmount: number, minimumOfUser: number, expireTime: number) {
        try {
            
            const depositAmount = ethers.parseEther(`${stakingAmount}`);

            // Initiating transaction...
            let tx;
            try {
            //=== SONIC Bounty Creating ===

                tx = await this.contract.createBounty(bountyId, minimumOfUser, expireTime, {
                    value: depositAmount,
                    gasLimit: ethers.toBigInt(2000000),
                    
                })

            } catch (error) {
              // @ts-ignore
                if (error.code === 'UNSUPPORTED_OPERATION' && error.operation === 'getEnsAddress') {
                    console.error('Error: Network does not support ENS');
                    throw new Error('Network does not support ENS');
                }
                throw error;
            }

            console.log(`Transaction hash: ${tx.hash}`);
            console.log('Waiting for transaction confirmation...');

            const receipt = await tx.wait();

            console.log('✅ Create Bounty successfully!');
            console.log(`Gas used: ${receipt.gasUsed.toString()}`);
            console.log(`Block number: ${receipt.blockNumber}`);
            console.log(`Transaction explorer link: https://testnet.soniclabs.com/tx/${receipt.hash}`);
            return receipt;
        } catch (error) {
            console.log(error)
            return error;
        }
    }

    async findAll() {
        try {
            console.log("Fetching all bounties...");
            const bounties: Bounty[] = await this.contract.getAllBounties();
            
            // Log để debug
            console.log(`Found ${bounties.length} bounties`);
            
            const result = bounties.map((bounty) => {
                console.log(`Processing bounty: ${bounty.bountyId}, distributed: ${bounty.distributed}`);
                return {
                    bountyId: bounty.bountyId,
                    creator: bounty.creator,
                    rewardAmount: `${bounty.rewardAmount}`,
                    minOfParticipants: `${bounty.minOfParticipants}`,
                    expiredAt: `${bounty.expiredAt}`,
                    distributed: bounty.distributed,
                    participantCount: `${bounty.participantCount}`
                }   
            });

            // Log kết quả cuối cùng
            console.log("Processed bounties:", result.map(b => b.bountyId));
            
            return result;
        } catch(e) {
            console.error("Error in findAll:", e);
            throw e; // Throw error để có thể xử lý ở cấp cao hơn
        }
    }

    async findById(id: string) {
        try {
            const contract = new ethers.Contract(this.contractAddress, contractABI, this.wallet);
            const bounty = await contract.getBountyById(id);
            return {
                bountyId: bounty.bountyId,
                creator: bounty.creator,
                rewardAmount: `${bounty.rewardAmount}`,
                minOfParticipants: `${bounty.minOfParticipants}`,
                expiredAt: `${bounty.expiredAt}`,
                distributed: bounty.distributed,
                participantCount: `${bounty.participantCount}`
            };
        }catch(e) {
            return null;
        }
    }

   async participateInBounty(participant: string, point: number, bountyId: string) {
    try {
            
        // Initiating transaction...
        let tx;
        try {
            tx = await this.contract.participateInBounty(participant, point, bountyId)

        } catch (error) {
          // @ts-ignore
            if (error.code === 'UNSUPPORTED_OPERATION' && error.operation === 'getEnsAddress') {
                console.error('Error: Network does not support ENS');
                throw new Error('Network does not support ENS');
            }
            throw error;
        }

        console.log(`Transaction hash: ${tx.hash}`);
        console.log('Waiting for transaction confirmation...');

        const receipt = await tx.wait();
        
        console.log('✅ Add participant successfully!');
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`Block number: ${receipt.blockNumber}`);
        console.log(`Transaction explorer link: https://testnet.soniclabs.com/tx/${receipt.hash}`);
        return receipt;
    } catch (error) {
        console.log(error)
    }
   }

    async getBontyParticipants(bountyId: string) {
        try {
            const [addresses, points] = await this.contract.getBountyParticipants(bountyId);
            const bounty = addresses.map((address: string, index: number) => ({
                address,
                points: points[index].toString()
            }));
            console.log(bounty);
           return bounty;
        }catch(e) {
            return null;
        }
   }

   async getBountiesByCreator(creator: string) {
        try {
            const contract = new ethers.Contract(this.contractAddress, contractABI, this.wallet);
            const bounties: Bounty[] = await contract.getBountiesByCreator(creator);
            const result = bounties.map((bounty) => {
                return {
                    bountyId: bounty.bountyId,
                    creator: bounty.creator,
                    rewardAmount: `${bounty.rewardAmount}`,
                    minOfParticipants: `${bounty.minOfParticipants}`,
                    expiredAt: `${bounty.expiredAt}`,
                    distributed: bounty.distributed,
                    participantCount: `${bounty.participantCount}`
                }   
            })
            return result;
        }catch(e) {
            return null;
        }
   }

   async distributeRewards(bountyId: string) {
    try {
        // Kiểm tra trạng thái bounty trước khi phân phối
        const bountyInfo = await this.contract.getBountyById(bountyId);
        
        // Nếu đã phân phối rồi thì return null
        if (bountyInfo.distributed) {
            console.log(`Bounty ${bountyId} already distributed, skipping...`);
            return null;
        }

        // Nếu chưa phân phối thì thực hiện phân phối
        const tx = await this.contract.distributeRewards(bountyId);
        console.log(`Transaction hash: ${tx.hash}`);
        console.log('Waiting for transaction confirmation...');

        const receipt = await tx.wait();
        
        console.log('✅ Distribute reward successfully!');
        console.log(`Gas used: ${receipt.gasUsed.toString()}`);
        console.log(`Block number: ${receipt.blockNumber}`);
        console.log(`Transaction explorer link: https://testnet.soniclabs.com/tx/${receipt.hash}`);
        return receipt;

    } catch (error) {
        // Nếu lỗi "Rewards already distributed" thì cũng return null
        if (error.reason === "Rewards already distributed") {
            console.log(`Bounty ${bountyId} already distributed (caught from contract)`);
            return null;
        }
        // Các lỗi khác thì throw
        throw error;
    }
   }

  
}

const sonicServices = new SonicServices();
export { sonicServices };
