import { getFromPinata } from '../services/pinata';
import * as fs from 'fs/promises';

// Function to fetch data from Pinata using a provided hash
export async function fetchPinataData() {
  try {
    const pinataHash = "QmWSCo3nbstRD97wSdjJx6Nt2saBRMEQKfeeYFDWpgabpg";
    
    console.log(`Fetching data for pinataHash: ${pinataHash}`);
    
    // Call the getFromPinata function with the provided hash
    const result = await getFromPinata(pinataHash);
    
    if (result.success) {
      console.log("Data retrieved successfully from Pinata");
      
      // Extract only needed fields
      const submissionData = {
        author: result.data.author,
        bountyId: result.data.bountyId,
        submission: result.data.submission,
        walletAddress: result.data.walletAddress,
        uploadTime: result.data.uploadTime
      };

      console.log("--- Retrieved Data ---");
      console.log(JSON.stringify(submissionData, null, 2));

      // Save data to file for reference
      await fs.writeFile('submission_data.json', JSON.stringify(submissionData, null, 2));
      console.log("Data saved to submission_data.json");

      return submissionData;
    } else {
      console.error("Failed to retrieve data:", result.message);
      throw new Error(result.message);
    }
  } catch (error) {
    console.error("Error retrieving Pinata data:", error);
    throw error;
  }
}

// Run the function if this file is executed directly
// ES Module version of the CommonJS check
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  console.log("Starting data retrieval...");
  fetchPinataData()
    .then(() => console.log("Data retrieval completed successfully"))
    .catch(err => console.error("Data retrieval failed:", err));
}
