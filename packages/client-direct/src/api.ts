
import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import path from "path";
import fs from "fs";
import { getFolderByUserAddress } from "./tusky";
import {getFilesByParentId} from "./tusky";

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

    router.get("/data", async (req, res) => {
        res.header("Access-Control-Allow-Origin", "*");
        res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.header("Access-Control-Allow-Headers", "Content-Type");
    
        try {
            const parentId = String(req.query.parentId || "45c6c728-6e0d-4260-8c2e-1bb25d285874");
            
            // 🔥 Lấy dữ liệu từ database
            let rawData = await getFilesByParentId(parentId);
    
            if (!rawData || typeof rawData === "string") {
                throw new Error('No valid data found');
            }
    
            // 🔥 Chuyển dữ liệu về dạng chuẩn
            const authorCounts = {};
            const formattedData = rawData.flatMap(item => {
                const dataArray = Array.isArray(item.data) ? item.data : [item.data];
                return dataArray.map(tweet => {
                    const author = tweet.authorFullname || "anonymous";
                    authorCounts[author] = (authorCounts[author] || 0) + 1;
    
                    return {
                        id: `${author}_${authorCounts[author]}`,
                        authorFullname: author,
                        text: tweet.text,
                        url: tweet.url
                    };
                });
            });
    
            // 🔥 Xây dựng prompt AI
            const aiPrompt = `
🔹 🔹 **Mục tiêu**
- Chuyển danh sách bài đăng thành một mạng lưới gồm **nodes** (bài đăng, từ khóa quan trọng) và **edges** (mối quan hệ giữa chúng).
- **Hashtags (#)** và **mentions (@)** chỉ được thêm vào danh sách keywords **nếu có nhiều bài đăng liên quan**.

🔹 **Bước 1: Xử lý văn bản bài đăng**
- Loại bỏ **URL** (ví dụ: "https://example.com").
- Tách các **hashtags (#hashtag)** và **mentions (@username)**.
- Loại bỏ ký tự đặc biệt **(trừ @ và #)**.
- Chuyển toàn bộ chữ thành **chữ thường**.
- **Bỏ qua bài đăng** nếu có ít hơn 5 từ.

🔹 **Bước 2: Trích xuất từ khóa & hashtags**
- **Chỉ giữ lại hashtags & mentions nếu xuất hiện trong từ 2 bài đăng trở lên**.
- Bỏ hashtags & mentions nếu chỉ xuất hiện 1 lần.
- Giữ lại **các từ khóa quan trọng** như **"blockchain", "zk-proof", "KYC", "DeFi", "wallet"**.

🔹 **Bước 3: Xây dựng đồ thị**
- **Nodes (nút):**
  - Mỗi bài đăng là một node:
    \`{ "id": "Movement_1", "type": "post" }\`
  - Mỗi từ khóa quan trọng **(bao gồm các hashtags/mentions phổ biến)** là một node:
    \`{ "id": "#defi", "type": "keyword" }\`
    \`{ "id": "@elonmusk", "type": "keyword" }\`

- **Edges (cạnh):**
  - Kết nối bài đăng với từ khóa.
  - Kết nối bài đăng nếu có chung hashtag hoặc mention xuất hiện **trong ít nhất 2 bài**.
  - Ví dụ:
    \`{ "source": "Movement_1", "target": "#defi" }\`
    \`{ "source": "Movement_1", "target": "rushi_2" }\` (nếu cả hai có cùng hashtag)

🔹 **Dữ liệu đầu vào (JSON)**
Dưới đây là danh sách bài đăng:
${JSON.stringify(formattedData, null, 2)}

🔹 **Dữ liệu đầu ra mong muốn**
- Trả về JSON với **nodes** và **edges** theo format sau:
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
- **Chỉ trả về JSON**, không có văn bản thừa.
- Giữ định dạng JSON chuẩn để có thể lưu vào file và sử dụng trực tiếp.
`;
    
            // 🔥 Gọi Gemini API
            const aiResponse = await callGemini(aiPrompt);
    
            if (typeof aiResponse === 'string') {
                const graphData = JSON.parse(aiResponse);
                
                // Map content and url to post nodes
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
//     router.get("/label", async (req, res) => {
//         res.header("Access-Control-Allow-Origin", "*");
//         res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//         res.header("Access-Control-Allow-Headers", "Content-Type");
    
//         try {
//             const parentId = String(req.query.parentId || "45c6c728-6e0d-4260-8c2e-1bb25d285874");
            
//             // 🔥 Lấy dữ liệu từ database
//             let rawData = await getFilesByParentId(parentId);
    
//             if (!rawData || typeof rawData === "string") {
//                 throw new Error('No valid data found');
//             }
    
//             // 🔥 Chuyển dữ liệu về dạng chuẩn
//             const authorCounts = {};
//             const formattedData = rawData.flatMap(item => {
//                 const dataArray = Array.isArray(item.data) ? item.data : [item.data];
//                 return dataArray.map(tweet => {
//                     const author = tweet.authorFullname || "anonymous";
//                     authorCounts[author] = (authorCounts[author] || 0) + 1;
    
//                     return {
//                         id: `${author}_${authorCounts[author]}`,
//                         text: tweet.text,
//                         authorFullname: tweet.authorFullname,
//                         authorUsername: tweet.authorUsername,
//                         authorImg: tweet.authorImg,
//                         createdAt: tweet.createdAt,
//                         url: tweet.url,
//                     };
//                 });
//             });
            
//             // Only send necessary data to AI
//             const minimalData = formattedData.map(({ id, text }) => ({ id, text }));

//             // Format the prompt to return an array of objects
//             const aiPrompt = `
// You are an AI model specialized in analyzing and categorizing social media posts. Your task is to read the content of a post (only the "text" field) and assign the most appropriate category based on its meaning and context.

// Ensure that:

// Only use the "text" content to determine the category. Do not reference the author, posting time, or any other information.
// Always select the most suitable category. If the content fits into multiple categories, choose the most relevant one.
// If the post does not match any predefined category, create a new, concise, and meaningful category based on the post's topic.
// Do not modify the content of the post. Only add the "category" field.
// Return the result in JSON format
// Categorization Guidelines:

// - If the post contains news or updates → "News/Update"
// - If the post is related to hackathons, competitions, or winner announcements → "Hackathon Update"
// - If the post announces an event, conference, or invitation to join → "Event Announcement"
// - If the post analyzes the crypto market, financial indicators → "Crypto Market Analysis"
// - If the post mentions collaborations, partnerships, or alliances → "Collaboration Announcement"
// - If the post is a personal story, reflection, or life lesson → "Personal Reflection"
// - If the post is a proposal or introduction of a new project → "Proposal/Project Introduction"
// - If the post contains motivational content, encouragement, or inspiration → "Motivational Post"
// - If the post contains errors or is unavailable → "Error/Unavailable"
// - If the post is meant to connect with the community, discussions, or engagement → "Community Engagement"
// - If the post relates to blockchain development, new technologies → "Blockchain Development"
// - If the post provides financial advice, investment tips → "Financial Advice"
// - If the post contains educational content, learning resources, or tutorials → "Educational Content"
// - If the post does not fit into any of the above categories, create a new category based on its content and meaning.

// Input data:
// ${JSON.stringify(minimalData, null, 2)}

// Return ONLY a valid JSON array of objects with this structure:
// [
//   {
//     "id": "example_1",
//     "text": "post text",
//     "category": "chosen category"
//   }
// ]`;

//             // Call Gemini API for categorization
//             const aiResponse = await callGemini(aiPrompt);

//             // Check if aiResponse is valid JSON
//             if (typeof aiResponse === 'string') {
//                 const graphData = JSON.parse(aiResponse);
                
//                 // Merge AI categories with original data
//                 const labeledData = formattedData.map((post) => {
//                     const aiPost = graphData.find((p) => p.id === post.id);
//                     return {
//                       ...post,
//                       category: aiPost?.category || "Uncategorized",
//                     };
//                 });

//                 res.json(labeledData);
              
//                 // Write labeled data to file
//                 fs.writeFileSync("data_labeled.txt", JSON.stringify(labeledData, null, 2));
//                 console.log("✅ Data has been written to data_labeled.txt!");
//             } else {
//                 throw new Error(aiResponse.error);
//             }
    
//         } catch (error) {
//             res.status(500).json({
//                 error: error.message,
//                 timestamp: new Date().toISOString()
//             });
//         }
//     });
    

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
