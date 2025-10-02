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
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
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
        // Preserve original speaker IDs from Deepgram for accurate diarization
        const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))].sort((a, b) => a - b);
        const speakerRemap = new Map<number, number>();
        uniqueSpeakers.forEach((id, index) => {
            speakerRemap.set(id, id + 1); // Shift IDs to start from 1
        });

        // Try advanced speaker identification using Groq LLM
        if (uniqueSpeakers.length > 1) {
            const formattedUtterances = utterances
                .map((u, idx) => `Utterance ${idx + 1} (Speaker ${u.speaker}, ${formatTimestamp(u.start)} - ${formatTimestamp(u.end)}): ${u.transcript}`)
                .join('\n\n');

            const groqPrompt = `You are an expert at identifying unique speakers in a diarized meeting transcript, where each utterance is labeled with a numeric speaker ID (e.g., Speaker 0, Speaker 1). Your task is to infer the real names of each speaker based on the entire conversation context, ensuring distinct speakers are correctly differentiated.

Analyze the transcript for:
- Self-introductions (e.g., "Hi, I'm Alice").
- Direct addresses (e.g., if Speaker 0 says "Bob, what do you think?", the next speaker responding is likely Bob).
- Responses addressing previous speakers (e.g., if Speaker 1 says "Yes, Alice", Speaker 0 is likely Alice).
- Contextual clues (e.g., consistent roles, topics, or name mentions across utterances).
- Sequential interactions (e.g., question-response patterns to link speakers).

Rules:
- Use only the provided transcript; do not assume external knowledge.
- Assign proper individual names (e.g., Alice, Bob) only when there is strong evidence (e.g., direct mention, clear address-response pattern).
- Do not use group terms like "Everyone", "Team", or roles unless explicitly a name.
- Ensure each speaker ID maps to a unique name or label; avoid assigning the same name to multiple IDs.
- If a name cannot be confidently inferred, use "Speaker [ID]" with the original ID (e.g., "Speaker 0").
- Output ONLY a valid JSON object mapping original speaker IDs (as strings) to names, like: {"0": "Alice", "1": "Bob", "2": "Speaker 2"}.
- Verify that distinct speaker IDs correspond to distinct voices based on context and diarization.

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
                    model: 'llama-3.3-70b-versatile', // Switched to more powerful model for better speaker differentiation
                    messages: [
                        { role: 'system', content: 'You are a precise assistant for transcript analysis. Follow instructions exactly and prioritize unique speaker identification.' },
                        { role: 'user', content: groqPrompt }
                    ],
                    temperature: 0.05, // Lowered for higher precision
                    max_tokens: 512,
                }),
            });

            if (groqResponse.ok) {
                const groqResult = await groqResponse.json();
                const groqContent = groqResult.choices?.[0]?.message?.content || '';
                try {
                    // Extract JSON from response
                    const jsonMatch = groqContent.match(/\{.*\}/s);
                    if (jsonMatch) {
                        const parsedMap = JSON.parse(jsonMatch[0]);
                        Object.entries(parsedMap).forEach(([key, value]) => {
                            const speakerId = parseInt(key as string, 10);
                            if (!isNaN(speakerId) && typeof value === 'string' && value.trim() !== '' && !/everyone|team|group/i.test(value)) {
                                speakerMap.set(speakerId, value);
                            }
                        });
                    }
                } catch (parseError) {
                    console.error('Failed to parse Groq response:', parseError);
                }
            } else {
                console.error('Groq API error:', groqResponse.status, await groqResponse.text());
            }
        }

        // Fallback to regex-based extraction for unmapped speakers
        const extractSpeakerName = (text: string, previousUtterances: Utterance[], currentIndex: number): string | null => {
            const lowerText = text.toLowerCase();
            const commonWords = new Set(['there', 'good', 'nice', 'thank', 'thanks', 'yes', 'okay', 'well', 'the', 'a', 'is', 'in', 'it', 'of', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'everyone']);
            const namePatterns = [
                /(?:my name is|i'm|i am|this is|call me)\s+([a-z]{2,15})/i,
                /(?:hi|hello),?\s+([a-z]{2,15})/i,
                /^([a-z]{2,15}),?\s+(?:here|speaking)/i,
                /^(?:it's|it is)\s+([a-z]{2,15})/i,
                /([a-z]{2,15})\s+is my name/i
            ];

            // Check direct patterns
            for (const pattern of namePatterns) {
                const match = text.match(pattern);
                if (match && match[1]) {
                    const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                    if (!commonWords.has(name.toLowerCase())) {
                        return name;
                    }
                }
            }

            // Check for addressed names in current or previous utterances
            const addressPattern = /([a-z]{2,15}),\s*(?:can|please|what|do)/i;
            const match = text.match(addressPattern);
            if (match && match[1] && !commonWords.has(match[1].toLowerCase())) {
                const name = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
                // Assign to next speaker if available
                if (currentIndex + 1 < utterances.length) {
                    const nextSpeakerId = utterances[currentIndex + 1].speaker;
                    if (!speakerMap.has(nextSpeakerId) && !Array.from(speakerMap.values()).includes(name)) {
                        speakerMap.set(nextSpeakerId, name);
                    }
                }
            }

            // Check for responses addressing previous speaker
            const responsePattern = /(?:yes|okay|sure),\s*([a-z]{2,15})/i;
            const responseMatch = text.match(responsePattern);
            if (responseMatch && responseMatch[1] && currentIndex > 0 && !commonWords.has(responseMatch[1].toLowerCase())) {
                const name = responseMatch[1].charAt(0).toUpperCase() + responseMatch[1].slice(1).toLowerCase();
                const prevSpeakerId = utterances[currentIndex - 1].speaker;
                if (!speakerMap.has(prevSpeakerId) && !Array.from(speakerMap.values()).includes(name)) {
                    speakerMap.set(prevSpeakerId, name);
                }
            }

            return null;
        };

        // Apply fallback for unmapped speakers
        utterances.forEach((utterance, index) => {
            if (!speakerMap.has(utterance.speaker)) {
                const name = extractSpeakerName(utterance.transcript, utterances, index);
                if (name && utterance.confidence >= 0.95 && !Array.from(speakerMap.values()).includes(name)) {
                    speakerMap.set(utterance.speaker, name);
                }
            }
        });

        // Default to "Speaker X" (remapped to start from 1) if still unknown
        uniqueSpeakers.forEach(speakerId => {
            if (!speakerMap.has(speakerId)) {
                const remappedId = speakerRemap.get(speakerId) || speakerId + 1;
                speakerMap.set(speakerId, `Speaker ${remappedId}`);
            }
        });

        // Generate segments with mapped speakers
        segments = utterances.map((utterance, index) => ({
            id: `segment_${index}`,
            speaker: speakerMap.get(utterance.speaker) || `Speaker ${speakerRemap.get(utterance.speaker) || utterance.speaker + 1}`,
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