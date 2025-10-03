// This file configures the runtime environment for the Vercel function to 'edge'.
export const config = {
  runtime: 'edge',
};

// Defines the structure for a single utterance from the Deepgram API.
interface Utterance {
  speaker: number;
  transcript: string;
  start: number;
  end: number;
  confidence: number;
}

// Defines the structure for a transcription segment that will be used in the frontend.
interface Segment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  confidence: number;
}

// This is the main handler for the Vercel serverless function. It processes the audio transcription request.
export default async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight requests to allow cross-origin requests from the frontend.
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Get the form data from the request, which includes the audio file.
    const formData = await req.formData();
    const audioFile = formData.get('audio') as File;

    // If there's no audio file, we can't proceed, so throw an error.
    if (!audioFile) {
      throw new Error('No audio file provided');
    }

    // Convert the audio file to an ArrayBuffer to send to the Deepgram API.
    const audioBuffer = await audioFile.arrayBuffer();

    // Retrieve API keys from environment variables.
    const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;
    if (!DEEPGRAM_API_KEY) {
        throw new Error('DEEPGRAM_API_KEY is not configured');
    }
    if (!GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY is not configured');
    }

    // Call the Deepgram API to transcribe the audio. We're enabling features like smart formatting, punctuation, and speaker diarization.
    const deepgramResponse = await fetch('https://api.deepgram.com/v1/listen?model=nova-2-meeting&smart_format=true&punctuate=true&diarize=true&utterances=true&language=en&multichannel=false&numerals=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': audioFile.type || 'audio/webm',
      },
      body: audioBuffer,
    });

    // If the Deepgram API returns an error, we throw an error with the details.
    if (!deepgramResponse.ok) {
        const errorText = await deepgramResponse.text();
        throw new Error(`Deepgram API error: ${deepgramResponse.status} - ${errorText}`);
    }

    // Parse the JSON response from the Deepgram API.
    const deepgramResult = await deepgramResponse.json();
    const utterances: Utterance[] = deepgramResult.results?.utterances || [];

    let segments: Segment[] = [];

    // If there are utterances, we'll process them to identify speakers.
    if (utterances.length > 0) {
        // Step 1: Normalize speaker IDs to start from 0 for easier processing.
        const uniqueSpeakers = [...new Set(utterances.map(u => u.speaker))].sort((a, b) => a - b);
        const speakerRemap = new Map<number, number>();
        uniqueSpeakers.forEach((id, index) => {
            speakerRemap.set(id, index);
        });

        // Step 2: Format the transcript for the LLM to analyze and identify speakers.
        const formattedTranscript = utterances
            .map((u, idx) => {
                const remappedSpeakerId = speakerRemap.get(u.speaker);
                return `[${idx}] Speaker_${remappedSpeakerId}: ${u.transcript.trim()}`;
            })
            .join('\n');

        console.log('Formatted transcript for LLM:\n', formattedTranscript);

        // Step 3: Use an LLM to identify the names of the speakers from the transcript.
        const speakerNames = await identifySpeakersWithLLM(formattedTranscript, utterances.length, GROQ_API_KEY);
        
        console.log('LLM identified speakers:', speakerNames);

        // Step 4: Create the final transcription segments with the identified speaker names.
        segments = utterances.map((utterance, index) => {
            const remappedSpeakerId = speakerRemap.get(utterance.speaker) || 0;
            const speakerName = speakerNames[index] || `Speaker ${remappedSpeakerId + 1}`;
            
            return {
                id: `segment_${index}`,
                speaker: speakerName,
                text: utterance.transcript.trim(),
                timestamp: `${formatTimestamp(utterance.start)} - ${formatTimestamp(utterance.end)}`,
                confidence: utterance.confidence || 0.9,
            };
        });
    }

    // Get the full transcript text.
    const fullText = deepgramResult.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';

    // Return the transcription segments and the full text in the response.
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
    // If an error occurs at any point, log it and return a 500 error response.
    console.error('Transcription error:', error);
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

// This function uses the Groq API to identify speaker names from the transcript.
async function identifySpeakersWithLLM(
  transcript: string, 
  utteranceCount: number,
  apiKey: string
): Promise<string[]> {
  // This prompt provides clear instructions and examples to the LLM for accurate speaker identification.
  const prompt = `You are analyzing a meeting transcript to identify speakers. Each line shows an utterance index, speaker ID (based on voice), and what they said.

CRITICAL RULES:
1. Names are revealed through DIRECT ADDRESS (e.g., "Jason, can you..." means the NEXT different speaker who responds is Jason)
2. When someone says "Yes, [Name]" they are RESPONDING TO that person (so the PREVIOUS speaker is [Name])
3. The speaker ID (Speaker_0, Speaker_1, etc.) tells you which VOICE is speaking
4. Track which voice (Speaker_X) corresponds to which name based on these clues
5. Once you identify a voice-to-name mapping, use it consistently throughout

EXAMPLE ANALYSIS:
[0] Speaker_0: Jason, can you help?
[1] Speaker_1: Yes, Tony.
[2] Speaker_1: I'll do that.
[3] Speaker_0: Thanks, Jason.

REASONING:
- Line 0: Speaker_0 addresses "Jason" - so next different voice that responds is Jason
- Line 1: Speaker_1 responds, so Speaker_1 = Jason. Also says "Yes, Tony" meaning previous speaker (Speaker_0) = Tony
- Line 2: Speaker_1 continues (still Jason)
- Line 3: Speaker_0 speaks again (still Tony), confirms by addressing Jason

RESULT: [0]=Tony, [1]=Jason, [2]=Jason, [3]=Tony

Now analyze this transcript:

${transcript}

OUTPUT REQUIREMENTS:
- Return ONLY a JSON array with exactly ${utteranceCount} elements
- Each element is the speaker name for that utterance index
- Use actual names when identified (e.g., "Tony", "Jason", "Carrie")
- Use "Speaker 1", "Speaker 2", etc. ONLY when you cannot identify a name
- Ensure the same voice (Speaker_X) always gets the same name throughout
- Format: ["Name1", "Name2", "Name1", ...]

JSON array:`;

  try {
    // Call the Groq API with the formatted prompt.
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile', // Using a powerful model for better accuracy.
        messages: [
          { 
            role: 'system', 
            content: 'You are a precise transcript analyst. Return only valid JSON arrays. Follow instructions exactly.' 
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    // If the API call fails, log the error and return an empty array.
    if (!response.ok) {
      console.error('Groq API error:', response.status);
      return [];
    }

    // Parse the response from the Groq API.
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';
    
    console.log('LLM raw response:', content);

    // Extract the JSON array from the response content.
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as string[];
      
      // Validate that the response is a valid array with the correct number of elements.
      if (Array.isArray(parsed) && parsed.length === utteranceCount) {
        // Clean up the names (e.g., trim whitespace, capitalize).
        const cleaned = parsed.map(name => {
          const trimmed = name.trim();
          // Capitalize first letter if it's a proper name
          if (trimmed && !trimmed.startsWith('Speaker')) {
            return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
          }
          return trimmed;
        });
        
        return cleaned;
      }
    }
    
    console.error('Failed to parse valid speaker array from LLM response');
    return [];
    
  } catch (error) {
    console.error('Error calling Groq API:', error);
    return [];
  }
}

// A helper function to format seconds into a "minutes:seconds" timestamp.
function formatTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}