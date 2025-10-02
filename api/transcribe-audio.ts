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
        // Remap speaker IDs to start from 1
        const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))].sort((a, b) => a - b);
        const speakerRemap = new Map<number, number>();
        uniqueSpeakers.forEach((id, index) => {
            speakerRemap.set(id, index + 1);
        });

        // First, try advanced speaker identification using Groq LLM
        if (uniqueSpeakers.length > 1) { // Only if multiple speakers
            const formattedUtterances = utterances
                .map((u, idx) => `Utterance ${idx + 1} (Speaker ${u.speaker}, ${formatTimestamp(u.start)} - ${formatTimestamp(u.end)}): ${u.transcript}`)
                .join('\n\n');

            const groqPrompt = `You are an expert at identifying speakers in meeting transcripts. Analyze the following utterances from a diarized transcript, where each is labeled with a numeric speaker ID (e.g., Speaker 0, Speaker 1) based on voice differences.

Infer the real names of each speaker based on the entire conversation context:
- Self-introductions (e.g., "Hi, I'm Alice").
- Direct addresses: If a speaker says "Bob, what do you think?" the next responding utterance (if different speaker ID) is likely Bob.
- Responses addressing previous: If a speaker says "Yes, Alice," the previous utterance's speaker is likely Alice.
- Chain inferences: Propagate names backwards and forwards for consistency (e.g., if later response identifies earlier speaker).
- References to names in context (e.g., consistent roles or mentions).

Example inference:
Transcript:
Utterance 1 (Speaker 0): Alice, can you update us?
Utterance 2 (Speaker 1): Sure, Bob.
Then Speaker 0 is Bob (from response), Speaker 1 is Alice (from address).

Rules:
- Use only the provided transcript; do not assume external knowledge.
- Only assign proper individual names (e.g., Alice, Bob); do not use group terms like "Everyone", "Team", or roles unless explicitly a name.
- Be conservative: only assign a name if there is strong evidence (e.g., direct mention or clear inference); otherwise, label as "Speaker [ID]" using the original ID.
- Ensure names are unique; do not assign the same name to multiple speakers. If conflict, fallback to "Speaker [ID]" for ambiguous ones.
- Output ONLY a valid JSON object mapping original speaker IDs (as strings) to names, like: {"0": "Alice", "1": "Bob", "2": "Speaker 2"}.

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
                    model: 'llama-3.3-70b-versatile', // Switched to larger 70B model for improved reasoning and accuracy on complex inferences
                    messages: [
                        { role: 'system', content: 'You are a precise assistant for transcript analysis. Follow instructions exactly.' },
                        { role: 'user', content: groqPrompt }
                    ],
                    temperature: 0.1, // Low temperature for consistent, factual output
                    max_tokens: 512, // Increased for more complex mappings
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
                        const nameCounts = new Map<string, number>();
                        Object.entries(parsedMap).forEach(([key, value]) => {
                            const speakerId = parseInt(key as string, 10);
                            const name = (value as string).trim();
                            if (!isNaN(speakerId) && name !== '' && !name.toLowerCase().includes('everyone')) {
                                nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
                            }
                        });
                        // Only apply if no duplicates
                        if (Array.from(nameCounts.values()).every(count => count === 1)) {
                            Object.entries(parsedMap).forEach(([key, value]) => {
                                const speakerId = parseInt(key as string, 10);
                                const name = (value as string).trim();
                                if (!isNaN(speakerId) && name !== '') {
                                    speakerMap.set(speakerId, name);
                                }
                            });
                        }
                        // Else fallback will handle
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
            const commonWords = new Set(['there', 'good', 'nice', 'thank', 'thanks', 'yes', 'okay', 'well', 'the', 'a', 'is', 'in', 'it', 'of', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'everyone']);
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

        // Default to "Speaker X" (remapped to start from 1) if still unknown
        uniqueSpeakers.forEach(speakerId => {
            if (!speakerMap.has(speakerId)) {
                const remappedId = speakerRemap.get(speakerId) || speakerId;
                speakerMap.set(speakerId, `Speaker ${remappedId}`);
            }
        });

        segments = utterances.map((utterance, index) => ({
            id: `segment_${index}`,
            speaker: speakerMap.get(utterance.speaker) || `Speaker ${speakerRemap.get(utterance.speaker) || utterance.speaker}`,
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