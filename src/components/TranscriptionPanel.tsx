import React, { useState, useEffect } from 'react';
import { Mic, MicOff, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import PaginatedTranscription from './PaginatedTranscription';

interface TranscriptionSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  confidence?: number;
}

interface TranscriptionPanelProps {
  transcription: TranscriptionSegment[];
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
}

const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({
  transcription,
  isRecording,
  onStartRecording,
  onStopRecording,
}) => {
  const [recordingTime, setRecordingTime] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      setRecordingTime(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleExport = () => {
    if (transcription.length === 0) {
      toast({
        title: "No transcription available",
        description: "Please record or upload audio first",
        variant: "destructive",
      });
      return;
    }

    const content = transcription
      .map(segment => `[${segment.timestamp}] ${segment.speaker}: ${segment.text}`)
      .join('\n\n');
    
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transcription-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Transcription exported",
      description: "Your transcription has been downloaded",
    });
  };

  return (
    <div className="h-full flex flex-col">
      {/* Recording Controls */}
      <div className="mb-6 space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant={isRecording ? "destructive" : "premium"}
            onClick={isRecording ? onStopRecording : onStartRecording}
            className="flex-1 mr-3 interactive-scale"
            size="lg"
          >
            {isRecording ? (
              <>
                <MicOff className="h-5 w-5 mr-2" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="h-5 w-5 mr-2" />
                Start Recording
              </>
            )}
          </Button>
          
          {isRecording && (
            <div className="text-primary font-mono text-lg font-bold">
              {formatTime(recordingTime)}
            </div>
          )}
        </div>

        {/* Export Controls */}
        {transcription.length > 0 && (
          <div className="flex space-x-3">
            <Button
              variant="glass"
              onClick={handleExport}
              className="flex-1 hover-lift"
            >
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
        )}
      </div>

      {/* Transcription Display */}
      <div className="flex-1 min-h-0">
        <PaginatedTranscription 
          transcription={transcription}
          itemsPerPage={5}
        />
      </div>
    </div>
  );
};

export default TranscriptionPanel;