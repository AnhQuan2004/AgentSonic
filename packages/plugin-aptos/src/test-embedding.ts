import { Pinecone } from '@pinecone-database/pinecone';

async function testPineconeEmbedding() {
    try {
        console.log("Initializing Pinecone...");
        const pc = new Pinecone({
            apiKey: 'pcsk_61ZrSy_E2UrLsFEBWC2BftrN71Bc1pLiFB3CJChqD9yUkzD3NGXq3BWDZcKLJM5wXezYQL',
            environment: 'aped-4627-b74a'
        });

        // Get the index
        const index = pc.index('multilingual-e5-large');

        // Sample data with text content
        const data = [
            {id: "vec1", text: "Apple is a popular fruit known for its sweetness and crisp texture."},
            {id: "vec2", text: "The tech company Apple is known for its innovative products like the iPhone."},
            {id: "vec3", text: "Many people enjoy eating apples as a healthy snack."},
            {id: "vec4", text: "Apple Inc. has revolutionized the tech industry with its sleek designs and user-friendly interfaces."},
            {id: "vec5", text: "An apple a day keeps the doctor away, as the saying goes."},
        ];

        // For testing, create vectors with correct dimension (1024 as shown in your dashboard)
        console.log("Preparing vectors for upsert...");
        const records = data.map((d, i) => ({
            id: d.id,
            values: Array(1024).fill(0.1), // Creating 1024-dimensional vectors
            metadata: { text: d.text }
        }));

        console.log("Upserting records to Pinecone namespace 'ns1'...");
        await index.namespace('ns1').upsert(records);

        console.log("Successfully uploaded records!");
        console.log(`Number of records uploaded: ${records.length}`);

        // Test query
        console.log("\nTesting query...");
        const queryResponse = await index.namespace('ns1').query({
            topK: 2,
            vector: Array(1024).fill(0.1), // Query vector must also be 1024-dimensional
            includeValues: true,
            includeMetadata: true
        });

        console.log("Query results:", queryResponse);

    } catch (error) {
        console.error("Error during Pinecone operations:", error);
    }
}

testPineconeEmbedding(); 