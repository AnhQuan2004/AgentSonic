import { OpenAIEmbeddings } from '@langchain/openai';
import { Action, ActionExample, Memory, IAgentRuntime, State, HandlerCallback, generateText, ModelClass, elizaLogger, RAGKnowledgeItem } from "@elizaos/core";
import { analyzePostPrompt, evaluateSubmissionPrompt } from "./prompts";
import { CreateBountyAction } from "./enum";
import * as fs from 'fs/promises';
import * as path from 'path';
import { getFolderByUserAddress } from '../services/tusky';
import { getFilesByParentId } from '../services/tusky';
import axios from 'axios';
// Import bounty functions
import { createBounty, participateInBounty, get_all_bounties, get_bounties_by_creator, get_bounty_by_id } from '../services/bounty';
// Sử dụng service Pinata mới
import { uploadToPinata, getFromPinata } from '../services/pinata';
// Import the fetchPinataData function
import { fetchPinataData } from './get_pinata_data';
// Import PinataSDK
// import PinataSDK from '@pinata/sdk';

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

// Tích hợp chức năng từ get_submit_data.ts
async function fetchSubmitData() {
  try {
    const pinataHash = "QmPsq38epeMvPfmQChGrhEPk45ZwoVZrvToBzN5yRM3rE2"; // Hash mới
    
    console.log(`\n=== FETCHING SUBMISSION DATA ===`);
    console.log(`Fetching submission data for pinataHash: ${pinataHash}`);
    await writeToLog(`Fetching submission data for pinataHash: ${pinataHash}`);
    
    // Call the getFromPinata function with the provided hash
    const result = await getFromPinata(pinataHash);
    
    if (result.success) {
      console.log("Submission data retrieved successfully from Pinata");
      await writeToLog("Submission data retrieved successfully from Pinata");
      
      // Extract only needed fields
      const submissionData = {
        author: result.data.author,
        bountyId: result.data.bountyId,
        submission: result.data.submission,
        walletAddress: result.data.walletAddress,
        uploadTime: result.data.uploadTime
      };

      console.log("--- Retrieved Submission Data ---");
      console.log(JSON.stringify(submissionData, null, 2));
      await writeToLog(`Retrieved submission data: ${JSON.stringify(submissionData)}`);

      // Kiểm tra xem bounty ID có tồn tại trong danh sách đã lưu không
      if (submissionData.bountyId) {
        const bountyExists = await checkBountyIdExists(submissionData.bountyId);
        submissionData['bountyExists'] = bountyExists;
        console.log(`Submission bounty ID "${submissionData.bountyId}" exists in our records: ${bountyExists ? 'YES' : 'NO'}`);
        await writeToLog(`Submission bounty ID "${submissionData.bountyId}" exists in our records: ${bountyExists ? 'YES' : 'NO'}`);
      }

      // Save data to file for reference
      await fs.writeFile('submission_data.json', JSON.stringify(submissionData, null, 2));
      console.log("Submission data saved to submission_data.json");
      console.log(`=== END OF SUBMISSION DATA ===\n`);

      return submissionData;
    } else {
      console.error("Failed to retrieve submission data:", result.message);
      await writeToLog(`Failed to retrieve submission data: ${result.message}`);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error("Error retrieving submission data:", error);
    await writeToLog(`Error retrieving submission data: ${error.message}`);
    throw error;
  }
}

// Tích hợp chức năng từ check_verify.ts
async function checkAndVerify(pinataHash: string, submissionData: any) {
  try {
    console.log("=== STARTING VERIFICATION PROCESS ===");
    await writeToLog("=== STARTING VERIFICATION PROCESS ===");
    
    // Sử dụng dữ liệu submission đã có
    console.log("\n[1] Using existing submission data");
    await writeToLog("Using existing submission data");
    
    console.log("\n[2] Fetching pinata data with provided hash...");
    await writeToLog(`Fetching pinata data with hash: ${pinataHash}`);
    
    try {
      // Lấy dữ liệu từ Pinata với hash được cung cấp
      const pinataData = await fetchPinataData(pinataHash);
      
      // So sánh dữ liệu
      console.log("\n=== VERIFICATION RESULTS ===");
      console.log("Submission Data:");
      console.log(JSON.stringify(submissionData, null, 2));
      
      console.log("\nPinata Data (key fields):");
      const pinataKeyData = {
        bountyId: pinataData.bountyId || 'Not available',
        criteria: pinataData.criteria || 'Not available',
        contentSummary: pinataData.allPostsContent ? 
          `${pinataData.allPostsContent.substring(0, 100)}...` : 
          'Not available'
      };
      console.log(JSON.stringify(pinataKeyData, null, 2));
      
      // Kiểm tra các trường khớp nhau
      console.log("\nField Comparison:");
      if (submissionData.bountyId && pinataData.bountyId) {
        console.log(`Bounty ID Match: ${submissionData.bountyId === pinataData.bountyId ? 'YES' : 'NO'}`);
      }
      
      if (submissionData.author && pinataData.author) {
        console.log(`Author Match: ${submissionData.author === pinataData.author ? 'YES' : 'NO'}`);
      }
      
      // Lưu kết quả kết hợp vào file
      const combinedResults = {
        timestamp: new Date().toISOString(),
        submissionData,
        pinataData: pinataKeyData,
        fullPinataData: pinataData
      };
      
      await fs.writeFile('verification_results.json', JSON.stringify(combinedResults, null, 2));
      console.log("\nVerification results saved to verification_results.json");
      await writeToLog("Verification results saved to verification_results.json");
      
      return combinedResults;
    } catch (error) {
      console.log(`\nWarning: Could not verify with Pinata hash. Error: ${error.message}`);
      await writeToLog(`Warning: Could not verify with Pinata hash. Error: ${error.message}`);
      
      // Nếu không thể xác minh với hash Pinata, vẫn trả về dữ liệu submission
      return {
        timestamp: new Date().toISOString(),
        submissionData,
        pinataData: null,
        error: error.message
      };
    }
  } catch (error) {
    console.error("Verification process failed:", error);
    await writeToLog(`Verification process failed: ${error.message}`);
    throw error;
  }
}

// Thay đổi hàm createBountyPools để chỉ tạo một bounty duy nhất và gộp dữ liệu
const createBountyPools = async (runtime: IAgentRuntime, posts: Array<ProcessedPost & { similarity: number }>, criteria: string[]): Promise<any> => {
    try {
        // Tính điểm trung bình của tất cả các bài viết
        const avgSimilarity = posts.reduce((sum, post) => sum + (post.similarity || 0), 0) / posts.length;
        
        // Tính toán các tham số dựa trên điểm trung bình
        const stakingAmount = Math.round(avgSimilarity * 1000); // Số tiền stake dựa trên điểm tương đồng
        const minimumOfUser = Math.max(2, Math.round(avgSimilarity * 5)); // Số người tối thiểu
        const expireTime = Math.round(avgSimilarity * 10 * 24 * 60 * 60); // Thời gian hết hạn (tính bằng giây)
        
        // Tạo một bounty ID duy nhất
        const bountyId = `bounty_${Date.now()}`;
        const transaction = await createBounty(bountyId, stakingAmount, minimumOfUser, expireTime);
        
        // Check if transaction exists and has a hash
        const transactionHash = transaction && 'hash' in transaction ? transaction.hash : null;
        
        // Gộp tất cả nội dung bài viết thành một đoạn văn
        const allPostsContent = posts.map(post => {
            return `Author: ${post.authorFullname}\n${post.originalTexts.join('\n')}`;
        }).join('\n\n');
        
        // Thêm thông tin về các tác giả có liên quan
        const relatedAuthors = [...new Set(posts.map(post => post.authorFullname))];
        
        // Tạo kết quả bounty với đầy đủ thông tin
        const bountyResult: any = {
            bountyId,
            transactionHash,
            stakingAmount,
            minimumOfUser,
            expireTime: `${Math.round(expireTime / (24 * 60 * 60))} days`,
            postCount: posts.length,
            avgSimilarity,
            relatedAuthors,
            allPostsContent,
            criteria
        };
        
        // Lưu bounty ID vào file
        await saveBountyId(bountyId);
        
        // Upload to Pinata using the new service
        const pinataData = {
            bountyId,
            allPostsContent,
            criteria: criteria && criteria.length > 0 ? criteria : ["No specific criteria provided"]
        };
        
        console.log("\n=== UPLOADING DATA TO PINATA ===");
        console.log("Uploading bounty data to Pinata...");
        await writeToLog("Uploading bounty data to Pinata...");
        
        const pinataResult = await uploadToPinata(pinataData);
        
        // Add Pinata information to the result
        bountyResult.pinataHash = pinataResult.IpfsHash || null;
        bountyResult.pinataUrl = pinataResult.url || null;
        
        console.log(`Upload successful! Pinata hash: ${pinataResult.IpfsHash || 'unknown'}`);
        await writeToLog(`Created single bounty: ${bountyId}, Transaction hash: ${transactionHash || 'unknown'}, Pinata hash: ${pinataResult.IpfsHash || 'unknown'}`);
        
        // Immediately fetch the data from Pinata to verify it was stored correctly
        if (pinataResult.IpfsHash) {
            try {
                console.log(`\n=== FETCHING PINATA DATA ===`);
                console.log(`Fetching data for newly created pinataHash: ${pinataResult.IpfsHash}`);
                await writeToLog(`Fetching data for newly created pinataHash: ${pinataResult.IpfsHash}`);
                
                const fetchedData = await fetchPinataData(pinataResult.IpfsHash);
                
                console.log("Pinata data retrieved successfully!");
                console.log("--- Retrieved Pinata Data ---");
                console.log(JSON.stringify({
                    bountyId: fetchedData.bountyId || 'Not available',
                    criteria: fetchedData.criteria || 'Not available',
                    contentPreview: fetchedData.allPostsContent ? 
                        `${fetchedData.allPostsContent.substring(0, 200)}...` : 
                        'Not available'
                }, null, 2));
                
                await writeToLog(`Successfully verified Pinata data for hash: ${pinataResult.IpfsHash}`);
                
                // Add the fetched data to the result for verification
                bountyResult.verifiedPinataData = fetchedData;
                console.log(`=== END OF PINATA DATA ===\n`);
                
                // Lấy dữ liệu submission từ hash cứng
                try {
                    const submissionData = await fetchSubmitData();
                    
                    // Thêm dữ liệu submission vào kết quả
                    bountyResult.submissionData = submissionData;
                    
                    // In ra cả hai loại dữ liệu để so sánh
                    console.log("\n=== COMPARISON OF BOTH DATA SOURCES ===");
                    console.log("1. Bounty Data (newly created):");
                    console.log(`   - Bounty ID: ${bountyResult.bountyId}`);
                    console.log(`   - Pinata Hash: ${bountyResult.pinataHash}`);
                    
                    console.log("\n2. Submission Data (from hardcoded hash):");
                    console.log(`   - Author: ${submissionData.author}`);
                    console.log(`   - Bounty ID: ${submissionData.bountyId}`);
                    console.log(`   - Wallet Address: ${submissionData.walletAddress}`);
                    console.log(`   - Upload Time: ${submissionData.uploadTime}`);
                    
                    // Thêm thông tin về việc bounty ID có tồn tại trong danh sách không
                    if ('bountyExists' in submissionData) {
                        console.log(`   - Bounty ID exists in records: ${submissionData.bountyExists ? 'YES' : 'NO'}`);
                    }
                    
                    console.log("\n=== END OF COMPARISON ===");
                    await writeToLog("Completed data retrieval from both sources");
                    
                    // Thực hiện đánh giá tự động nếu có đủ dữ liệu
                    if (fetchedData.allPostsContent && submissionData.submission && fetchedData.criteria) {
                        console.log("\nStarting automated evaluation of submission...");
                        await writeToLog("Starting automated evaluation of submission");
                        
                        // In thêm thông tin chi tiết về dữ liệu trước khi đánh giá
                        console.log("\n=== PRE-EVALUATION DATA CHECK ===");
                        console.log(`All Posts Content Length: ${fetchedData.allPostsContent.length} characters`);
                        console.log(`Submission Data Length: ${submissionData.submission.length} characters`);
                        console.log(`Number of Criteria: ${fetchedData.criteria.length}`);
                        console.log("=== END OF PRE-EVALUATION DATA CHECK ===\n");
                        await writeToLog(`Pre-evaluation check: Content length: ${fetchedData.allPostsContent.length}, Submission length: ${submissionData.submission.length}, Criteria count: ${fetchedData.criteria.length}`);
                        
                        const evaluationResult = await evaluateSubmission(
                            runtime,
                            fetchedData.allPostsContent,
                            submissionData.submission,
                            fetchedData.criteria,
                            submissionData
                        );
                        
                        // Thêm kết quả đánh giá vào bountyResult
                        bountyResult.evaluationResult = evaluationResult;
                        
                        console.log("\n=== EVALUATION SUMMARY ===");
                        console.log(`Overall Score: ${evaluationResult.overallScore}/10`);
                        console.log(`Qualifies for Bounty: ${evaluationResult.qualifiesForBounty ? 'YES' : 'NO'}`);
                        
                        // Kiểm tra xem đã thêm người tham gia vào bounty chưa
                        if (evaluationResult.participationStatus) {
                            console.log(`Added to Bounty: ${evaluationResult.participationStatus.success ? 'YES' : 'NO'}`);
                            if (evaluationResult.participationStatus.success) {
                                console.log(`Wallet Address: ${evaluationResult.participationStatus.walletAddress}`);
                                console.log(`Score: ${evaluationResult.participationStatus.score}`);
                            } else {
                                console.log(`Reason: ${evaluationResult.participationStatus.message}`);
                            }
                        }
                        
                        console.log(`Summary: ${evaluationResult.summary}`);
                        console.log("=== END OF EVALUATION SUMMARY ===\n");
                        
                        // Nếu điểm > 7.0 và chưa được thêm vào bounty (trong trường hợp evaluateSubmission không thực hiện)
                        if (evaluationResult.overallScore > 7.0 && !evaluationResult.participationStatus && submissionData.walletAddress) {
                            console.log(`\n=== ADDING PARTICIPANT TO BOUNTY (Score: ${evaluationResult.overallScore}) ===`);
                            console.log(`\n>>> CALLING participateInBounty FROM createBountyPools <<<`);
                            console.log(`- Wallet Address: ${submissionData.walletAddress}`);
                            console.log(`- Score: ${evaluationResult.overallScore}`);
                            console.log(`- Bounty ID: ${bountyId}`);
                            
                            try {
                                // Gọi hàm participateInBounty mà không lưu kết quả trả về
                                await participateInBounty(
                                    submissionData.walletAddress,
                                    evaluationResult.overallScore,
                                    bountyId
                                );
                                
                                console.log(`\n>>> PARTICIPANT SUCCESSFULLY ADDED FROM createBountyPools <<<`);
                                console.log(`- Wallet: ${submissionData.walletAddress}`);
                                console.log(`- Score: ${evaluationResult.overallScore}`);
                                console.log(`- Bounty: ${bountyId}`);
                                
                                await writeToLog(`Added participant ${submissionData.walletAddress} to bounty ${bountyId} with score ${evaluationResult.overallScore}`);
                                
                                // Thêm thông tin tham gia vào kết quả
                                evaluationResult.participationStatus = {
                                    success: true,
                                    message: "Participant added to bounty successfully",
                                    walletAddress: submissionData.walletAddress,
                                    score: evaluationResult.overallScore,
                                    bountyId: bountyId
                                };
                            } catch (error) {
                                console.error(`\n>>> ERROR ADDING PARTICIPANT FROM createBountyPools <<<`);
                                console.error(`- Wallet: ${submissionData.walletAddress}`);
                                console.error(`- Score: ${evaluationResult.overallScore}`);
                                console.error(`- Bounty: ${bountyId}`);
                                console.error(`- Error: ${error.message}`);
                                
                                await writeToLog(`Error adding participant to bounty: ${error.message}`);
                                
                                // Thêm thông tin lỗi vào kết quả
                                evaluationResult.participationStatus = {
                                    success: false,
                                    message: `Error: ${error.message}`,
                                    walletAddress: submissionData.walletAddress,
                                    score: evaluationResult.overallScore,
                                    bountyId: bountyId
                                };
                            }
                        }
                    } else {
                        console.log("\nSkipping automated evaluation due to missing data");
                        await writeToLog("Skipping automated evaluation due to missing data");
                        
                        if (!fetchedData.allPostsContent) console.log("Missing: allPostsContent");
                        if (!submissionData.submission) console.log("Missing: submission data");
                        if (!fetchedData.criteria) console.log("Missing: criteria");
                    }
                } catch (submitError) {
                    console.error("Warning: Could not fetch submission data:", submitError.message);
                    await writeToLog(`Warning: Could not fetch submission data: ${submitError.message}`);
                    // Continue even if submission data fetch fails
                }
            } catch (error) {
                console.error("Warning: Could not verify Pinata data:", error.message);
                await writeToLog(`Warning: Could not verify Pinata data: ${error.message}`);
                // Continue even if verification fails
            }
        }
        
        return bountyResult;
    } catch (error) {
        await writeToLog(`Error creating bounty: ${error.message}`);
        return null;
    }
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

// Xóa phần định nghĩa prompt cũ và cập nhật hàm evaluateSubmission
async function evaluateSubmission(runtime: IAgentRuntime, allPostsContent: string, submission: string, criteria: string[], submissionData?: any) {
  try {
    console.log("\n=== STARTING AUTOMATED EVALUATION ===");
    await writeToLog("Starting automated evaluation of submission");
    
    // In ra các input đầu vào để kiểm tra
    console.log("\n=== EVALUATION INPUTS ===");
    console.log("1. All Posts Content (first 200 chars):");
    console.log(allPostsContent.substring(0, 200) + "...");
    console.log("\n2. Submission Data:");
    console.log(submission);
    console.log("\n3. Criteria:");
    console.log(JSON.stringify(criteria, null, 2));
    
    // Phân tích sơ bộ về mức độ liên quan (CHỈ DÙNG CHO MỤC ĐÍCH THÔNG TIN)
    console.log("\n=== PRELIMINARY ANALYSIS (FOR INFORMATION ONLY) ===");
    console.log("Note: This analysis is purely informational and will NOT affect the model's evaluation");
    
    // Kiểm tra độ dài của submission
    console.log(`Submission length: ${submission.length} characters`);
    if (submission.length < 100) {
      console.log("INFO: Submission is very short");
    }
    
    // Kiểm tra xem submission có chứa từ khóa liên quan đến criteria không
    let keywordMatches = 0;
    const keywordsToCheck = ['code', 'implementation', 'contract', 'function', 'deploy', 'test', 'token', 'move', 'aptos'];
    const submissionLower = submission.toLowerCase();
    
    console.log("Keyword presence (informational only):");
    keywordsToCheck.forEach(keyword => {
      const contains = submissionLower.includes(keyword);
      console.log(`- Contains "${keyword}": ${contains ? 'YES' : 'NO'}`);
      if (contains) keywordMatches++;
    });
    
    console.log(`Total technical keywords found: ${keywordMatches}/${keywordsToCheck.length}`);
    
    // Kiểm tra xem submission có chứa code không
    const codePatterns = ['{', '}', 'function', 'struct', 'module', 'public', 'script', '#[test]'];
    const containsCode = codePatterns.some(pattern => submissionLower.includes(pattern));
    console.log(`Contains code patterns: ${containsCode ? 'YES' : 'NO'}`);
    
    console.log("=== END OF PRELIMINARY ANALYSIS ===");
    console.log("=== END OF EVALUATION INPUTS ===\n");
    
    // Lưu các input vào file để kiểm tra chi tiết
    await fs.writeFile('evaluation_inputs.json', JSON.stringify({
      allPostsContent,
      submission,
      criteria,
      preliminaryAnalysis: {
        submissionLength: submission.length,
        keywordMatches,
        containsCode,
        note: "This analysis is purely informational and does not affect the model's evaluation"
      }
    }, null, 2));
    console.log("Evaluation inputs saved to evaluation_inputs.json for detailed inspection");
    await writeToLog("Saved evaluation inputs to evaluation_inputs.json");
    
    // Sử dụng prompt từ file prompts/index.ts
    const filledPrompt = evaluateSubmissionPrompt(
      allPostsContent,
      submission,
      JSON.stringify(criteria)
    );
    
    console.log("Evaluating submission against criteria...");
    await writeToLog("Evaluating submission against criteria");
    
    // Gọi model để đánh giá - ĐÂY LÀ PHẦN QUYẾT ĐỊNH CUỐI CÙNG
    console.log("Sending evaluation request to model - model will make the final decision");
    const evaluationResponse = await generateText({
      runtime,
      context: filledPrompt,
      modelClass: ModelClass.LARGE, // Sử dụng model lớn để có kết quả tốt hơn
      stop: [],
    });
    
    console.log("Evaluation completed by model");
    
    // Cố gắng parse kết quả JSON từ phản hồi
    try {
      // Tìm phần JSON trong phản hồi
      const jsonMatch = evaluationResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                        evaluationResponse.match(/{[\s\S]*}/);
      
      if (jsonMatch) {
        const jsonString = jsonMatch[1] || jsonMatch[0];
        const evaluationResult = JSON.parse(jsonString);
        
        console.log("\n=== EVALUATION RESULTS (DETERMINED BY MODEL) ===");
        console.log(`Overall Score: ${evaluationResult.overallScore}/10`);
        console.log(`Qualifies for Bounty: ${evaluationResult.qualifiesForBounty ? 'YES' : 'NO'}`);
        console.log(`Summary: ${evaluationResult.summary}`);
        console.log("\nDetailed Feedback:");
        console.log(evaluationResult.detailedFeedback);
        console.log("=== END OF EVALUATION ===\n");
        
        // Lưu kết quả đánh giá vào file
        await fs.writeFile('evaluation_result.json', JSON.stringify(evaluationResult, null, 2));
        console.log("Evaluation results saved to evaluation_result.json");
        
        await writeToLog(`Evaluation completed: Score ${evaluationResult.overallScore}, Qualifies: ${evaluationResult.qualifiesForBounty}`);
        
        // Thêm log chi tiết nếu điểm > 7.0 và có submissionData
        if (evaluationResult.overallScore > 7.0 && submissionData && submissionData.walletAddress) {
          console.log("\n=== PARTICIPANT QUALIFICATION DETAILS ===");
          console.log(`Wallet Address: ${submissionData.walletAddress}`);
          console.log(`Score: ${evaluationResult.overallScore}`);
          console.log(`Bounty ID: ${submissionData.bountyId || 'Not specified'}`);
          console.log(`Qualification Status: QUALIFIED (Score > 7.0)`);
          console.log("=== END OF QUALIFICATION DETAILS ===\n");
          
          try {
            console.log(`\n>>> CALLING participateInBounty(${submissionData.walletAddress}, ${evaluationResult.overallScore}, ${submissionData.bountyId || 'Not specified'}) <<<\n`);
            
            // Thêm người tham gia vào bounty
            await participateInBounty(
              submissionData.walletAddress,
              evaluationResult.overallScore,
              submissionData.bountyId
            );
            
            console.log(`\n>>> SUCCESSFULLY ADDED PARTICIPANT <<<`);
            console.log(`- Wallet: ${submissionData.walletAddress}`);
            console.log(`- Score: ${evaluationResult.overallScore}`);
            console.log(`- Bounty: ${submissionData.bountyId}`);
            
            // Thêm thông tin tham gia vào kết quả
            evaluationResult.participationStatus = {
              success: true,
              message: "Participant added to bounty successfully",
              walletAddress: submissionData.walletAddress,
              score: evaluationResult.overallScore,
              bountyId: submissionData.bountyId
            };
          } catch (error) {
            console.error(`\n>>> ERROR ADDING PARTICIPANT <<<`);
            console.error(`- Wallet: ${submissionData.walletAddress}`);
            console.error(`- Score: ${evaluationResult.overallScore}`);
            console.error(`- Bounty: ${submissionData.bountyId}`);
            console.error(`- Error: ${error.message}`);
            
            // Thêm thông tin lỗi vào kết quả
            evaluationResult.participationStatus = {
              success: false,
              message: `Error: ${error.message}`,
              walletAddress: submissionData.walletAddress,
              score: evaluationResult.overallScore,
              bountyId: submissionData.bountyId
            };
          }
        }
        
        return evaluationResult;
      } else {
        console.log("Could not extract JSON from evaluation response. Raw response:");
        console.log(evaluationResponse);
        
        // Trả về kết quả dạng text nếu không parse được JSON
        const fallbackResult = {
          overallScore: 0,
          qualifiesForBounty: false,
          summary: "Could not parse evaluation result",
          detailedFeedback: evaluationResponse
        };
        
        await fs.writeFile('evaluation_result.txt', evaluationResponse);
        console.log("Raw evaluation response saved to evaluation_result.txt");
        
        await writeToLog("Could not parse evaluation result as JSON");
        
        return fallbackResult;
      }
    } catch (parseError) {
      console.error("Error parsing evaluation result:", parseError);
      await writeToLog(`Error parsing evaluation result: ${parseError.message}`);
      
      // Trả về kết quả dạng text nếu không parse được JSON
      const fallbackResult = {
        overallScore: 0,
        qualifiesForBounty: false,
        summary: "Error parsing evaluation result",
        detailedFeedback: evaluationResponse
      };
      
      await fs.writeFile('evaluation_result.txt', evaluationResponse);
      console.log("Raw evaluation response saved to evaluation_result.txt");
      
      return fallbackResult;
    }
  } catch (error) {
    console.error("Error during evaluation:", error);
    await writeToLog(`Error during evaluation: ${error.message}`);
    
    return {
      overallScore: 0,
      qualifiesForBounty: false,
      summary: "Evaluation process failed",
      detailedFeedback: `Error: ${error.message}`
    };
  }
}

// Hàm mới để xử lý việc đánh giá submission độc lập với việc tạo bounty
async function processSubmissionEvaluation(runtime: IAgentRuntime, bountyId: string): Promise<any> {
  try {
    console.log(`\n=== PROCESSING SUBMISSION EVALUATION FOR BOUNTY ID: ${bountyId} ===`);
    await writeToLog(`Processing submission evaluation for bounty ID: ${bountyId}`);
    
    // Kiểm tra xem bounty ID có tồn tại không
    const bountyExists = await checkBountyIdExists(bountyId);
    if (!bountyExists) {
      console.log(`Warning: Bounty ID "${bountyId}" does not exist in our records`);
      await writeToLog(`Warning: Bounty ID "${bountyId}" does not exist in our records`);
      // Vẫn tiếp tục vì có thể bounty được tạo ở nơi khác
    } else {
      console.log(`Bounty ID "${bountyId}" exists in our records`);
      await writeToLog(`Bounty ID "${bountyId}" exists in our records`);
    }
    
    // Lấy dữ liệu từ Pinata cho bounty này
    console.log(`\nFetching Pinata data for bounty ID: ${bountyId}`);
    await writeToLog(`Fetching Pinata data for bounty ID: ${bountyId}`);
    
    // Tìm hash Pinata từ bounty ID
    // Trong trường hợp thực tế, bạn có thể cần một cơ chế để map bounty ID với Pinata hash
    // Ở đây chúng ta giả định rằng bounty ID chính là hash hoặc có thể lấy từ một nguồn dữ liệu khác
    let pinataHash = bountyId;
    
    try {
      const pinataData = await fetchPinataData(pinataHash);
      console.log("Pinata data retrieved successfully!");
      
      // Lấy dữ liệu submission
      console.log("\nFetching submission data...");
      await writeToLog("Fetching submission data");
      
      const submissionData = await fetchSubmitData();
      
      // Kiểm tra xem submission có phải cho bounty này không
      if (submissionData.bountyId !== bountyId) {
        console.log(`Warning: Submission is for bounty ID "${submissionData.bountyId}", not for requested bounty ID "${bountyId}"`);
        await writeToLog(`Warning: Submission is for different bounty ID: ${submissionData.bountyId}`);
        // Vẫn tiếp tục vì chúng ta đang đánh giá submission này
      }
      
      // Kiểm tra dữ liệu trước khi đánh giá
      console.log("\n=== PRE-EVALUATION DATA CHECK ===");
      console.log(`All Posts Content Length: ${pinataData.allPostsContent ? pinataData.allPostsContent.length : 'N/A'} characters`);
      console.log(`Submission Data Length: ${submissionData.submission ? submissionData.submission.length : 'N/A'} characters`);
      console.log(`Number of Criteria: ${pinataData.criteria ? pinataData.criteria.length : 'N/A'}`);
      console.log("=== END OF PRE-EVALUATION DATA CHECK ===\n");
      
      // Kiểm tra xem có đủ dữ liệu để đánh giá không
      if (!pinataData.allPostsContent || !submissionData.submission || !pinataData.criteria) {
        console.log("Missing required data for evaluation:");
        if (!pinataData.allPostsContent) console.log("- Missing: allPostsContent");
        if (!submissionData.submission) console.log("- Missing: submission data");
        if (!pinataData.criteria) console.log("- Missing: criteria");
        
        await writeToLog("Missing required data for evaluation");
        
        return {
          success: false,
          message: "Missing required data for evaluation",
          bountyId,
          bountyExists,
          submissionData,
          pinataData: {
            bountyId: pinataData.bountyId || 'Not available',
            hasContent: !!pinataData.allPostsContent,
            hasCriteria: !!pinataData.criteria
          }
        };
      }
      
      // Thực hiện đánh giá
      console.log("\nStarting evaluation...");
      await writeToLog("Starting evaluation");
      
      const evaluationResult = await evaluateSubmission(
        runtime,
        pinataData.allPostsContent,
        submissionData.submission,
        pinataData.criteria,
        submissionData
      );
      
      // Kiểm tra điểm số và thêm người tham gia vào bounty nếu đủ điều kiện
      if (evaluationResult.overallScore > 7.0) {
        console.log(`\n=== SUBMISSION QUALIFIED FOR BOUNTY (Score: ${evaluationResult.overallScore}) ===`);
        console.log(`Adding participant to bounty: ${bountyId}`);
        await writeToLog(`Submission qualified for bounty with score ${evaluationResult.overallScore}`);
        
        try {
          // Kiểm tra xem có wallet address không
          if (!submissionData.walletAddress) {
            console.log("Warning: No wallet address found in submission data");
            await writeToLog("No wallet address found in submission data");
          } else {
            // Gọi hàm participateInBounty để thêm người tham gia
            console.log(`\n>>> CALLING participateInBounty WITH PARAMETERS <<<`);
            console.log(`- Wallet Address: ${submissionData.walletAddress}`);
            console.log(`- Score: ${evaluationResult.overallScore}`);
            console.log(`- Bounty ID: ${bountyId}`);
            
            await writeToLog(`Adding wallet ${submissionData.walletAddress} to bounty ${bountyId} with score ${evaluationResult.overallScore}`);
            
            // Gọi hàm participateInBounty mà không lưu kết quả trả về
            await participateInBounty(
              submissionData.walletAddress,
              evaluationResult.overallScore,
              bountyId
            );
            
            console.log(`\n>>> PARTICIPANT SUCCESSFULLY ADDED <<<`);
            console.log(`- Wallet: ${submissionData.walletAddress}`);
            console.log(`- Score: ${evaluationResult.overallScore}`);
            console.log(`- Bounty: ${bountyId}`);
            await writeToLog("Participant added successfully to bounty");
            
            // Thêm thông tin tham gia vào kết quả
            evaluationResult.participationStatus = {
              success: true,
              message: "Participant added to bounty successfully",
              walletAddress: submissionData.walletAddress,
              score: evaluationResult.overallScore,
              bountyId: bountyId
            };
          }
        } catch (participationError) {
          console.error(`\n>>> ERROR ADDING PARTICIPANT <<<`);
          console.error(`- Wallet: ${submissionData.walletAddress}`);
          console.error(`- Score: ${evaluationResult.overallScore}`);
          console.error(`- Bounty: ${bountyId}`);
          console.error(`- Error: ${participationError.message}`);
          
          await writeToLog(`Error adding participant to bounty: ${participationError.message}`);
          
          // Thêm thông tin lỗi vào kết quả
          evaluationResult.participationStatus = {
            success: false,
            message: `Error adding participant to bounty: ${participationError.message}`,
            walletAddress: submissionData.walletAddress,
            score: evaluationResult.overallScore,
            bountyId: bountyId
          };
        }
      } else {
        console.log(`\n=== SUBMISSION DID NOT QUALIFY FOR BOUNTY (Score: ${evaluationResult.overallScore}) ===`);
        console.log("Minimum required score is 7.0/10");
        await writeToLog(`Submission did not qualify for bounty with score ${evaluationResult.overallScore}`);
        
        // Thêm thông tin không đủ điều kiện vào kết quả
        evaluationResult.participationStatus = {
          success: false,
          message: "Score below qualification threshold (7.0/10)",
          score: evaluationResult.overallScore,
          bountyId: bountyId
        };
      }
      
      // Tạo kết quả tổng hợp
      const result = {
        success: true,
        bountyId,
        bountyExists,
        submissionData,
        pinataData: {
          bountyId: pinataData.bountyId || 'Not available',
          criteria: pinataData.criteria || []
        },
        evaluationResult
      };
      
      // Lưu kết quả tổng hợp
      await fs.writeFile(`evaluation_result_${bountyId}.json`, JSON.stringify(result, null, 2));
      console.log(`Evaluation results saved to evaluation_result_${bountyId}.json`);
      
      console.log("\n=== EVALUATION SUMMARY ===");
      console.log(`Bounty ID: ${bountyId}`);
      console.log(`Submission by: ${submissionData.author || 'Unknown'}`);
      console.log(`Overall Score: ${evaluationResult.overallScore}/10`);
      console.log(`Qualifies for Bounty: ${evaluationResult.qualifiesForBounty ? 'YES' : 'NO'}`);
      console.log(`Added to Bounty: ${evaluationResult.participationStatus?.success ? 'YES' : 'NO'}`);
      console.log(`Summary: ${evaluationResult.summary}`);
      console.log("=== END OF EVALUATION SUMMARY ===\n");
      
      return result;
      
    } catch (error) {
      console.error(`Error processing submission evaluation: ${error.message}`);
      await writeToLog(`Error processing submission evaluation: ${error.message}`);
      
      return {
        success: false,
        message: `Error: ${error.message}`,
        bountyId,
        bountyExists
      };
    }
  } catch (error) {
    console.error(`Error in processSubmissionEvaluation: ${error.message}`);
    await writeToLog(`Error in processSubmissionEvaluation: ${error.message}`);
    
    return {
      success: false,
      message: `Error: ${error.message}`,
      bountyId
    };
  }
}

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
                
                // Xử lý đánh giá
                const evaluationResult = await processSubmissionEvaluation(runtime, bountyId);
                
                // Gửi kết quả
                await writeToLog("Sending evaluation results to callback");
                callback?.({
                    text: `Evaluation completed for bounty ID: ${bountyId}`,
                    action: CreateBountyAction.CREATE_BOUNTY,
                    params: {
                        label: `Submission evaluation for bounty: ${bountyId}`,
                        evaluationResult: evaluationResult
                    }
                });
                
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
                
                // Create bounty pools from all posts
                await writeToLog("Creating bounty pools from all posts...");
                const bountyResult = await createBountyPools(runtime, rankedPosts, criteria);
                await writeToLog(`Created bounty with ID: ${bountyResult?.bountyId || 'unknown'}`);
                
                // Get top posts for response generation (keeping this part for backward compatibility)
                const topPosts = rankedPosts.slice(0, 3);
                await writeToLog(`Selected top ${topPosts.length} posts for response generation`);

                // Generate response
                await writeToLog("Generating text response...");
                const context = topPosts.map(post => post.text).join('\n\n');
                const response = await generateText({
                    runtime,
                    context: analyzePostPrompt(message.content.text, context),
                    modelClass: ModelClass.SMALL,
                    stop: ["\n"],
                });
                await writeToLog("Completed text response generation");

                // Send response with bounty results
                await writeToLog("Sending response to callback...");
                callback?.({
                    text: response.trim(),
                    action: CreateBountyAction.CREATE_BOUNTY,
                    params: {
                        label: response.trim(),
                        relevantPosts: topPosts.map(post => ({
                            authorFullname: post.authorFullname,
                            text: post.text,
                            similarity: post.similarity
                        })),
                        bountyResult: bountyResult,
                        pinataHash: bountyResult?.pinataHash,
                        pinataData: bountyResult?.verifiedPinataData || null,
                        submissionData: bountyResult?.submissionData || null,
                        evaluationResult: bountyResult?.evaluationResult || null,
                        criteria: criteria && criteria.length > 0 ? criteria : ["No specific criteria provided"]
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