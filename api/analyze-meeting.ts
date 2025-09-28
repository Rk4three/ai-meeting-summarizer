import OpenAI from 'openai';

export const config = {
    runtime: 'edge',
};

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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

        const prompt = `Analyze this meeting transcript and provide a comprehensive summary in JSON format with the following structure:

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

Please respond with only the JSON object, no additional text.`;

        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ "role": "user", "content": prompt }],
            temperature: 0.1,
            max_tokens: 2048,
        });

        const generatedText = response.choices[0]?.message?.content;

        if (!generatedText) {
            throw new Error('No text generated in response');
        }

        const cleanedText = generatedText.replace(/```json\n?|\n?```/g, '').trim();

        let result;
        try {
            result = JSON.parse(cleanedText);
        } catch (parseError) {
            console.error('JSON Parse Error:', parseError);
            console.error('Generated Text:', generatedText);
            const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                result = JSON.parse(jsonMatch[0]);
            } else {
                throw parseError;
            }
        }

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