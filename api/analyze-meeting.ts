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

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY is not configured');
        }

        const prompt = `
Analyze this meeting transcript and provide a comprehensive summary in JSON format with the following structure:
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
Meeting transcript:
${text}
Please respond with only the JSON object, no additional text.`;

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, topK: 1, topP: 1, maxOutputTokens: 2048 },
                }),
            }
        );

        if (!response.ok) {
            const errorData = await response.text();
            throw new Error(`Gemini API error: ${response.status} - ${errorData}`);
        }

        const data = await response.json();
        const generatedText = data.candidates[0].content.parts[0].text;
        const cleanedText = generatedText.replace(/```json\n?|\n?```/g, '').trim();
        const result = JSON.parse(cleanedText);

        return new Response(JSON.stringify(result), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });

    } catch (error) {
        return new Response(
            JSON.stringify({ error: (error as Error).message }),
            {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                },
            }
        );
    }
}