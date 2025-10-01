export const config = {
  runtime: 'edge',
};

interface Utterance {
  speaker: number;
  transcript: string;
  start: number;
  end: number;
  confidence: number;
}

interface Segment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  confidence: number;
}

// Vercel's handler takes a Request and returns a Response
export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      throw new Error('No audio file provided');
    }

    const audioBuffer = await audioFile.arrayBuffer();

    const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
    const GROQ_API_KEY = process.env.GROQ_API_KEY; // Add this env var for Groq integration
    if (!DEEPGRAM_API_KEY) {
        throw new Error('DEEPGRAM_API_KEY is not configured');
    }
    if (!GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is not configured');
    }

    const deepgramResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&diarize=true&utterances=true&language=en&multichannel=false&numerals=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': audioFile.type || 'audio/webm',
      },
      body: audioBuffer,
    });

    if (!deepgramResponse.ok) {
        const errorText = await deepgramResponse.text();
        throw new Error(`Deepgram API error: ${deepgramResponse.status} - ${errorText}`);
    }

    const deepgramResult = await deepgramResponse.json();
    const utterances: Utterance[] = deepgramResult.results?.utterances || [];

    let segments: Segment[] = [];
    const speakerMap = new Map<number, string>();

    if (utterances.length > 0) {
        // First, try advanced speaker identification using Groq LLM
        const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))];
        if (uniqueSpeakers.length > 1) { // Only if multiple speakers
            const formattedUtterances = utterances
                .map((u, idx) => `Utterance ${idx + 1} (Speaker ${u.speaker}, ${formatTimestamp(u.start)} - ${formatTimestamp(u.end)}): ${u.transcript}`)
                .join('\n\n');

            const groqPrompt = `You are an expert at identifying speakers in meeting transcripts. Analyze the following utterances, each labeled with a speaker ID (e.g., Speaker 0, Speaker 1). 

Infer the real names of each speaker based on context, such as self-introductions (e.g., "Hi, I'm Alice"), references (e.g., "Thanks, Bob"), or consistent topics/roles. 

- Use only the provided transcript; do not assume external knowledge.
- If a speaker's name is unclear, label them as "Speaker [ID]" (e.g., "Speaker 1").
- Output ONLY a valid JSON object mapping speaker IDs to names, like: {"0": "Alice", "1": "Bob", "2": "Speaker 2"}.
- Be conservative: only assign a name if confidence is high (e.g., direct mention).

Transcript:
${formattedUtterances}

Speaker mapping:`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.1-8b-instant', // Fast and free-tier friendly model;
                    messages: [
                        { role: 'system', content: 'You are a helpful assistant for transcript analysis.' },
                        { role: 'user', content: groqPrompt }
                    ],
                    temperature: 0.1, // Low temperature for consistent, factual output
                    max_tokens: 200,
                }),
            });

            if (groqResponse.ok) {
                const groqResult = await groqResponse.json();
                const groqContent = groqResult.choices?.[0]?.message?.content || '';
                try {
                    // Extract JSON from response (handle if it's wrapped in text)
                    const jsonMatch = groqContent.match(/\{.*\}/s);
                    if (jsonMatch) {
                        const parsedMap = JSON.parse(jsonMatch[0]);
                        Object.entries(parsedMap).forEach(([key, value]) => {
                            const speakerId = parseInt(key as string, 10);
                            if (!isNaN(speakerId) && typeof value === 'string') {
                                speakerMap.set(speakerId, value);
                            }
                        });
                    }
                } catch (parseError) {
                    console.error('Failed to parse Groq response:', parseError);
                    // Fall back to regex method if parsing fails
                }
            } else {
                console.error('Groq API error:', groqResponse.status);
                // Fall back to regex method
            }
        }

        // Fallback to original regex-based extraction if Groq didn't assign all speakers or failed
        const extractSpeakerName = (text: string): string | null => {
            const lowerText = text.toLowerCase();
            const commonWords = new Set(['there', 'good', 'nice', 'thank', 'thanks', 'yes', 'okay', 'well', 'the', 'a', 'is', 'in', 'it', 'of', 'for', 'on', 'with', 'at', 'by', 'from', 'as']);
            const namePatterns = [
              /(?:my name is|i'm|i am|this is|call me)\s+([a-z]{2,15})/i,
              /(?:hi|hello),?\s+([a-z]{2,15})/i,
              /^([a-z]{2,15}),?\s+(?:here|speaking)/i,
              /^(?:it's|it is)\s+([a-z]{2,15})/i,
              /([a-z]{2,15})\s+is my name/i
            ];
            for (const pattern of namePatterns) {
              const match = text.match(pattern);
              if (match && match[1]) {
                const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                if (!commonWords.has(name.toLowerCase())) {
                  return name;
                }
              }
            }
            return null;
        };

        // Apply fallback for unmapped speakers
        utterances.forEach((utterance) => {
            if (!speakerMap.has(utterance.speaker)) {
                const name = extractSpeakerName(utterance.transcript);
                if (name && utterance.confidence >= 0.95 && !Array.from(speakerMap.values()).includes(name)) {
                    speakerMap.set(utterance.speaker, name);
                }
            }
        });

        // Default to "Speaker X" if still unknown
        uniqueSpeakers.forEach(speakerId => {
            if (!speakerMap.has(speakerId)) {
                speakerMap.set(speakerId, `Speaker ${speakerId}`);
            }
        });

        segments = utterances.map((utterance, index) => ({
            id: `segment_${index}`,
            speaker: speakerMap.get(utterance.speaker) || `Speaker ${utterance.speaker}`,
            text: utterance.transcript.trim(),
            timestamp: `${formatTimestamp(utterance.start)} - ${formatTimestamp(utterance.end)}`,
            confidence: utterance.confidence || 0.9,
        }));
    }

    const fullText = deepgramResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    return new Response(
      JSON.stringify({ transcription: segments, fullText: fullText }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
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

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}