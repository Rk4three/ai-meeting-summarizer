import Groq from "groq-sdk";

export const config = {
    runtime: 'edge',
};

export default async function handler(req: Request) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
            },
        });
    }

    try {
        const { text } = await req.json();

        if (!text) {
            throw new Error('Text is required');
        }

        const groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        });

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

        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            model: "llama3-8b-8192",
            temperature: 0.2,
            max_tokens: 2048,
            top_p: 1,
            stream: false,
            response_format: { type: "json_object" },
        });

        const generatedText = completion.choices[0]?.message?.content;

        if (!generatedText) {
            throw new Error('No text generated in response');
        }

        const result = JSON.parse(generatedText);

        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });


    } catch (error) {
        console.error('Analysis error:', error);
        
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