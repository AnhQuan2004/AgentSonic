import { getFromPinata } from '../services/pinata';
import * as fs from 'fs/promises';

// Function to fetch data from Pinata using a provided hash
export async function fetchPinataData(pinataHash: string) {
  try {
    if (!pinataHash) {
      throw new Error("No pinataHash provided");
    }
    
    console.log(`Fetching data for pinataHash: ${pinataHash}`);
    
    // Call the getFromPinata function with the provided hash
    const result = await getFromPinata(pinataHash);
    
    if (result.success) {
      console.log("Data retrieved successfully from Pinata");
      
      // Print detailed information about the retrieved data
      console.log("=== PINATA DATA DETAILS ===");
      console.log(`IPFS Hash: ${pinataHash}`);
      
      // Print bounty ID if available
      if (result.data.bountyId) {
        console.log(`Bounty ID: ${result.data.bountyId}`);
      }
      
      // Print criteria if available
      if (result.data.criteria && Array.isArray(result.data.criteria)) {
        console.log("Criteria:");
        result.data.criteria.forEach((criterion, index) => {
          console.log(`  ${index + 1}. ${criterion}`);
        });
      } else {
        console.log("Criteria: None or not in expected format");
      }
      
      // Print content summary
      if (result.data.allPostsContent) {
        const contentLength = result.data.allPostsContent.length;
        console.log(`Content Length: ${contentLength} characters`);
        console.log(`Content Preview: ${result.data.allPostsContent.substring(0, 200)}...`);
        
        // Count number of authors in the content
        const authorMatches = result.data.allPostsContent.match(/Author: /g);
        const authorCount = authorMatches ? authorMatches.length : 0;
        console.log(`Number of Authors: ${authorCount}`);
      }
      
      // Print all keys in the data object
      console.log("All data keys:", Object.keys(result.data));
      
      // Print full data structure (for debugging)
      console.log("Full data structure:");
      console.log(JSON.stringify(result.data, null, 2));
      console.log("=== END OF PINATA DATA ===");
      
      // Write result to file for debugging (optional)
      await fs.writeFile(`pinata_data_${pinataHash}.json`, JSON.stringify(result.data, null, 2));
      return result.data;
    } else {
      console.error("Failed to retrieve data:", result.message);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error("Error retrieving Pinata data:", error);
    throw error;
  }
}
