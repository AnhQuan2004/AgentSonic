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
