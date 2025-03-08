import { OpenAIEmbeddings } from '@langchain/openai';
import { Action, ActionExample, Memory, IAgentRuntime, State, HandlerCallback, generateText, ModelClass, elizaLogger, RAGKnowledgeItem } from "@elizaos/core";
import { analyzePostPrompt, getAllPostsPrompt } from "./prompts";
import { ChatDataAction, GiveInsightDataAction } from "./enum";
import * as fs from 'fs/promises';
import * as path from 'path';
import { getFolderByUserAddress } from '../services/tusky';
import { getFilesByParentId } from '../services/tusky';

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

export default {
    name: "DATA_INSIGHT",
    similes: [
        "insight data", "what is the data", "show me the data purpose",
        "give me insights", "data insight", "what is author post", "give me author post", 
        "what post about", "`what post about author`", "give me all of the posts", 
        "show all posts", "list all posts", "display all posts", "give me all posts you have crawled"
    ],
    description: "Insight data from all collected data",

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
            await writeToLog("Starting DATA_INSIGHT analysis...");

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

            // Check if this is a request for all posts
            const isAllPostsRequest = message.content.text.toLowerCase().includes('all') && 
                                    message.content.text.toLowerCase().includes('post');

            if (isAllPostsRequest) {
                await writeToLog("Processing all posts request...");
                // Sort posts by timestamp
                const sortedPosts = processedPosts.sort((a, b) => 
                    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
                );

                const context = JSON.stringify(sortedPosts);
                const response = await generateText({
                    runtime,
                    context: getAllPostsPrompt(message.content.text, context),
                    modelClass: ModelClass.SMALL,
                    stop: ["\n\n\n"],
                });

                callback?.({
                    text: response.trim(),
                    action: GiveInsightDataAction.GIVE_INSIGHT_DATA,
                    params: {
                        label: "All Posts Table",
                        allPosts: sortedPosts.slice(0, 20).map((post, index) => ({
                            no: index + 1,
                            authorFullname: post.authorFullname,
                            text: post.text,
                            // timestamp: post.timestamp
                        })),
                        totalPosts: processedPosts.length,
                        uniqueAuthors: new Set(processedPosts.map(p => p.authorFullname)).size
                    }
                });
                await writeToLog("All posts table generated successfully");
                return;
            }

            // Original insight logic for other queries
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
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, 3);
            await writeToLog(`Ranked posts and selected top ${rankedPosts.length}`);

            // Generate response
            await writeToLog("Generating text response...");
            const context = rankedPosts.map(post => post.text).join('\n\n');
            const response = await generateText({
                runtime,
                context: analyzePostPrompt(message.content.text, context),
                modelClass: ModelClass.SMALL,
                stop: ["\n"],
            });
            await writeToLog("Completed text response generation");

            // Send response
            await writeToLog("Sending response to callback...");
            callback?.({
                text: response.trim(),
                action: GiveInsightDataAction.GIVE_INSIGHT_DATA,
                params: {
                    label: response.trim(),
                    relevantPosts: rankedPosts.map(post => ({
                        authorFullname: post.authorFullname,
                        text: post.text,
                        similarity: post.similarity
                    }))
                }
            });
            await writeToLog("DATA_INSIGHT analysis completed successfully");

        } catch (error) {
            await writeToLog(`Error in data analysis: ${error.message}\n${error.stack}`);
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
                    text: "Show me the data insights"
                }
            },
            {
                user: "{{user2}}",
                content: {
                    text: "The posts discuss various crypto topics including BTC price, ETH ecosystem, and NFT markets."
                }
            }
        ]
    ] as ActionExample[][]
};