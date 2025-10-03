// Import the Groq SDK to interact with the Groq API.
import Groq from "groq-sdk";

// Configure the runtime environment for this function to be 'edge', which is ideal for performance.
export const config = {
    runtime: 'edge',
};

// This is the main function that handles incoming requests.
export default async function handler(req: Request) {
    // Handle preflight CORS requests for browser compatibility.
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            },
        });
    }

    try {
        // Parse the incoming request body to get the meeting transcript text.
        const { text } = await req.json();

        // If no text is provided, throw an error.
        if (!text) {
            throw new Error('Text is required');
        }

        // Initialize the Groq client with the API key from environment variables.
        const groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });

        // This is the prompt that instructs the AI on how to analyze the transcript and what format to return.
        const prompt = `
Analyze this meeting transcript and provide a comprehensive summary in JSON format with the following structure:

IMPORTANT: Look carefully for decisions, agreements, conclusions, or resolutions made during the conversation. Even informal agreements or choices should be considered decisions.

{
  "overview": "Brief overview of the meeting/conversation",
  "keyDecisions": ["Any decisions made, agreements reached, conclusions drawn, or choices finalized"],
  "actionItems": [
    {
      "id": "unique_id",
      "task": "specific action item or task mentioned",
      "assignee": "person assigned (if mentioned, otherwise null)",
      "dueDate": "due date (if mentioned, otherwise null)",
      "priority": "high|medium|low"
    }
  ],
  "keyTopics": ["main topics, subjects, or themes discussed"],
  "nextSteps": ["future actions, follow-ups, or next meetings mentioned"]
}

Guidelines:
- If no explicit decisions were made, look for implicit agreements, understandings, or resolutions
- Include any commitments, promises, or agreed-upon outcomes as decisions
- Action items should include any tasks, to-dos, or responsibilities mentioned
- Be thorough but accurate - don't invent information not present in the transcript

Meeting transcript:
${text}
        `;

        // Send the request to the Groq API to get the AI-generated summary.
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            model: "llama-3.1-8b-instant", // Using a fast and efficient model.
            temperature: 0.2, // Low temperature for more deterministic and focused output.
            max_tokens: 2048,
            top_p: 1,
            stream: false,
            response_format: { type: "json_object" }, // Ensure the output is a JSON object.
        });

        // Extract the generated text content from the API response.
        const generatedText = completion.choices[0]?.message?.content;

        if (!generatedText) {
            throw new Error('No text generated in response');
        }

        // Parse the generated text into a JSON object.
        const result = JSON.parse(generatedText);

        // Return the summary as a JSON response.
        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });


    } catch (error) {
        console.error('Analysis error:', error);
        
        // If anything goes wrong, return a fallback summary to the user.
        const fallbackResult = {
            overview: "Unable to generate AI summary due to API issues. Transcription was successful.",
            keyDecisions: [],
            actionItems: [],
            keyTopics: ["Audio transcription completed"],
            nextSteps: ["Review transcription manually"]
        };
        
        return new Response(JSON.stringify(fallbackResult), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
}