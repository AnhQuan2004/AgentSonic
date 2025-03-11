import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import { getFolderByUserAddress } from "./tusky";
import {getFilesByParentId} from "./tusky";
import { getAllData } from './pinata';
import { sonicServices } from "./sonic";

import {
    type AgentRuntime,
    elizaLogger,
    getEnvVariable,
    type UUID,
    validateCharacterConfig,
    ServiceType,
    type Character,
} from "@elizaos/core";

import { TeeLogService, type TeeLogQuery } from "@elizaos/plugin-tee-log";
import { REST, Routes } from "discord.js";
import type { DirectClient } from ".";
import { validateUuid } from "@elizaos/core";
import { GoogleGenerativeAI } from "@google/generative-ai";

interface UUIDParams {
    agentId: UUID;
    roomId?: UUID;
}

function validateUUIDParams(
    params: { agentId: string; roomId?: string },
    res: express.Response
): UUIDParams | null {
    const agentId = validateUuid(params.agentId);
    if (!agentId) {
        res.status(400).json({
            error: "Invalid AgentId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        });
        return null;
    }

    if (params.roomId) {
        const roomId = validateUuid(params.roomId);
        if (!roomId) {
            res.status(400).json({
                error: "Invalid RoomId format. Expected to be a UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
            });
            return null;
        }
        return { agentId, roomId };
    }

    return { agentId };
}

async function callGemini(prompt: string) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENERATIVE_AI_API_KEY || '');
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Strip markdown and return raw text
        return text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    } catch (error) {
        console.error('Gemini API error:', error);
        return { 
            error: "Failed to get Gemini response",
            details: error.message
        };
    }
}

export function createApiRouter(
    agents: Map<string, AgentRuntime>,
    directClient: DirectClient
) {
    const router = express.Router();

    router.use((req, res, next) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
        next();
    });

    router.use(bodyParser.json());
    router.use(bodyParser.urlencoded({ extended: true }));
    router.use(
        express.json({
            limit: getEnvVariable("EXPRESS_MAX_PAYLOAD") || "100kb",
        })
    );

    router.get("/", (req, res) => {
        res.send("Welcome, this is the REST API!");
    });

    router.get("/hello", (req, res) => {
        res.json({ message: "Hello World!" });
    });

    router.get("/reward", async (req, res) => {
        try {
            const bounties = await sonicServices.findAll();
            if (!bounties || !Array.isArray(bounties)) {
                throw new Error('No bounties found or invalid data format');
            }

            const currentTimestamp = Math.floor(Date.now() / 1000);
            console.log('Current timestamp:', currentTimestamp);
            
            console.log(`Processing ${bounties.length} bounties:`);
            console.log(bounties.map(b => ({
                id: b.bountyId,
                expired: b.expiredAt,
                distributed: b.distributed,
                shouldProcess: parseInt(b.expiredAt) <= currentTimestamp && !b.distributed
            })));

            const results = [];

            for (const bounty of bounties) {
                try {
                    const expiredAt = parseInt(bounty.expiredAt);
                    
                    if (expiredAt <= currentTimestamp && !bounty.distributed) {
                        console.log(`Processing bounty ${bounty.bountyId} - Expired at: ${expiredAt}`);
                        
                        const distributionResult = await sonicServices.distributeRewards(bounty.bountyId);
                        
                        if (distributionResult) {
                            results.push({
                                bountyId: bounty.bountyId,
                                status: 'success',
                                transactionHash: distributionResult.hash || null,
                                expiredAt: new Date(expiredAt * 1000).toISOString()
                            });
                        } else {
                            console.log(`Skipped bounty ${bounty.bountyId} - Already distributed`);
                        }
                    }
                } catch (error) {
                    console.error(`Error processing bounty ${bounty.bountyId}:`, error);
                    results.push({
                        bountyId: bounty.bountyId,
                        status: 'failed',
                        error: error.message,
                        expiredAt: new Date(parseInt(bounty.expiredAt) * 1000).toISOString()
                    });
                }
            }

            res.json({
                timestamp: new Date().toISOString(),
                processedBounties: results
            });

        } catch (error) {
            console.error('Error in reward distribution:', error);
            res.status(500).json({
                error: 'Failed to process rewards distribution',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });

    router.get("/data", async (req, res) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
    
        try {
            let rawData = await getAllData();
    
            if (!rawData || !Array.isArray(rawData) || rawData.length === 0) {
                throw new Error('No valid data found from Pinata');
            }
    
            const authorCounts = {};
            const formattedData = rawData.map(tweet => {
                const author = tweet.authorFullname || "anonymous";
                authorCounts[author] = (authorCounts[author] || 0) + 1;
    
                return {
                    id: `${author}_${authorCounts[author]}`,
                    authorFullname: author,
                    text: tweet.text,
                    url: tweet.url
                };
            });
    
            const aiPrompt = `
🔹 🔹 **Objective**
- Convert the list of posts into a network consisting of **nodes** (posts, important keywords) and **edges** (relationships between them).
- **Hashtags (#)** and **mentions (@)** should only be added to the keywords list **if there are multiple related posts**.

🔹 **Step 1: Process post text**
- Remove **URLs** (e.g., "https://example.com").
- Extract **hashtags (#hashtag)** and **mentions (@username)**.
- Remove special characters **(except for @ and #)**.
- Convert all text to **lowercase**.
- **Skip posts** if they have fewer than 5 words.

🔹 **Step 2: Extract keywords & hashtags**
- **Only keep hashtags & mentions if they appear in 2 or more posts**.
- Discard hashtags & mentions if they appear only once.
- Retain **important keywords** such as **"blockchain", "zk-proof", "KYC", "DeFi", "wallet"**.

🔹 **Step 3: Build the graph**
- **Nodes:**
  - Each post is a node:
    \`{ "id": "Movement_1", "type": "post" }\`
  - Each important keyword **(including popular hashtags/mentions)** is a node:
    \`{ "id": "#defi", "type": "keyword" }\`
    \`{ "id": "@elonmusk", "type": "keyword" }\`

- **Edges:**
  - Connect posts to keywords.
  - Connect posts if they share a hashtag or mention that appears **in at least 2 posts**.
  - Example:
    \`{ "source": "Movement_1", "target": "#defi" }\`
    \`{ "source": "Movement_1", "target": "rushi_2" }\` (if both share the same hashtag)

🔹 **Input data (JSON)**
Here is the list of posts:
${JSON.stringify(formattedData, null, 2)}

🔹 **Desired output data**
- Return JSON with **nodes** and **edges** in the following format:
\`\`\`json
{
   "nodes": [
        { "id": "Movement_1", "type": "post" },
        { "id": "#defi", "type": "keyword" },
        { "id": "@elonmusk", "type": "keyword" }
   ],
   "edges": [
        { "source": "Movement_1", "target": "#defi" },
        { "source": "Movement_1", "target": "@elonmusk" },
        { "source": "rushi_2", "target": "#defi" }
   ]
}
\`\`\`
- **Only return JSON**, no extra text.
- Maintain standard JSON format for saving to a file and direct usage.
`;
    
            const aiResponse = await callGemini(aiPrompt);
    
            if (typeof aiResponse === 'string') {
                const graphData = JSON.parse(aiResponse);
                
                const contentMap = formattedData.reduce((map, item) => {
                    map[item.id] = {
                        text: item.text || "",
                        url: item.url || ""
                    };
                    return map;
                }, {});

                graphData.nodes = graphData.nodes.map(node => ({
                    ...node,
                    content: node.type === "post" ? contentMap[node.id]?.text : undefined,
                    url: node.type === "post" ? contentMap[node.id]?.url : undefined
                }));

                res.json(graphData);
            } else {
                throw new Error(aiResponse.error);
            }
    
        } catch (error) {
            res.status(500).json({
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });
    router.get("/agents", (req, res) => {
        const agentsList = Array.from(agents.values()).map((agent) => ({
            id: agent.agentId,
            name: agent.character.name,
            clients: Object.keys(agent.clients),
        }));
        res.json({ agents: agentsList });
    });

    router.get('/storage', async (req, res) => {
        try {
            const uploadDir = path.join(process.cwd(), "data", "characters");
            const files = await fs.promises.readdir(uploadDir);
            res.json({ files });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    });

    router.get("/agents/:agentId", (req, res) => {
        const { agentId } = validateUUIDParams(req.params, res) ?? {
            agentId: null,
        };
        if (!agentId) return;

        const agent = agents.get(agentId);

        if (!agent) {
            res.status(404).json({ error: "Agent not found" });
            return;
        }

        const character = agent?.character;
        if (character?.settings?.secrets) {
            delete character.settings.secrets;
        }

        res.json({
            id: agent.agentId,
            character: agent.character,
        });
    });

    router.delete("/agents/:agentId", async (req, res) => {
        const { agentId } = validateUUIDParams(req.params, res) ?? {
            agentId: null,
        };
        if (!agentId) return;

        const agent: AgentRuntime = agents.get(agentId);

        if (agent) {
            agent.stop();
            directClient.unregisterAgent(agent);
            res.status(204).json({ success: true });
        } else {
            res.status(404).json({ error: "Agent not found" });
        }
    });

    router.post("/agents/:agentId/set", async (req, res) => {
        const { agentId } = validateUUIDParams(req.params, res) ?? {
            agentId: null,
        };
        if (!agentId) return;

        let agent: AgentRuntime = agents.get(agentId);

        // update character
        if (agent) {
            // stop agent
            agent.stop();
            directClient.unregisterAgent(agent);
            // if it has a different name, the agentId will change
        }

        // stores the json data before it is modified with added data
        const characterJson = { ...req.body };

        // load character from body
        const character = req.body;
        try {
            validateCharacterConfig(character);
        } catch (e) {
            elizaLogger.error(`Error parsing character: ${e}`);
            res.status(400).json({
                success: false,
                message: e.message,
            });
            return;
        }

        // start it up (and register it)
        try {
            agent = await directClient.startAgent(character);
            elizaLogger.log(`${character.name} started`);
        } catch (e) {
            elizaLogger.error(`Error starting agent: ${e}`);
            res.status(500).json({
                success: false,
                message: e.message,
            });
            return;
        }

        if (process.env.USE_CHARACTER_STORAGE === "true") {
            try {
                const filename = `${agent.agentId}.json`;
                const uploadDir = path.join(
                    process.cwd(),
                    "data",
                    "characters"
                );
                const filepath = path.join(uploadDir, filename);
                await fs.promises.mkdir(uploadDir, { recursive: true });
                await fs.promises.writeFile(
                    filepath,
                    JSON.stringify(
                        { ...characterJson, id: agent.agentId },
                        null,
                        2
                    )
                );
                elizaLogger.info(
                    `Character stored successfully at ${filepath}`
                );
            } catch (error) {
                elizaLogger.error(
                    `Failed to store character: ${error.message}`
                );
            }
        }

        res.json({
            id: character.id,
            character: character,
        });
    });

    router.get("/agents/:agentId/channels", async (req, res) => {
        const { agentId } = validateUUIDParams(req.params, res) ?? {
            agentId: null,
        };
        if (!agentId) return;

        const runtime = agents.get(agentId);

        if (!runtime) {
            res.status(404).json({ error: "Runtime not found" });
            return;
        }

        const API_TOKEN = runtime.getSetting("DISCORD_API_TOKEN") as string;
        const rest = new REST({ version: "10" }).setToken(API_TOKEN);

        try {
            const guilds = (await rest.get(Routes.userGuilds())) as Array<any>;

            res.json({
                id: runtime.agentId,
                guilds: guilds,
                serverCount: guilds.length,
            });
        } catch (error) {
            console.error("Error fetching guilds:", error);
            res.status(500).json({ error: "Failed to fetch guilds" });
        }
    });

    router.get("/agents/:agentId/:roomId/memories", async (req, res) => {
        const { agentId, roomId } = validateUUIDParams(req.params, res) ?? {
            agentId: null,
            roomId: null,
        };
        if (!agentId || !roomId) return;

        let runtime = agents.get(agentId);

        // if runtime is null, look for runtime with the same name
        if (!runtime) {
            runtime = Array.from(agents.values()).find(
                (a) => a.character.name.toLowerCase() === agentId.toLowerCase()
            );
        }

        if (!runtime) {
            res.status(404).send("Agent not found");
            return;
        }

        try {
            const memories = await runtime.messageManager.getMemories({
                roomId,
            });
            const response = {
                agentId,
                roomId,
                memories: memories.map((memory) => ({
                    id: memory.id,
                    userId: memory.userId,
                    agentId: memory.agentId,
                    createdAt: memory.createdAt,
                    content: {
                        text: memory.content.text,
                        action: memory.content.action,
                        source: memory.content.source,
                        url: memory.content.url,
                        inReplyTo: memory.content.inReplyTo,
                        attachments: memory.content.attachments?.map(
                            (attachment) => ({
                                id: attachment.id,
                                url: attachment.url,
                                title: attachment.title,
                                source: attachment.source,
                                description: attachment.description,
                                text: attachment.text,
                                contentType: attachment.contentType,
                            })
                        ),
                    },
                    embedding: memory.embedding,
                    roomId: memory.roomId,
                    unique: memory.unique,
                    similarity: memory.similarity,
                })),
            };

            res.json(response);
        } catch (error) {
            console.error("Error fetching memories:", error);
            res.status(500).json({ error: "Failed to fetch memories" });
        }
    });

    router.get("/tee/agents", async (req, res) => {
        try {
            const allAgents = [];

            for (const agentRuntime of agents.values()) {
                const teeLogService = agentRuntime
                    .getService(ServiceType.TEE_LOG) as InstanceType<typeof TeeLogService>;

                const agents = await teeLogService.getAllAgents();
                allAgents.push(...agents);
            }

            const runtime: AgentRuntime = agents.values().next().value;
            const teeLogService = runtime
                .getService(ServiceType.TEE_LOG) as InstanceType<typeof TeeLogService>;
            const attestation = await teeLogService.generateAttestation(
                JSON.stringify(allAgents)
            );
            res.json({ agents: allAgents, attestation: attestation });
        } catch (error) {
            elizaLogger.error("Failed to get TEE agents:", error);
            res.status(500).json({
                error: "Failed to get TEE agents",
            });
        }
    });

    router.get("/tee/agents/:agentId", async (req, res) => {
        try {
            const agentId = req.params.agentId;
            const agentRuntime = agents.get(agentId);
            if (!agentRuntime) {
                res.status(404).json({ error: "Agent not found" });
                return;
            }

            const teeLogService = agentRuntime
                .getService(ServiceType.TEE_LOG) as InstanceType<typeof TeeLogService>;

            const teeAgent = await teeLogService.getAgent(agentId);
            const attestation = await teeLogService.generateAttestation(
                JSON.stringify(teeAgent)
            );
            res.json({ agent: teeAgent, attestation: attestation });
        } catch (error) {
            elizaLogger.error("Failed to get TEE agent:", error);
            res.status(500).json({
                error: "Failed to get TEE agent",
            });
        }
    });

    router.post(
        "/tee/logs",
        async (req: express.Request, res: express.Response) => {
            try {
                const query = req.body.query || {};
                const page = Number.parseInt(req.body.page) || 1;
                const pageSize = Number.parseInt(req.body.pageSize) || 10;

                const teeLogQuery: TeeLogQuery = {
                    agentId: query.agentId || "",
                    roomId: query.roomId || "",
                    userId: query.userId || "",
                    type: query.type || "",
                    containsContent: query.containsContent || "",
                    startTimestamp: query.startTimestamp || undefined,
                    endTimestamp: query.endTimestamp || undefined,
                };
                const agentRuntime: AgentRuntime = agents.values().next().value;
                const teeLogService = agentRuntime
                    .getService(ServiceType.TEE_LOG) as InstanceType<typeof TeeLogService>;
                const pageQuery = await teeLogService.getLogs(
                    teeLogQuery,
                    page,
                    pageSize
                );
                const attestation = await teeLogService.generateAttestation(
                    JSON.stringify(pageQuery)
                );
                res.json({
                    logs: pageQuery,
                    attestation: attestation,
                });
            } catch (error) {
                elizaLogger.error("Failed to get TEE logs:", error);
                res.status(500).json({
                    error: "Failed to get TEE logs",
                });
            }
        }
    );

    router.post("/agent/start", async (req, res) => {
        const { characterPath, characterJson } = req.body;
        console.log("characterPath:", characterPath);
        console.log("characterJson:", characterJson);
        try {
            let character: Character;
            if (characterJson) {
                character = await directClient.jsonToCharacter(
                    characterPath,
                    characterJson
                );
            } else if (characterPath) {
                character =
                    await directClient.loadCharacterTryPath(characterPath);
            } else {
                throw new Error("No character path or JSON provided");
            }
            await directClient.startAgent(character);
            elizaLogger.log(`${character.name} started`);

            res.json({
                id: character.id,
                character: character,
            });
        } catch (e) {
            elizaLogger.error(`Error parsing character: ${e}`);
            res.status(400).json({
                error: e.message,
            });
            return;
        }
    });

    router.post("/agents/:agentId/stop", async (req, res) => {
        const agentId = req.params.agentId;
        console.log("agentId", agentId);
        const agent: AgentRuntime = agents.get(agentId);

        // update character
        if (agent) {
            // stop agent
            agent.stop();
            directClient.unregisterAgent(agent);
            // if it has a different name, the agentId will change
            res.json({ success: true });
        } else {
            res.status(404).json({ error: "Agent not found" });
        }
    });

    return router;
}
