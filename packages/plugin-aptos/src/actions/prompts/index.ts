export const labelDataPrompt = (textContent: string) => {
    return `
        You are an AI model specialized in analyzing and categorizing social media posts. Your task is to read the content of user message and assign the most appropriate category based on its meaning and context.

Ensure that:

Always select the most suitable category. If the content fits into multiple categories, choose the most relevant one.
If the post does not match any predefined category, create a new, concise, and meaningful category based on the post's topic.
Do not modify the content of the post. Only add the "category" and "color" fields.
Return the result in plain JSON format, without any surrounding backticks or code block formatting.
Categorization Guidelines:

- If the post contains news or updates → "News/Update" (Color: #2196F3)
- If the post is related to hackathons, competitions, or winner announcements → "Hackathon Update" (Color: #FF9800)
- If the post announces an event, conference, or invitation to join → "Event Announcement" (Color: #9C27B0)
- If the post analyzes the crypto market, financial indicators → "Crypto Market Analysis" (Color: #F44336)
- If the post mentions collaborations, partnerships, or alliances → "Collaboration Announcement" (Color: #FFEB3B)
- If the post is a personal story, reflection, or life lesson → "Personal Reflection" (Color: #795548)
- If the post is a proposal or introduction of a new project → "Proposal/Project Introduction" (Color: #607D8B)
- If the post contains motivational content, encouragement, or inspiration → "Motivational Post" (Color: #E91E63)
- If the post contains errors or is unavailable → "Error/Unavailable" (Color: #9E9E9E)
- If the post is meant to connect with the community, discussions, or engagement → "Community Engagement" (Color: #3F51B5)
- If the post relates to blockchain development, new technologies → "Blockchain Development" (Color: #00BCD4)
- If the post provides financial advice, investment tips → "Financial Advice" (Color: #FF5722)
- If the post contains educational content, learning resources, or tutorials → "Educational Content" (Color: #8BC34A)
- If the post does not fit into any of the above categories, create a new category based on its content and meaning.

Input data:
text: "${textContent}"
Output:
{
  "post": "After seeing these humanoid robot demos, I bet you'll be convinced that all manual labor will be gone to robots.\n\n(even the world's oldest profession will be taken by them).\n\nAll 26 humanoid robot demos:",
  "category": "Technology Discussion",
  "color": "#4CAF50" // Example color for the category
}
    `;
}



export const analyzePostPrompt = (textContent: string, datapost: string) => {
    return `
        Based on the question: "${textContent}"
        Analyze these relevant data posts: "${datapost}"

        Provide a focused analysis in the following format:

        ### 1. Direct Query Response
        - Provide the most direct and relevant answer to the query
        - Include only facts that are directly related to the main query
        - Note the confidence level of the information (High/Medium/Low)
        - Keep this section focused on core facts only

        ### 2. Key Information
        - **Core Details**:
          List only verified details directly related to the query (dates, numbers, requirements)
        - **Key Stakeholders**:
          List only organizations/entities directly involved

        ### 3. Additional Context & Insights
        - Note any missing but important information
        - List only directly related action items
        - Do not include speculative information
        - Do not mix information from unrelated events

        Important Guidelines:
        - Bold all dates, numbers, and deadlines using **text**
        - Keep each bullet point focused on a single piece of information
        - Maintain clear separation between sections with line breaks
        - Only include information that is directly related to the query
        - Exclude information from similar but different events
        - If information seems related but you're not sure, mention it in a 'Note:' at the end
    `;
}

export const evaluateSubmissionPrompt = (allPostsContent: string, submitData: string, criteria: string) => {
    return `
# Prompt cho hệ thống đánh giá tự động dữ liệu submit

## Nhiệm vụ
Hãy phân tích và đánh giá dữ liệu được submit dựa trên các tiêu chí được cung cấp để xác định liệu submission có đủ điều kiện nhận bounty hay không.

## Input
- **allPostsContent**: Tập hợp tất cả các bài đăng/nội dung hiện có trong hệ thống để so sánh và tham chiếu
- **submitData**: Dữ liệu được người dùng submit cần được đánh giá
- **criteria**: Danh sách các tiêu chí đánh giá cùng với trọng số cho mỗi tiêu chí

## Yêu cầu chức năng
1. **Phân tích chi tiết**:
   - So sánh submitData với allPostsContent để đánh giá tính độc đáo
   - Đánh giá mức độ đáp ứng mỗi tiêu chí trong criteria
   - Phát hiện bất kỳ vấn đề nào về chất lượng dữ liệu hoặc việc không tuân thủ tiêu chí

2. **Tính điểm**:
   - Tính điểm cho từng tiêu chí riêng lẻ (thang điểm 0-10)
   - Tính điểm tổng hợp có trọng số dựa trên tầm quan trọng của từng tiêu chí
   - Xác định ngưỡng điểm cần thiết để đủ điều kiện nhận bounty
   - Nếu submission hoàn toàn không liên quan đến criteria, điểm tổng hợp phải dưới 3/10
   - Nếu submission chỉ là một câu ngắn không có nội dung kỹ thuật, điểm tổng hợp phải dưới 2/10

3. **Phản hồi chi tiết**:
   - Cung cấp nhận xét cụ thể cho từng tiêu chí
   - Nêu rõ điểm mạnh và điểm yếu của dữ liệu được submit
   - Đề xuất cải tiến cụ thể (nếu cần)

4. **Đánh giá cuối cùng**:
   - Kết luận rõ ràng về việc submission có đủ điều kiện nhận bounty hay không
   - Đưa ra lý do cụ thể cho quyết định
   - Submission chỉ đủ điều kiện nhận bounty khi điểm tổng hợp từ 7/10 trở lên

## Hướng dẫn chấm điểm nghiêm ngặt
- Nếu submission không có code khi criteria yêu cầu code: tối đa 2/10 điểm
- Nếu submission không có hướng dẫn khi criteria yêu cầu hướng dẫn: tối đa 3/10 điểm
- Nếu submission chỉ là một câu kêu gọi hoặc thông báo: tối đa 1/10 điểm
- Nếu submission không đề cập đến bất kỳ tiêu chí nào trong criteria: tối đa 0/10 điểm
- Nếu submission không liên quan đến chủ đề của bounty: 0/10 điểm

## Output mong muốn
Hãy trả về một báo cáo đánh giá được cấu trúc theo format sau:

\`\`\`json
{
  "overallScore": number,
  "qualifiesForBounty": boolean,
  "summary": "string",
  "detailedFeedback": "string"
}
\`\`\`

## Dữ liệu đánh giá
allPostsContent: ${allPostsContent}

submitData: ${submitData}

criteria: ${criteria}
    `;
}

export const quizGenPrompt = (textContent: string) => {
    return `
        Generate 4 multiple-choice questions based on this text:
        "${textContent}"

        Requirements:
        Always generate exactly 4 questions based on the key knowledge from the content.
        Each question should be clear, relevant, and meaningful.
        Ensure that each question tests different aspects of the content, avoiding redundancy.
        Each question must have 4 answer choices, labeled A, B, C, and D, using keywords.
        Only one answer should be correct, while the other options should be plausible but incorrect.
        MUST HAVE SHORT ANSWER OPTIONS.
        Format the output as follows:
        Example Output:
        Question 1: [Question text]
        A. [First option]
        B. [Second option]
        C. [Third option]
        D. [Fourth option]
        Correct Answer: [Letter of correct answer]

        Question 2: [Question text]
        A. [First option]
        B. [Second option]
        C. [Third option]
        D. [Fourth option]
        Correct Answer: [Letter of correct answer]

        Question 3: [Question text]
        A. [First option]
        B. [Second option]
        C. [Third option]
        D. [Fourth option]
        Correct Answer: [Letter of correct answer]

        Question 4: [Question text]
        A. [First option]
        B. [Second option]
        C. [Third option]
        D. [Fourth option]
        Correct Answer: [Letter of correct answer]
    `;
}


export const generateBountyPrompt = (textContent: string, datapost: string) => {
    return `
        # Prompt: Analyze User Query and Generate Project Details
Based on the question: "${textContent}"
Using data posts as knowledge: "${datapost}"

Parse the provided user query related to technical projects, then generate:
1. A concise, professional title that describes the project goal (NOT the user's request)
2. A clear, concise project description (2-4 sentences)
3. A bullet point list of key requirements (4-8 points)

All sections should be presented professionally in a compact format that's easy to scan and understand.

## Processing Workflow:
1. Carefully read the user query
2. Identify the core project purpose and technologies
3. Create a professional title that describes what needs to be built/done (NOT "Create Bounty for...")
4. Determine the most essential requirements
5. Create a brief but comprehensive description
6. List only the most important requirements as bullet points

## Example User Query and Response:
Query: "create bounty for developing a smart contract on Aptos"

**Title**
Aptos Smart Contract Development Project

**Description**
[Brief project overview in 2-4 sentences]

**Requirements**
[List of key requirements, maximum 5 points]
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]
- [Requirement 4]

**Tags**
[Provide 2-4 relevant technical tags, separated by commas.]

## Expected Output Format:

**Title**
[Create a professional project title - DO NOT start with "Create Bounty for"]

**Description**
[Brief project overview in 2-4 sentences]

**Requirements**
[List of key requirements, maximum 5 points]
- [Requirement 1]
- [Requirement 2]
- [Requirement 3]
- [Requirement 4]

**Tags**
[Provide 2-4 relevant technical tags, separated by commas.]
    `;
}

export const getAllPostsPrompt = (textContent: string, datapost: string) => {
    return `
        Based on the request: "${textContent}"
        Format these posts into a clear table structure: "${datapost}"

        Create a well-organized table with the following format:

        ### Posts Overview Table

        | No. | Author | Post Content 
        |-----|---------|-------------|
        [Insert rows here with post data]

        Formatting Rules:
        1. Number each post sequentially
        2. Truncate long post content to first 100 characters and add "..." if needed
        3. Maximum 20 posts per page
    `;
}

