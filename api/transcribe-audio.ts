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

    // Call Deepgram for transcription and initial diarization
    const deepgramResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2-meeting&smart_format=true&punctuate=true&diarize=true&utterances=true&language=en', {
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

    if (utterances.length === 0) {
        // If no utterances, return the full text if available, or empty.
        const fullText = deepgramResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        return new Response(JSON.stringify({ transcription: [], fullText: fullText }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    // --- Speaker Identification Logic ---
    const speakerMap = new Map<number, string>();
    const utteranceSpeakerMap = new Map<number, string>(); // For single-speaker fallback scenario
    
    const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))].sort((a, b) => a - b);
    
    // --- Step 1: High-Confidence Seeding with Regex ---
    // First, find explicit introductions which are highly reliable.
    const extractSpeakerNameFromIntro = (text: string): string | null => {
        const lowerText = text.toLowerCase();
        // More robust patterns to catch introductions
        const patterns = [
            /(?:my name is|i'm|i am|this is|call me)\s+([a-z]{3,15})/i,
            /^(?:it's|it is)\s+([a-z]{3,15})/i,
        ];
        // Words to ignore to prevent false positives like "I'm good"
        const commonWords = new Set(['good', 'nice', 'here', 'speaking', 'ready', 'sorry', 'fine']);
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1] && !commonWords.has(match[1])) {
                // Capitalize the name
                return match[1].charAt(0).toUpperCase() + match[1].slice(1);
            }
        }
        return null;
    };

    utterances.forEach(utterance => {
        // If we haven't identified this speaker ID yet, try the regex
        if (!speakerMap.has(utterance.speaker)) {
            const name = extractSpeakerNameFromIntro(utterance.transcript);
            // Check if name is found, high confidence, and not already assigned to another speaker
            if (name && utterance.confidence > 0.9 && !Array.from(speakerMap.values()).includes(name)) {
                speakerMap.set(utterance.speaker, name);
            }
        }
    });

    // --- Step 2: Contextual Analysis with Groq LLM ---
    const formattedUtterances = utterances
        .map((u, idx) => `Utterance ${idx} (Speaker ${u.speaker}, ${formatTimestamp(u.start)}): ${u.transcript}`)
        .join('\n');

    // Scenario 1: Deepgram provided multiple speakers (Good Diarization)
    if (uniqueSpeakers.length > 1) {
        // We provide the names we already found as a starting point for the LLM
        const knownSpeakersJson = JSON.stringify(Object.fromEntries(speakerMap));

        const groqPrompt = `You are an expert at identifying speakers in meeting transcripts. Analyze the following transcript, where each utterance has a numeric speaker ID.
Your task is to determine the real name for each speaker ID based on conversational context.

I have already identified some speakers based on direct introductions: ${knownSpeakersJson}.
Use this information and the full transcript to find the remaining speaker names.

Clues to look for:
- Direct addresses: "Carrie, can you give us an update?" implies the next speaker might be Carrie.
- Responses: "Yes, Tony." implies the previous speaker was Tony.
- Contextual roles and consistent mentions.

Rules:
1. Only assign a name if there is strong evidence in the text.
2. If a name cannot be determined for a speaker ID, use the format "Speaker [ID+1]" (e.g., "Speaker 1", "Speaker 2").
3. Ensure names are unique. Do not assign the same name to multiple different speaker IDs.
4. Output ONLY a valid JSON object mapping the original speaker IDs (as strings) to their identified names. Example: {"0": "Tony", "1": "Jason", "2": "Carrie"}

Transcript:
${formattedUtterances}
`;
        
        try {
            const groqResult = await callGroqAPI(groqPrompt, GROQ_API_KEY, true); // true for JSON object
            const parsedMap = JSON.parse(groqResult);
            Object.entries(parsedMap).forEach(([key, value]) => {
                const speakerId = parseInt(key, 10);
                const name = (value as string).trim();
                // Add the name if the speaker ID is not already identified by our high-confidence regex pass
                if (!isNaN(speakerId) && name && !speakerMap.has(speakerId)) {
                    speakerMap.set(speakerId, name);
                }
            });
        } catch (error) {
            console.error('Groq API call or JSON parsing failed for multi-speaker:', error);
        }

    } 
    // Scenario 2: Deepgram assigned only one speaker ID (Potential Failed Diarization)
    else if (utterances.length > 1) {
        const groqPrompt = `You are an expert at correcting failed diarization in transcripts. The following transcript incorrectly labels all utterances with the same speaker ID.
Your task is to analyze the conversation flow and assign the correct speaker to EACH utterance.

Analyze the conversation for:
- Questions and answers that indicate a speaker change.
- Direct addresses: "Jason, your thoughts?" means the next utterance is likely Jason.
- Responses: "Thanks, Tony." means the previous utterance was likely from Tony.

Rules:
1. For each utterance, identify the speaker's name.
2. If a speaker's name is not mentioned, assign a generic label like "Speaker 1", "Speaker 2", etc., based on their order of appearance. Use the same label for the same unnamed person.
3. Output ONLY a valid JSON object containing a single key "assignments" which is an array of strings. Each string in the array is the identified speaker name for the corresponding utterance, in order.
Example format: {"assignments": ["Tony", "Tony", "Jason", "Carrie", "Tony"]}

Transcript:
${formattedUtterances}
`;
        
        try {
            const groqResult = await callGroqAPI(groqPrompt, GROQ_API_KEY, true); // true for JSON object
            const parsedResult = JSON.parse(groqResult);
            const assignments = parsedResult.assignments as string[];
            if (assignments && assignments.length === utterances.length) {
                 // Check if the LLM actually found multiple speakers
                const uniqueNames = new Set(assignments);
                if (uniqueNames.size > 1) {
                    assignments.forEach((name, index) => {
                        utteranceSpeakerMap.set(index, name.trim());
                    });
                }
            }
        } catch (error) {
            console.error('Groq API call or JSON parsing failed for single-speaker fallback:', error);
        }
    }

    // --- Step 3: Final Assembly and Default Naming ---
    // Remap speaker IDs to be 1-based for any remaining unidentified speakers
    const speakerRemap = new Map<number, number>();
    uniqueSpeakers.forEach((id, index) => {
        speakerRemap.set(id, index + 1);
    });

    // Assign default "Speaker X" names if any are still missing
    uniqueSpeakers.forEach(speakerId => {
        if (!speakerMap.has(speakerId)) {
            const remappedId = speakerRemap.get(speakerId) || speakerId + 1;
            speakerMap.set(speakerId, `Speaker ${remappedId}`);
        }
    });

    const segments: Segment[] = utterances.map((utterance, index) => ({
        id: `segment_${index}`,
        // Use the utterance-specific map first (for failed diarization), otherwise use the main speaker map.
        speaker: utteranceSpeakerMap.get(index) || speakerMap.get(utterance.speaker)!,
        text: utterance.transcript.trim(),
        timestamp: `${formatTimestamp(utterance.start)} - ${formatTimestamp(utterance.end)}`,
        confidence: utterance.confidence || 0.9,
    }));

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
    console.error("Error in handler: ", error);
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

/**
 * Helper function to call the Groq API and enforce JSON mode.
 */
async function callGroqAPI(prompt: string, apiKey: string, useJsonMode: boolean): Promise<string> {
    const body: any = {
        model: 'llama3-70b-8192',
        messages: [
            { role: 'system', content: 'You are a helpful assistant that provides concise and accurate results in JSON format.' },
            { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 1024,
    };

    if (useJsonMode) {
        body.response_format = { type: 'json_object' };
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || '';
}

function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}