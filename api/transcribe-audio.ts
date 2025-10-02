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

    // Call Deepgram for transcription and initial diarization.
    // Added 'diarize_version=latest' for a potential small accuracy boost.
    const deepgramResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2-meeting&smart_format=true&punctuate=true&diarize=true&utterances=true&language=en&diarize_version=latest', {
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
        const fullText = deepgramResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        return new Response(JSON.stringify({ transcription: [], fullText: fullText }), {
            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
    }

    const speakerMap = new Map<number, string>();
    const utteranceSpeakerMap = new Map<number, string>();
    
    const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))].sort((a, b) => a - b);
    
    // High-Confidence Seeding with Regex for self-introductions (no changes here)
    const extractSpeakerNameFromIntro = (text: string): string | null => {
        const lowerText = text.toLowerCase();
        const patterns = [
            /(?:my name is|i'm|i am|this is|call me)\s+([a-z]{3,15})/i,
            /^(?:it's|it is)\s+([a-z]{3,15})/i,
        ];
        const commonWords = new Set(['good', 'nice', 'here', 'speaking', 'ready', 'sorry', 'fine']);
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1] && !commonWords.has(match[1])) {
                return match[1].charAt(0).toUpperCase() + match[1].slice(1);
            }
        }
        return null;
    };

    utterances.forEach(utterance => {
        if (!speakerMap.has(utterance.speaker)) {
            const name = extractSpeakerNameFromIntro(utterance.transcript);
            if (name && utterance.confidence > 0.9 && !Array.from(speakerMap.values()).includes(name)) {
                speakerMap.set(utterance.speaker, name);
            }
        }
    });

    const formattedUtterances = utterances
        .map((u, idx) => `Utterance ${idx} (Speaker ${u.speaker}, ${formatTimestamp(u.start)}): ${u.transcript}`)
        .join('\n');

    // Scenario 1: Deepgram provided multiple speakers (Good Diarization) - This logic remains the same.
    if (uniqueSpeakers.length > 1) {
        const knownSpeakersJson = JSON.stringify(Object.fromEntries(speakerMap));
        const groqPrompt = `You are an expert at identifying speakers in meeting transcripts. Analyze the following transcript where each utterance has a numeric speaker ID. Your task is to determine the real name for each speaker ID based on conversational context. I have already identified some speakers: ${knownSpeakersJson}. Use this and the full transcript to find the remaining names. Clues to look for are direct addresses ("Carrie, ...") and responses ("Yes, Tony."). Rules: 1. Only assign a name with strong evidence. 2. If a name cannot be found for an ID, use "Speaker [ID+1]". 3. Ensure names are unique per speaker ID. 4. Output ONLY a valid JSON object mapping original speaker IDs (as strings) to names. Example: {"0": "Tony", "1": "Jason", "2": "Carrie"}. Transcript:\n${formattedUtterances}`;
        
        try {
            const groqResult = await callGroqAPI(groqPrompt, GROQ_API_KEY, true);
            const parsedMap = JSON.parse(groqResult);
            Object.entries(parsedMap).forEach(([key, value]) => {
                const speakerId = parseInt(key, 10);
                const name = (value as string).trim();
                if (!isNaN(speakerId) && name && !speakerMap.has(speakerId)) {
                    speakerMap.set(speakerId, name);
                }
            });
        } catch (error) {
            console.error('Groq API call failed for multi-speaker:', error);
        }

    } 
    // Scenario 2: Deepgram assigned only one speaker ID (Failed Diarization) - REVISED AND IMPROVED LOGIC
    else if (utterances.length > 1) {
        // This new prompt is much simpler and more reliable.
        const groqPrompt = `You are an expert at identifying speaker changes where automated diarization has failed. All utterances below are incorrectly marked as from the same speaker. Your task is to read the conversation and assign a new label (e.g., "Speaker A", "Speaker B") whenever the speaker changes.

Rules:
1. Assign "Speaker A" to the first speaker.
2. When you detect a speaker change, assign "Speaker B", then "Speaker C", etc.
3. If a previous speaker talks again, re-use their assigned label (e.g., "Speaker A" can appear multiple times).
4. Output ONLY a valid JSON object with a single key "assignments". This key must hold an array of strings, where each string is the assigned speaker label for the corresponding utterance.

Example Transcript:
Utterance 0 (Speaker 0): Hello. Jason, can you start?
Utterance 1 (Speaker 0): Yes, Tony. The numbers are up.
Utterance 2 (Speaker 0): That's great news.
Example Output: {"assignments": ["Speaker A", "Speaker B", "Speaker A"]}

Transcript to analyze:
${formattedUtterances}
`;
        
        try {
            const groqResult = await callGroqAPI(groqPrompt, GROQ_API_KEY, true);
            const parsedResult = JSON.parse(groqResult);
            const assignments = parsedResult.assignments as string[];
            if (assignments && assignments.length === utterances.length) {
                const uniqueNames = new Set(assignments);
                // Only apply the result if the AI actually found more than one speaker.
                if (uniqueNames.size > 1) {
                    assignments.forEach((name, index) => {
                        utteranceSpeakerMap.set(index, name.trim());
                    });
                }
            }
        } catch (error) {
            console.error('Groq API call failed for single-speaker fallback:', error);
        }
    }

    // --- Final Assembly and Default Naming ---
    const speakerRemap = new Map<number, number>();
    uniqueSpeakers.forEach((id, index) => {
        speakerRemap.set(id, index + 1);
    });

    uniqueSpeakers.forEach(speakerId => {
        if (!speakerMap.has(speakerId)) {
            const remappedId = speakerRemap.get(speakerId) || speakerId + 1;
            speakerMap.set(speakerId, `Speaker ${remappedId}`);
        }
    });

    const segments: Segment[] = utterances.map((utterance, index) => ({
        id: `segment_${index}`,
        speaker: utteranceSpeakerMap.get(index) || speakerMap.get(utterance.speaker)!,
        text: utterance.transcript.trim(),
        timestamp: `${formatTimestamp(utterance.start)} - ${formatTimestamp(utterance.end)}`,
        confidence: utterance.confidence || 0.9,
    }));

    const fullText = deepgramResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    return new Response(
      JSON.stringify({ transcription: segments, fullText: fullText }),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    console.error("Error in handler: ", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}

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
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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