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

    const deepgramResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2-meeting&smart_format=true&punctuate=true&diarize=true&utterances=true&language=en&multichannel=false&numerals=true&paragraphs=true&utt_split=1.0', {
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
    const utteranceSpeakerMap = new Map<number, string>(); // For fallback per-utterance mapping (index-based)

    if (utterances.length > 0) {
        // Remap speaker IDs to start from 1
        const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))].sort((a, b) => a - b);
        const speakerRemap = new Map<number, number>();
        uniqueSpeakers.forEach((id, index) => {
            speakerRemap.set(id, index + 1);
        });

        // Post-process to merge continuation utterances
        const mergedUtterances: Utterance[] = [];
        let current: Utterance | null = null;
        utterances.forEach(u => {
            if (current && current.speaker === u.speaker && current.transcript.endsWith(',') && u.transcript[0] === u.transcript[0].toLowerCase()) {
                // Merge continuation
                current.transcript += ' ' + u.transcript;
                current.end = u.end;
                current.confidence = Math.min(current.confidence, u.confidence);
            } else {
                if (current) mergedUtterances.push(current);
                current = { ...u };
            }
        });
        if (current) mergedUtterances.push(current);

        const formattedUtterances = mergedUtterances
            .map((u, idx) => `Utterance ${idx} (Speaker ${u.speaker}, ${formatTimestamp(u.start)} - ${formatTimestamp(u.end)}): ${u.transcript}`)
            .join('\n\n');

        // Detect if likely multi-speaker content (e.g., contains name addresses like "Jason,")
        const hasPotentialMultipleSpeakers = /([A-Z][a-z]{2,15}),/.test(formattedUtterances);

        // First, try advanced speaker identification using Groq LLM
        if (uniqueSpeakers.length > 1 || (uniqueSpeakers.length === 1 && hasPotentialMultipleSpeakers && mergedUtterances.length > 1)) {
            let groqPrompt: string;

            if (uniqueSpeakers.length > 1) {
                // Standard prompt for multi-speaker diarization
                groqPrompt = `You are an expert at identifying speakers in meeting transcripts. Analyze the following utterances from a diarized transcript, where each is labeled with a numeric speaker ID (e.g., Speaker 0, Speaker 1) based on voice differences.

Infer the real names of each speaker based on the entire conversation context:
- Self-introductions (e.g., "Hi, I'm Alice").
- Direct addresses: If a speaker says "Bob, what do you think?" the next responding utterance (if different speaker ID) is likely Bob.
- Responses addressing previous: If a speaker says "Yes, Alice," the previous utterance's speaker is likely Alice.
- Chain inferences: Propagate names backwards and forwards for consistency (e.g., if later response identifies earlier speaker).
- References to names in context (e.g., consistent roles or mentions).

Example inference:
Transcript:
Utterance 0 (Speaker 0): Alice, can you update us?
Utterance 1 (Speaker 1): Sure, Bob.
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
            } else {
                // Fallback prompt for potential diarization failure (all same ID, but content suggests multiple)
                groqPrompt = `You are an expert at identifying speakers in meeting transcripts. The following utterances are from a transcript where diarization may have failed, labeling all as the same speaker ID. Based on content, infer speaker changes and names.

Analyze the conversation flow:
- Detect speaker changes based on addresses (e.g., "Bob," starts question to Bob, next is Bob's response).
- Responses like "Yes, Alice" refer to previous speaker as Alice.
- Questions or addresses typically indicate the end of one speaker and start of another.
- Consecutive statements without response are likely same speaker.
- If an utterance is short (e.g., a name like "Jason,"), and the next starts with lowercase, it may be a split address; consider merging them as part of the same speaker's turn (the addresser, not the addressee).
- Chain inferences: Propagate names backwards and forwards.
- Group consecutive utterances by the same inferred speaker.

Infer names:
- From direct addresses and responses (e.g., if utterance ends with "Jason, can you...", the speaker is not Jason, but addressing Jason; the next response is Jason's).
- For unnamed speakers, assign "Speaker 1", "Speaker 2", etc., based on order of appearance, starting from 1.

Example:
Transcript:
Utterance 0 (Speaker 0): Hello everyone.
Utterance 1 (Speaker 0): Jason,
Utterance 2 (Speaker 0): can you take minutes?
Utterance 3 (Speaker 0): Yes, Tony.
Utterance 4 (Speaker 0): No problem.
Utterance 5 (Speaker 0): Thanks. Carrie, update us?
Utterance 6 (Speaker 0): Yes, Tony.
Utterance 7 (Speaker 0): We decided...
Utterance 8 (Speaker 0): Fantastic.
Then assign: ["Tony", "Tony", "Tony", "Jason", "Jason", "Tony", "Carrie", "Carrie", "Tony"]  (Merge 1-2 as Tony addressing Jason; 3-4 Jason responding to Tony; 5 Tony; 6-7 Carrie; 8 Tony).

Rules:
- Use only the provided transcript.
- Only assign individual names; avoid "Everyone".
- Ensure unique names for different speakers; same speaker can repeat.
- Output ONLY a valid JSON array of speaker assignments for each utterance index (starting from 0), like: ["Tony", "Tony", "Jason", "Tony", "Carrie"] or ["Speaker 1", "Speaker 2", "Speaker 1"] if unnamed.

Transcript:
${formattedUtterances}

Speaker assignments per utterance:`;
            }

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: 'llama-3.3-70b-versatile', // Larger model for better inference
                    messages: [
                        { role: 'system', content: 'You are a precise assistant for transcript analysis. Follow instructions exactly.' },
                        { role: 'user', content: groqPrompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 1024, // Increased to handle longer transcripts
                }),
            });

            if (groqResponse.ok) {
                const groqResult = await groqResponse.json();
                const groqContent = groqResult.choices?.[0]?.message?.content || '';
                try {
                    const jsonMatch = groqContent.match(uniqueSpeakers.length > 1 ? /\{.*\}/s : /\[.*\]/s);
                    if (jsonMatch) {
                        if (uniqueSpeakers.length > 1) {
                            // ID-based mapping
                            const parsedMap = JSON.parse(jsonMatch[0]);
                            const nameCounts = new Map<string, number>();
                            Object.entries(parsedMap).forEach(([key, value]) => {
                                const name = (value as string).trim();
                                if (name !== '' && !name.toLowerCase().includes('everyone')) {
                                    nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
                                }
                            });
                            if (Array.from(nameCounts.values()).every(count => count === 1)) {
                                Object.entries(parsedMap).forEach(([key, value]) => {
                                    const speakerId = parseInt(key as string, 10);
                                    const name = (value as string).trim();
                                    if (!isNaN(speakerId) && name !== '') {
                                        speakerMap.set(speakerId, name);
                                    }
                                });
                            }
                        } else {
                            // Utterance index-based mapping for fallback
                            const parsedArray = JSON.parse(jsonMatch[0]) as string[];
                            if (parsedArray.length === mergedUtterances.length) {
                                const cleanedArray = parsedArray.map(name => name.trim()).filter(name => name !== '' && !name.toLowerCase().includes('everyone'));
                                if (cleanedArray.length === parsedArray.length) { // all valid
                                    const uniqueNames = new Set(cleanedArray);
                                    if (uniqueNames.size > 1) { // multiple speakers detected
                                        parsedArray.forEach((name, index) => {
                                            utteranceSpeakerMap.set(index, name.trim());
                                        });
                                    }
                                    // else discard if only one unique name
                                }
                            }
                        }
                    }
                } catch (parseError) {
                    console.error('Failed to parse Groq response:', parseError);
                }
            } else {
                console.error('Groq API error:', groqResponse.status);
            }
        }

        // Fallback to regex if needed
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

        mergedUtterances.forEach((utterance, index) => {
            if (!speakerMap.has(utterance.speaker) && !utteranceSpeakerMap.has(index)) {
                const name = extractSpeakerName(utterance.transcript);
                if (name && utterance.confidence >= 0.95 && !Array.from(speakerMap.values()).includes(name)) {
                    speakerMap.set(utterance.speaker, name);
                }
            }
        });

        // Default to "Speaker X" if still unknown
        uniqueSpeakers.forEach(speakerId => {
            if (!speakerMap.has(speakerId)) {
                const remappedId = speakerRemap.get(speakerId) || speakerId;
                speakerMap.set(speakerId, `Speaker ${remappedId}`);
            }
        });

        segments = mergedUtterances.map((utterance, index) => ({
            id: `segment_${index}`,
            speaker: utteranceSpeakerMap.get(index) || speakerMap.get(utterance.speaker) || `Speaker ${speakerRemap.get(utterance.speaker) || utterance.speaker}`,
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