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
    if (!DEEPGRAM_API_KEY) {
        throw new Error('DEEPGRAM_API_KEY is not configured');
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
    let speakerCounter = 1;

    if (utterances.length > 0) {
        // Speaker detection logic
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

        utterances.forEach((utterance) => {
            if (!speakerMap.has(utterance.speaker)) {
                const name = extractSpeakerName(utterance.transcript);
                if (name && utterance.confidence === 1 && !Array.from(speakerMap.values()).includes(name)) {
                    speakerMap.set(utterance.speaker, name);
                }
            }
        });

        utterances.forEach((utterance) => {
            if (!speakerMap.has(utterance.speaker)) {
                speakerMap.set(utterance.speaker, `Speaker ${speakerCounter++}`);
            }
        });

        segments = utterances.map((utterance, index) => ({
            id: `segment_${index}`,
            speaker: speakerMap.get(utterance.speaker) || 'Unknown Speaker',
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