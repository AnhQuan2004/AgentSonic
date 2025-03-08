import { OpenAIEmbeddings } from '@langchain/openai';
import { Action, ActionExample, Memory, IAgentRuntime, State, HandlerCallback, generateText, ModelClass, elizaLogger, RAGKnowledgeItem } from "@elizaos/core";
import { analyzePostPrompt, generateBountyPrompt } from "./prompts";
import { CreateBountyAction } from "./enum";
import * as fs from 'fs/promises';
import * as path from 'path';
import { getFolderByUserAddress } from '../services/tusky';
import { getFilesByParentId } from '../services/tusky';
import axios from 'axios';
// Import bounty functions
import { createBounty} from '../services/bounty';
// Sử dụng service Pinata mới
import { uploadToPinata} from '../services/pinata';
// Import the fetchPinataData function
// import { fetchPinataData } from './get_pinata_data';
// Pinata configuration
const PINATA_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiIyYjZjM2ExZS1lNGFmLTRjZjQtYjI4Ny1jNWU4ODAwMDJlZmYiLCJlbWFpbCI6ImFuaHF1YW4yMDA0MTQ1MkBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiYjZlMmYxNmEzMjE4M2IxZDViNGIiLCJzY29wZWRLZXlTZWNyZXQiOiJmYTVhNTNkMzMxNDAwMzQyNGM1ZTZmOGM3ZWE2YzEwZmZkMjU5NmNiMGM3Yjg5MDE3ODQyZWI1ZDZiYWYxOGVkIiwiZXhwIjoxNzcyMzY0NTAzfQ.LxehNth0tAwf75IPsXLULDKrW0RDyeH03cChLt-5xPw";
const PINATA_GATEWAY = "teal-geographical-stork-778.mypinata.cloud";

// Utility function to write logs to file
async function writeToLog(message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    try {
        await fs.appendFile('log.txt', logMessage);
    } catch (error) {
        console.error('Error writing to log file:', error);
    }
}

export interface DataItem {
    authorFullname: string;
    text: string;
    timestamp?: string; // Optional timestamp for recency boost
}

interface ProcessedPost {
    authorFullname: string;
    text: string;
    originalTexts: string[]; // Store original texts separately
    timestamp?: string;
    embedding?: number[];
    similarity?: number; // Add similarity property
}

const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    const dotProduct = vecA.reduce((sum, val, index) => sum + val * vecB[index], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
};

const groupPostsById = (posts: DataItem[]): ProcessedPost[] => {
    const groupedPosts = new Map<string, { texts: string[], timestamps: string[] }>();
    
    // Group all texts and timestamps by authorFullname
    posts.forEach(post => {
        if (!groupedPosts.has(post.authorFullname)) {
            groupedPosts.set(post.authorFullname, { texts: [], timestamps: [] });
        }
        const group = groupedPosts.get(post.authorFullname)!;
        if (post.text && post.text.length > 0) {
            group.texts.push(post.text);
            group.timestamps.push(post.timestamp || '');
        }
    });

    // Convert grouped posts to final format
    return Array.from(groupedPosts.entries()).map(([authorFullname, group]) => ({
        authorFullname,
        text: `Author: ${authorFullname}\nPosts:\n${group.texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n')}`,
        originalTexts: group.texts,
        timestamp: group.timestamps[group.timestamps.length - 1] // Use most recent timestamp
    }));
};

const embedDocumentsOptimized = async (texts: string[]) => {
    const embeddings = new OpenAIEmbeddings({
        apiKey: process.env.OPENAI_API_KEY,
    });
    return await embeddings.embedDocuments(texts);
};

const filterLongPosts = (posts: DataItem[], minLength: number = 50): DataItem[] => {
    return posts.filter(post => post.text.length >= minLength);
};

const calculateSimilarity = (
    postEmbedding: number[], 
    queryEmbedding: number[], 
    post: ProcessedPost,
    query: string
): number => {
    // Base semantic similarity
    const similarity = cosineSimilarity(postEmbedding, queryEmbedding);
    
    // Convert to lowercase for case-insensitive matching
    const postLower = post.text.toLowerCase();
    const queryLower = query.toLowerCase();
    const authorLower = post.authorFullname.toLowerCase();
    
    // Exact phrase matching boost
    const phraseBoost = post.originalTexts.some(text => 
        text.toLowerCase().includes(queryLower)
    ) ? 0.2 : 0;
    
    // Author matching boost
    const authorBoost = queryLower.includes(authorLower) ? 0.3 : 0;
    
    // Individual terms matching boost
    const queryTerms = queryLower.split(' ').filter(term => term.length > 2);
    const termBoost = queryTerms.reduce((boost, term) => {
        return boost + (postLower.includes(term) ? 0.1 : 0);
    }, 0);

    // Recency boost if timestamp is available
    const recencyBoost = post.timestamp ? calculateRecencyBoost(post.timestamp) : 0;
    
    return similarity + phraseBoost + termBoost + authorBoost + recencyBoost;
};

const calculateRecencyBoost = (timestamp: string): number => {
    const postDate = new Date(timestamp);
    const now = new Date();
    const daysDifference = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60 * 24);
    return Math.max(0, 0.2 * (1 - daysDifference / 30)); // 0.2 boost for very recent posts, decreasing over 30 days
};

// Utility function to generate random string
const generateRandomString = (length: number): string => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
};

// Hàm để lưu bounty ID vào file
async function saveBountyId(bountyId: string) {
  try {
    // Kiểm tra xem file đã tồn tại chưa
    let existingIds = '';
    try {
      existingIds = await fs.readFile('bounty_id.txt', 'utf8');
    } catch (error) {
      // File không tồn tại, tạo mới
      console.log("Creating new bounty_id.txt file");
      await writeToLog("Creating new bounty_id.txt file");
    }

    // Thêm bounty ID mới vào danh sách
    const updatedIds = existingIds ? `${existingIds.trim()},${bountyId}` : bountyId;
    
    // Ghi lại vào file
    await fs.writeFile('bounty_id.txt', updatedIds);
    console.log(`Bounty ID "${bountyId}" saved to bounty_id.txt`);
    await writeToLog(`Bounty ID "${bountyId}" saved to bounty_id.txt`);
    
    return true;
  } catch (error) {
    console.error("Error saving bounty ID:", error);
    await writeToLog(`Error saving bounty ID: ${error.message}`);
    return false;
  }
}

// Hàm để kiểm tra bounty ID có tồn tại trong file không
async function checkBountyIdExists(bountyId: string) {
  try {
    // Đọc file danh sách bounty ID
    let existingIds = '';
    try {
      existingIds = await fs.readFile('bounty_id.txt', 'utf8');
    } catch (error) {
      // File không tồn tại
      console.log("bounty_id.txt does not exist yet");
      await writeToLog("bounty_id.txt does not exist yet");
      return false;
    }

    // Chuyển thành mảng và kiểm tra
    const idArray = existingIds.split(',').map(id => id.trim());
    const exists = idArray.includes(bountyId);
    
    console.log(`Checking if bounty ID "${bountyId}" exists: ${exists ? 'YES' : 'NO'}`);
    await writeToLog(`Checking if bounty ID "${bountyId}" exists: ${exists ? 'YES' : 'NO'}`);
    
    return exists;
  } catch (error) {
    console.error("Error checking bounty ID:", error);
    await writeToLog(`Error checking bounty ID: ${error.message}`);
    return false;
  }
}

// Add this function to extract deadline from user query
const extractDeadline = (text: string): number => {
    // Look for deadline in various formats
    const deadlineMatch = text.toLowerCase().match(/deadline:?\s*(\d+)\s*(day|days|week|weeks)/i);
    
    if (deadlineMatch) {
        const amount = parseInt(deadlineMatch[1]);
        const unit = deadlineMatch[2].toLowerCase();
        
        // Convert to seconds
        if (unit.startsWith('week')) {
            return amount * 7 * 24 * 60 * 60;
        } else {
            return amount * 24 * 60 * 60;
        }
    }
    
    // Default to 7 days in seconds
    return 7 * 24 * 60 * 60;
};

// Add this utility function for date formatting
const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp * 1000); // Convert seconds to milliseconds
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// Modify the createBountyPools function to use generated content
const createBountyPools = async (
    runtime: IAgentRuntime,
    posts: Array<ProcessedPost & { similarity: number }>,
    queryText: string // Now we only need the query text
): Promise<any> => {
    try {
        // ✅ Calculate average similarity score
        const avgSimilarity = posts.reduce((sum, post) => sum + (post.similarity || 0), 0) / posts.length;
        
        // ✅ Calculate parameters based on similarity
        const stakingAmount = Math.round(avgSimilarity * 1000);
        const minimumOfUser = Math.max(2, Math.round(avgSimilarity * 5));
        
        // ✅ Get expireTime from query or use default
        const expireTime = extractDeadline(queryText);

        // ✅ Generate unique bounty ID
        const bountyId = `bounty_${Date.now()}`;

        // ✅ Generate bounty content using AI
        const bountyContent = await generateText({
            runtime,
            context: generateBountyPrompt(queryText, posts.map(p => p.text).join('\n')),
            modelClass: ModelClass.SMALL,
        });

        // Parse the generated content
        const contentSections = parseBountyContent(bountyContent);
        
        // ✅ Prepare data for Pinata
        const pinataData = {
            bountyId,
            ...contentSections,
            allPostsContent: posts.map(post => {
                return `Author: ${post.authorFullname}\n${post.originalTexts.join('\n')}`;
            }).join('\n\n'),
            relatedAuthors: [...new Set(posts.map(post => post.authorFullname))]
        };

        console.log("\n=== UPLOADING DATA TO PINATA ===");
        const pinataResult = await uploadToPinata(pinataData);
        const dataRefer = pinataResult.IpfsHash || null;

        // ✅ Create bounty on blockchain
        console.log(`\n=== CREATING BOUNTY ON APTOS ===`);
        const transaction = await createBounty(
            dataRefer || "",  
            bountyId,
            stakingAmount,
            minimumOfUser,
            expireTime
        );

        const transactionHash = transaction && 'hash' in transaction ? transaction.hash : null;

        // ✅ Create complete bounty result
        const bountyResult: any = {
            bountyId,
            dataRefer,
            transactionHash,
            stakingAmount,
            minimumOfUser,
            expireTime,
            ...contentSections, // Include generated content
            postCount: posts.length,
            avgSimilarity,
            pinataHash: dataRefer,
            pinataUrl: pinataResult.url || null
        };

        await saveBountyId(bountyId);
        return bountyResult;
    } catch (error) {
        console.error("❌ Error creating bounty:", error);
        await writeToLog(`Error creating bounty: ${error.message}`);
        return null;
    }
};

// Sửa lại hàm parseBountyContent
const parseBountyContent = (content: string) => {
    const sections: any = {
        title: '',
        description: '',
        requirements: [],
        tags: []
    };

    const lines = content.split('\n');
    let currentSection = '';

    for (const line of lines) {
        const trimmedLine = line.trim();
        
        if (line.includes('**Title**')) {
            currentSection = 'title';
        } else if (line.includes('**Description**')) {
            currentSection = 'description';
        } else if (line.includes('**Requirements**')) {
            currentSection = 'requirements';
        } else if (line.includes('**Tags**')) {
            currentSection = 'tags';
        } else if (trimmedLine) {
            switch (currentSection) {
                case 'title':
                    sections.title = trimmedLine;
                    break;
                case 'description':
                    sections.description += (sections.description ? '\n' : '') + trimmedLine;
                    break;
                case 'requirements':
                    if (trimmedLine.startsWith('-')) {
                        sections.requirements.push(trimmedLine.substring(1).trim());
                    }
                    break;
                case 'tags':
                    // Xử lý tags từ AI generate
                    if (trimmedLine) {
                        sections.tags = trimmedLine
                            .split(',')
                            .map((tag: string) => tag.trim())
                            .filter((tag: string) => tag.length > 0);
                    }
                    break;
            }
        }
    }

    return sections;
};

// Hàm phân tích input của người dùng để trích xuất các tiêu chí
const extractCriteria = (text: string): string[] => {
    // Tìm vị trí của dấu ":" trong văn bản
    const colonIndex = text.indexOf(':');
    if (colonIndex === -1) return [];
    
    // Lấy phần văn bản sau dấu ":"
    const criteriaText = text.substring(colonIndex + 1).trim();
    
    // Tách thành các dòng và loại bỏ dòng trống
    const lines = criteriaText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);
    
    return lines;
};

export default {
    name: "CREATE_BOUNTY",
    similes: [
        "create bounty", "help me create bounty", "evaluate submission", "check submission"
    ],
    description: "Create a bounty for a specific topic or question, or evaluate a submission for an existing bounty",

    validate: async (runtime: IAgentRuntime, message: Memory) => {
        return message.content?.text?.length > 0;
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: {
            userAddress?: string;
            [key: string]: unknown
        },
        callback?: HandlerCallback
    ) => {
        try {
            await writeToLog(`Starting action with message: ${message.content.text}`);
            
            // Kiểm tra xem người dùng muốn đánh giá submission hay tạo bounty mới
            const messageText = message.content.text.toLowerCase();
            const isEvaluationRequest = messageText.includes('evaluate') || 
                                        messageText.includes('check submission') || 
                                        messageText.includes('verify submission');
            
            if (isEvaluationRequest) {
                // Xử lý yêu cầu đánh giá submission
                await writeToLog("Processing submission evaluation request");
                
                // Tìm bounty ID trong tin nhắn
                const bountyIdMatch = messageText.match(/bounty[_\s-]?id[:\s]+([a-zA-Z0-9_-]+)/i) || 
                                     messageText.match(/for\s+bounty[:\s]+([a-zA-Z0-9_-]+)/i) ||
                                     messageText.match(/([a-zA-Z0-9_-]{20,})/); // Tìm chuỗi dài có thể là ID
                
                let bountyId;
                if (bountyIdMatch && bountyIdMatch[1]) {
                    bountyId = bountyIdMatch[1].trim();
                } else {
                    // Nếu không tìm thấy ID, sử dụng ID mặc định hoặc yêu cầu người dùng cung cấp
                    bountyId = "QmWSCo3nbstRD97wSdjJx6Nt2saBRMEQKfeeYFDWpgabpg"; // Hash mới
                    console.log("No bounty ID found in message, using default ID for demo purposes");
                    await writeToLog("No bounty ID found, using default ID");
                }
                
                console.log(`Processing evaluation for bounty ID: ${bountyId}`);

                
                await writeToLog("Submission evaluation completed successfully");
                
            } else {
                // Xử lý yêu cầu tạo bounty mới (code hiện tại)
                await writeToLog("Processing bounty creation request");

                // Trích xuất các tiêu chí từ input của người dùng
                const criteria = extractCriteria(message.content.text);
                await writeToLog(`Extracted ${criteria.length} criteria from user input`);

                const parentId = (options.parentId as string) || "45c6c728-6e0d-4260-8c2e-1bb25d285874";
                
                let rawData;
                const maxRetries = 3;
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        rawData = await getFilesByParentId(parentId);
                        await writeToLog(`Successfully retrieved data on attempt ${i + 1}`);
                        break;
                    } catch (error) {
                        await writeToLog(`Failed attempt ${i + 1} to get data: ${error.message}`);
                        if (i === maxRetries - 1) throw error;
                        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
                    }
                }

                if (!rawData || typeof rawData === "string") {
                    await writeToLog('No valid data found');
                    throw new Error('No valid data found');
                }

                // Process raw data into structured format
                const processedPosts = rawData.map((item: any) => {
                    const data = item.data;
                    const items = Array.isArray(data) ? data : [data];
                    return items.map(d => ({
                        authorFullname: d.authorFullname || 'Unknown',
                        text: d.text || '',
                        timestamp: d.timestamp || item.timestamp || new Date().toISOString()
                    }));
                }).flat().filter(post => post.text && post.text.length > 0);

                // Filter and group posts
                const filteredPosts = filterLongPosts(processedPosts);
                const groupedPosts = groupPostsById(filteredPosts);

                // Log processing steps
                await writeToLog(`Processed ${processedPosts.length} posts`);
                await writeToLog(`Filtered to ${filteredPosts.length} posts`);
                await writeToLog(`Grouped into ${groupedPosts.length} author groups`);

                // Create embeddings
                await writeToLog("Starting embeddings generation...");
                const postEmbeddings = await embedDocumentsOptimized(
                    groupedPosts.map(post => post.text)
                );
                await writeToLog("Completed post embeddings generation");

                // Create query embedding including author context if available
                const queryText = `${message.content.text} ${(message.content as any).authorFullname || ''}`;
                await writeToLog("Starting query embedding generation...");
                const queryEmbedding = await embedDocumentsOptimized([queryText]);
                await writeToLog("Completed query embedding generation");

                // Rank posts
                await writeToLog("Starting post ranking...");
                const rankedPosts = groupedPosts.map((post, index) => ({
                    ...post,
                    similarity: calculateSimilarity(
                        postEmbeddings[index],
                        queryEmbedding[0],
                        post,
                        message.content.text
                    )
                }))
                .sort((a, b) => b.similarity - a.similarity);
                
                // Create bounty pools from all posts (now without criteria parameter)
                const bountyResult = await createBountyPools(runtime, rankedPosts, message.content.text);

                // Get top posts for response
                const topPosts = rankedPosts.slice(0, 3);

                // Send response with bounty results
                callback?.({
                    text: `I've created a bounty based on your request! Here are the details:

📌 **${bountyResult.title}**

📝 ${bountyResult.description}

🎯 Requirements:
${bountyResult.requirements.map(req => `• ${req}`).join('\n')}

🏷️ Tags: ${bountyResult.tags.join(', ')}`,
                    action: CreateBountyAction.CREATE_BOUNTY,
                    params: {
                        label: bountyResult.title,
                        relevantPosts: topPosts.map(post => ({
                            authorFullname: post.authorFullname,
                            text: post.text,
                            similarity: post.similarity
                        })),
                        bountyResult: {
                            ...bountyResult,
                            formattedDeadline: formatDate(Date.now()/1000 + bountyResult.expireTime)
                        },
                        pinataHash: bountyResult?.pinataHash
                    }
                });
                await writeToLog("CREATE_BOUNTY analysis completed successfully with bounty");
            }
        } catch (error) {
            await writeToLog(`Error in action handler: ${error.message}\n${error.stack}`);
            throw error;
        }
    },

    examples: [
        [
            {
                user: "{{user1}}",
                content: {
                    text: "What is the trend in crypto posts?"
                }
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Recent posts show strong focus on Bitcoin ETF approval and institutional adoption."
                }
            }
        ],
        [
            {
                user: "{{user1}}",
                content: {
                    text: "Evaluate submission for bounty_1234567890"
                }
            },
            {
                user: "{{user2}}",
                content: {
                    text: "Evaluation completed. The submission scored 8/10 and qualifies for the bounty."
                }
            }
        ]
    ] as ActionExample[][]
};