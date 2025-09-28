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

        // Define different API endpoints and models to try
        const attempts = [
            {
                url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`,
                config: {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, topK: 1, topP: 1, maxOutputTokens: 2048 }
                }
            },
            {
                url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${GEMINI_API_KEY}`,
                config: {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, topK: 1, topP: 1, maxOutputTokens: 2048 }
                }
            },
            {
                url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${GEMINI_API_KEY}`,
                config: {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
                }
            },
            {
                url: `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash-latest:generateContent?key=${GEMINI_API_KEY}`,
                config: {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 }
                }
            }
        ];

        let lastError = null;

        // Try each configuration
        for (const attempt of attempts) {
            try {
                console.log(`Trying: ${attempt.url.split('?')[0]}`);
                
                const response = await fetch(attempt.url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(attempt.config),
                });

                if (response.ok) {
                    const data = await response.json();
                    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
                    
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
                        // Try to extract JSON from the response
                        const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
                        if (jsonMatch) {
                            result = JSON.parse(jsonMatch[0]);
                        } else {
                            throw parseError;
                        }
                    }

                    console.log('Successfully generated summary with model:', attempt.url.split('/models/')[1].split(':')[0]);
                    return new Response(JSON.stringify(result), {
                        headers: {
                            'Content-Type': 'application/json',
                            'Access-Control-Allow-Origin': '*',
                        },
                    });
                } else {
                    const errorData = await response.text();
                    lastError = `${response.status} - ${errorData}`;
                    console.error(`Failed attempt: ${lastError}`);
                }
            } catch (error) {
                lastError = (error as Error).message;
                console.error(`Error with attempt: ${lastError}`);
                continue;
            }
        }

        // If all attempts failed, throw the last error
        throw new Error(`All Gemini API attempts failed. Last error: ${lastError}`);

    } catch (error) {
        console.error('Analysis error:', error);
        
        // Return a basic fallback structure so the app doesn't completely break
        const fallbackResult = {
            overview: "Unable to generate AI summary due to API issues. Transcription was successful.",
            keyDecisions: [],
            actionItems: [],
            keyTopics: ["Audio transcription completed"],
            nextSteps: ["Review transcription manually"]
        };
        
        // Return 200 with fallback data instead of 500 error
        return new Response(JSON.stringify(fallbackResult), {
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    }
}