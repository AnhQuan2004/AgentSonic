import { fetchPinataData as fetchPinataDataWithHash } from './get_pinata_data';
import { fetchPinataData as fetchSubmitData } from './get_submit_data';
import * as fs from 'fs/promises';

/**
 * Verifies and compares data from both Pinata sources
 * @param pinataHash Optional hash to fetch specific data
 */
export async function checkAndVerify(pinataHash?: string) {
  try {
    console.log("=== STARTING VERIFICATION PROCESS ===");
    
    // Get data from both sources
    console.log("\n[1] Fetching submission data (hardcoded hash)...");
    const submitData = await fetchSubmitData();
    
    console.log("\n[2] Fetching pinata data with provided hash...");
    // If no hash provided, use the one from submitData if available
    const hashToUse = pinataHash || (submitData.bountyId ? submitData.bountyId : null);
    
    if (!hashToUse) {
      throw new Error("No pinata hash provided and none found in submission data");
    }
    
    const pinataData = await fetchPinataDataWithHash(hashToUse);
    
    // Compare the data
    console.log("\n=== VERIFICATION RESULTS ===");
    console.log("Submission Data:");
    console.log(JSON.stringify(submitData, null, 2));
    
    console.log("\nPinata Data (key fields):");
    const pinataKeyData = {
      bountyId: pinataData.bountyId || 'Not available',
      criteria: pinataData.criteria || 'Not available',
      contentSummary: pinataData.allPostsContent ? 
        `${pinataData.allPostsContent.substring(0, 100)}...` : 
        'Not available'
    };
    console.log(JSON.stringify(pinataKeyData, null, 2));
    
    // Check for matching fields
    console.log("\nField Comparison:");
    if (submitData.bountyId && pinataData.bountyId) {
      console.log(`Bounty ID Match: ${submitData.bountyId === pinataData.bountyId ? 'YES' : 'NO'}`);
    }
    
    if (submitData.author && pinataData.author) {
      console.log(`Author Match: ${submitData.author === pinataData.author ? 'YES' : 'NO'}`);
    }
    
    // Save combined results to file
    const combinedResults = {
      timestamp: new Date().toISOString(),
      submitData,
      pinataData: pinataKeyData,
      fullPinataData: pinataData
    };
    
    await fs.writeFile('verification_results.json', JSON.stringify(combinedResults, null, 2));
    console.log("\nVerification results saved to verification_results.json");
    
    return combinedResults;
  } catch (error) {
    console.error("Verification process failed:", error);
    throw error;
  }
}

// Run the function if this file is executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  // Get hash from command line if provided
  const providedHash = process.argv[2];
  
  console.log("Starting verification process...");
  console.log(providedHash ? `Using provided hash: ${providedHash}` : "No hash provided, will use default");
  
  checkAndVerify(providedHash)
    .then(() => console.log("Verification completed successfully"))
    .catch(err => console.error("Verification failed:", err));
}
