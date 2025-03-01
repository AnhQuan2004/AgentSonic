// import { OpenAIEmbeddings } from '@langchain/openai';
// import { Action, ActionExample, Memory, IAgentRuntime, State, HandlerCallback, generateText, ModelClass, elizaLogger, RAGKnowledgeItem } from "@elizaos/core";
// import { analyzePostPrompt } from "./prompts";
// import { ChatDataAction } from "./enum";
// import * as fs from 'fs/promises';
// import * as path from 'path';
// import * as crypto from 'crypto';
// import { PineconeClient } from '@pinecone-database/pinecone';
// import { getFilesByParentId } from '../services/tusky';

// // Pinecone Configuration
// const PINECONE_API_KEY = "your-api-key-here"; // Bạn cần thêm API key vào đây
// const PINECONE_ENVIRONMENT = "us-east-1-aws";
// const PINECONE_INDEX_NAME = "multilingual-e5-large";
// const PINECONE_HOST = "https://multilingual-e5-large-ebrobf2.svc.aped-4627-b74a.pinecone.io";
// const OPENAI_API_KEY = "your-openai-key"; // Bạn cần thêm OpenAI key vào đây

// // Initialize Pinecone client
// const initPinecone = async () => {
//     const pinecone = new PineconeClient();
//     await pinecone.init({
//         apiKey: PINECONE_API_KEY,
//         environment: PINECONE_ENVIRONMENT
//     });
//     return pinecone;
// };

// // Create MD5 hash for vector ID
// const createVectorId = (text: string): string => {
//     return crypto.createHash('md5').update(text).digest('hex');
// };

// // Save embeddings to Pinecone
// const saveEmbeddingsToPinecone = async (text: string, embedding: number[]) => {
//     try {
//         const pinecone = await initPinecone();
//         const index = pinecone.Index(PINECONE_INDEX_NAME);
        
//         // Ensure embedding length matches index dimensions (1024)
//         if (embedding.length !== 1024) {
//             throw new Error(`Embedding dimension mismatch. Expected 1024, got ${embedding.length}`);
//         }

//         await index.upsert({
//             upsertRequest: {
//                 vectors: [{
//                     id: createVectorId(text),
//                     values: embedding,
//                     metadata: {
//                         text,
//                         timestamp: new Date().toISOString()
//                     }
//                 }],
//                 namespace: '' // Default namespace
//             }
//         });
        
//         await writeToLog(`Successfully saved embedding for text: ${text.substring(0, 50)}...`);
//     } catch (error) {
//         await writeToLog(`Error saving embedding: ${error.message}`);
//         console.error('Error saving embeddings to Pinecone:', error);
//         throw error;
//     }
// };

// // Get embeddings from Pinecone
// const getEmbeddingsFromPinecone = async (text: string): Promise<number[] | null> => {
//     try {
//         const pinecone = await initPinecone();
//         const index = pinecone.Index(PINECONE_INDEX_NAME);
        
//         const vectorId = createVectorId(text);
//         const result = await index.fetch({
//             ids: [vectorId],
//             namespace: '' // Default namespace
//         });
        
//         if (result.vectors[vectorId]) {
//             await writeToLog(`Retrieved existing embedding for text: ${text.substring(0, 50)}...`);
//             return result.vectors[vectorId].values;
//         }
//         await writeToLog(`No existing embedding found for text: ${text.substring(0, 50)}...`);
//         return null;
//     } catch (error) {
//         await writeToLog(`Error fetching embedding: ${error.message}`);
//         console.error('Error fetching embeddings from Pinecone:', error);
//         return null;
//     }
// };

// // Modified embedDocumentsOptimized to use Pinecone
// const embedDocumentsOptimized = async (texts: string[]) => {
//     const embeddings = new OpenAIEmbeddings({
//         apiKey: OPENAI_API_KEY,
//         modelName: 'text-embedding-3-large', // Using latest model
//         dimensions: 1024 // Match Pinecone index dimensions
//     });
    
//     const results: number[][] = [];
    
//     for (const text of texts) {
//         try {
//             // Try to get from Pinecone first
//             let embedding = await getEmbeddingsFromPinecone(text);
            
//             if (!embedding) {
//                 // If not in Pinecone, generate new embedding
//                 const [newEmbedding] = await embeddings.embedDocuments([text]);
//                 embedding = newEmbedding;
//                 // Save to Pinecone for future use
//                 await saveEmbeddingsToPinecone(text, embedding);
//                 await writeToLog(`Created new embedding for text: ${text.substring(0, 50)}...`);
//             }
            
//             results.push(embedding);
//         } catch (error) {
//             await writeToLog(`Error in embedDocumentsOptimized: ${error.message}`);
//             console.error('Error processing text:', text.substring(0, 50) + '...', error);
//             throw error;
//         }
//     }
    
//     return results;
// };

// // Utility function to write logs to file
// async function writeToLog(message: string) {
//     const timestamp = new Date().toISOString();
//     const logMessage = `[${timestamp}] ${message}\n`;
//     try {
//         await fs.appendFile('log.txt', logMessage);
//     } catch (error) {
//         console.error('Error writing to log file:', error);
//     }
// }

// export interface DataItem {
//     authorFullname: string;
//     text: string;
//     timestamp?: string; // Optional timestamp for recency boost
// }

// interface ProcessedPost {
//     authorFullname: string;
//     text: string;
//     originalTexts: string[]; // Store original texts separately
//     timestamp?: string;
//     embedding?: number[];
// }

// const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
//     const dotProduct = vecA.reduce((sum, val, index) => sum + val * vecB[index], 0);
//     const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
//     const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));
//     return dotProduct / (magnitudeA * magnitudeB);
// };

// const groupPostsById = (posts: DataItem[]): ProcessedPost[] => {
//     const groupedPosts = new Map<string, { texts: string[], timestamps: string[] }>();
    
//     // Group all texts and timestamps by authorFullname
//     posts.forEach(post => {
//         if (!groupedPosts.has(post.authorFullname)) {
//             groupedPosts.set(post.authorFullname, { texts: [], timestamps: [] });
//         }
//         const group = groupedPosts.get(post.authorFullname)!;
//         if (post.text && post.text.length > 0) {
//             group.texts.push(post.text);
//             group.timestamps.push(post.timestamp || '');
//         }
//     });

//     // Convert grouped posts to final format
//     return Array.from(groupedPosts.entries()).map(([authorFullname, group]) => ({
//         authorFullname,
//         text: `Author: ${authorFullname}\nPosts:\n${group.texts.map((t, i) => `[${i + 1}] ${t}`).join('\n\n')}`,
//         originalTexts: group.texts,
//         timestamp: group.timestamps[group.timestamps.length - 1] // Use most recent timestamp
//     }));
// };

// const filterLongPosts = (posts: DataItem[], minLength: number = 50): DataItem[] => {
//     return posts.filter(post => post.text.length >= minLength);
// };

// const calculateSimilarity = (
//     postEmbedding: number[], 
//     queryEmbedding: number[], 
//     post: ProcessedPost,
//     query: string
// ): number => {
//     // Base semantic similarity
//     const similarity = cosineSimilarity(postEmbedding, queryEmbedding);
    
//     // Convert to lowercase for case-insensitive matching
//     const postLower = post.text.toLowerCase();
//     const queryLower = query.toLowerCase();
//     const authorLower = post.authorFullname.toLowerCase();
    
//     // Exact phrase matching boost
//     const phraseBoost = post.originalTexts.some(text => 
//         text.toLowerCase().includes(queryLower)
//     ) ? 0.2 : 0;
    
//     // Author matching boost
//     const authorBoost = queryLower.includes(authorLower) ? 0.3 : 0;
    
//     // Individual terms matching boost
//     const queryTerms = queryLower.split(' ').filter(term => term.length > 2);
//     const termBoost = queryTerms.reduce((boost, term) => {
//         return boost + (postLower.includes(term) ? 0.1 : 0);
//     }, 0);

//     // Recency boost if timestamp is available
//     const recencyBoost = post.timestamp ? calculateRecencyBoost(post.timestamp) : 0;
    
//     return similarity + phraseBoost + termBoost + authorBoost + recencyBoost;
// };

// const calculateRecencyBoost = (timestamp: string): number => {
//     const postDate = new Date(timestamp);
//     const now = new Date();
//     const daysDifference = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60 * 24);
//     return Math.max(0, 0.2 * (1 - daysDifference / 30)); // 0.2 boost for very recent posts, decreasing over 30 days
// };

// export default {
//     name: "DATA_INSIGHT",
//     similes: [
//         "insight data", "what is the data", "show me the data purpose",
//         "give me insights", "data insight", "what is author post", "give me author post", "what post about", "`what post about author`"
//     ],
//     description: "Insight data from all collected data",

//     validate: async (runtime: IAgentRuntime, message: Memory) => {
//         return message.content?.text?.length > 0;
//     },

//     handler: async (
//         runtime: IAgentRuntime,
//         message: Memory,
//         state: State,
//         options: {
//             userAddress?: string;
//             [key: string]: unknown
//         },
//         callback?: HandlerCallback
//     ) => {
//         try {
//             await writeToLog("Starting DATA_INSIGHT analysis...");

//             const parentId = (options.parentId as string) || "45c6c728-6e0d-4260-8c2e-1bb25d285874";
            
//             let rawData;
//             const maxRetries = 3;
//             for (let i = 0; i < maxRetries; i++) {
//                 try {
//                     rawData = await getFilesByParentId(parentId);
//                     await writeToLog(`Successfully retrieved data on attempt ${i + 1}`);
//                     break;
//                 } catch (error) {
//                     await writeToLog(`Failed attempt ${i + 1} to get data: ${error.message}`);
//                     if (i === maxRetries - 1) throw error;
//                     await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
//                 }
//             }

//             if (!rawData || typeof rawData === "string") {
//                 await writeToLog('No valid data found');
//                 throw new Error('No valid data found');
//             }

//             // Process raw data into structured format
//             const processedPosts = rawData.map((item: any) => {
//                 const data = item.data;
//                 const items = Array.isArray(data) ? data : [data];
//                 return items.map(d => ({
//                     authorFullname: d.authorFullname || 'Unknown',
//                     text: d.text || '',
//                     timestamp: d.timestamp || item.timestamp || new Date().toISOString()
//                 }));
//             }).flat().filter(post => post.text && post.text.length > 0);

//             // Filter and group posts
//             const filteredPosts = filterLongPosts(processedPosts);
//             const groupedPosts = groupPostsById(filteredPosts);

//             // Log processing steps
//             await writeToLog(`Processed ${processedPosts.length} posts`);
//             await writeToLog(`Filtered to ${filteredPosts.length} posts`);
//             await writeToLog(`Grouped into ${groupedPosts.length} author groups`);

//             // Create embeddings
//             await writeToLog("Starting embeddings generation...");
//             const postEmbeddings = await embedDocumentsOptimized(
//                 groupedPosts.map(post => post.text)
//             );
//             await writeToLog("Completed post embeddings generation");

//             // Create query embedding including author context if available
//             const queryText = `${message.content.text} ${(message.content as any).authorFullname || ''}`;
//             await writeToLog("Starting query embedding generation...");
//             const queryEmbedding = await embedDocumentsOptimized([queryText]);
//             await writeToLog("Completed query embedding generation");

//             // Rank posts
//             await writeToLog("Starting post ranking...");
//             const rankedPosts = groupedPosts.map((post, index) => ({
//                 ...post,
//                 similarity: calculateSimilarity(
//                     postEmbeddings[index],
//                     queryEmbedding[0],
//                     post,
//                     message.content.text
//                 )
//             }))
//             .sort((a, b) => b.similarity - a.similarity)
//             .slice(0, 3);
//             await writeToLog(`Ranked posts and selected top ${rankedPosts.length}`);

//             // Generate response
//             await writeToLog("Generating text response...");
//             const context = rankedPosts.map(post => post.text).join('\n\n');
//             const response = await generateText({
//                 runtime,
//                 context: analyzePostPrompt(message.content.text, context),
//                 modelClass: ModelClass.MEDIUM,
//                 stop: ["\n"],
//             });
//             await writeToLog("Completed text response generation");

//             // Send response
//             await writeToLog("Sending response to callback...");
//             callback?.({
//                 text: response.trim(),
//                 action: ChatDataAction.ANALYZE_POST,
//                 params: {
//                     label: response.trim(),
//                     relevantPosts: rankedPosts.map(post => ({
//                         authorFullname: post.authorFullname,
//                         text: post.text,
//                         similarity: post.similarity
//                     }))
//                 }
//             });
//             await writeToLog("DATA_INSIGHT analysis completed successfully");

//         } catch (error) {
//             await writeToLog(`Error in data analysis: ${error.message}\n${error.stack}`);
//             throw error;
//         }
//     },

//     examples: [
//         [
//             {
//                 user: "{{user1}}",
//                 content: {
//                     text: "What is the trend in crypto posts?"
//                 }
//             },
//             {
//                 user: "{{user2}}",
//                 content: {
//                     text: "Recent posts show strong focus on Bitcoin ETF approval and institutional adoption."
//                 }
//             }
//         ],
//         [
//             {
//                 user: "{{user1}}",
//                 content: {
//                     text: "Show me the data insights"
//                 }
//             },
//             {
//                 user: "{{user2}}",
//                 content: {
//                     text: "The posts discuss various crypto topics including BTC price, ETH ecosystem, and NFT markets."
//                 }
//             }
//         ]
//     ] as ActionExample[][]
// };