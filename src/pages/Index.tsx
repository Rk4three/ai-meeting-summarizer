import { useState, useRef } from 'react';
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import FileUpload from "@/components/FileUpload";
import TranscriptionPanel from "@/components/TranscriptionPanel";
import SummaryPanel from "@/components/SummaryPanel";
import { Sparkles, Mic, FileText } from 'lucide-react';

interface TranscriptionSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  confidence?: number;
}

interface MeetingSummary {
  overview: string;
  keyDecisions: string[];
  actionItems: Array<{
    id: string;
    task: string;
    assignee?: string;
    dueDate?: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  keyTopics: string[];
  nextSteps: string[];
}

const Index = () => {
  const [currentView, setCurrentView] = useState<'landing' | 'app'>('landing');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcription, setTranscription] = useState<TranscriptionSegment[]>([]);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const { toast } = useToast();
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  const processAudio = async (formData: FormData) => {
    setIsProcessing(true);
    setTranscription([]);
    setSummary(null);

    try {
      const transcribeResponse = await fetch('/api/transcribe-audio', {
        method: 'POST',
        body: formData,
      });

      if (!transcribeResponse.ok) {
        const errorData = await transcribeResponse.json();
        throw new Error(errorData.error || 'Transcription failed');
      }

      const transcribeData = await transcribeResponse.json();
      setTranscription(transcribeData.transcription);
      setIsProcessing(false);
      setIsLoadingSummary(true);

      const summaryResponse = await fetch('/api/analyze-meeting', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              text: transcribeData.fullText || transcribeData.transcription?.map((t: TranscriptionSegment) => t.text).join(' '),
              type: 'summary'
          }),
      });

      if (!summaryResponse.ok) {
          const errorData = await summaryResponse.json();
          throw new Error(errorData.error || 'Summary generation failed');
      }
      
      const summaryData = await summaryResponse.json();
      setSummary(summaryData);
      setIsLoadingSummary(false);
      
      toast({
        title: "Processing complete!",
        description: "Your file has been transcribed and summarized.",
      });

    } catch (error) {
      console.error('Processing error:', error);
      toast({
        title: "An Error Occurred",
        description: (error as Error).message || "Failed to process the audio. Please try again.",
        variant: "destructive",
      });
      setIsProcessing(false);
      setIsLoadingSummary(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    setCurrentView('app');
    const formData = new FormData();
    formData.append('audio', file);
    await processAudio(formData);
  };

  const handleStartRecording = async () => {
    setIsRecording(true);
    setCurrentView('app');
    setTranscription([]);
    setSummary(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', audioBlob, 'recording.webm');
        await processAudio(formData);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      
    } catch (error) {
      toast({
        title: "Microphone Access Denied",
        description: "Please allow microphone access in your browser settings to start recording.",
        variant: "destructive",
      });
      setIsRecording(false);
    }
  };

  const handleStopRecording = () => {
    setIsRecording(false);
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }
  };
  

  if (currentView === 'app') {
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-border/50">
          <div className="container mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="relative">
                  <Sparkles className="h-8 w-8 text-primary" />
                  <div className="absolute inset-0 h-8 w-8 rounded-full bg-primary/20 blur-md"></div>
                </div>
                <h1 className="text-2xl font-bold text-gradient">AI Meeting Assistant</h1>
              </div>
              <Button
                variant="glass"
                onClick={() => setCurrentView('landing')}
                className="hover-lift"
              >
                Back to Home
              </Button>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8">
          <div className="grid lg:grid-cols-3 md:grid-cols-1 gap-6 lg:gap-8 max-w-7xl mx-auto">
            {/* File Upload & Controls */}
            <div className="space-y-6 animate-fade-in">
              <div className="glass-card rounded-2xl p-6 hover-lift">
                <h2 className="text-xl font-bold mb-4 text-gradient">Upload & Record</h2>
                <FileUpload 
                  onFileSelect={handleFileSelect} 
                  isProcessing={isProcessing}
                />
              </div>
            </div>

            {/* Transcription Panel */}
            <div className="animate-fade-in">
              <div className="glass-card rounded-2xl p-6 h-full hover-lift">
                <h2 className="text-xl font-bold mb-4 text-gradient">Live Transcription</h2>
                <TranscriptionPanel
                  isRecording={isRecording}
                  onStartRecording={handleStartRecording}
                  onStopRecording={handleStopRecording}
                  transcription={transcription}
                />
              </div>
            </div>

            {/* Summary Panel */}
            <div className="animate-fade-in">
              <div className="glass-card rounded-2xl p-6 h-full hover-lift">
                <SummaryPanel
                  summary={summary || undefined}
                  isLoading={isLoadingSummary}
                />
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden min-h-screen flex items-center">
        <div className="absolute inset-0 gradient-subtle opacity-30"></div>
        
        <div className="relative container mx-auto px-4">
          <div className="text-center max-w-5xl mx-auto animate-fade-in">
            <div className="flex items-center justify-center mb-8">
              <div className="relative">
                <Sparkles className="h-20 w-20 text-primary animate-float" />
                <div className="absolute inset-0 h-20 w-20 rounded-full bg-primary/20 blur-xl animate-pulse"></div>
              </div>
            </div>
            
            <h1 className="text-5xl md:text-7xl lg:text-8xl font-bold mb-8 tracking-tight">
              <span className="text-gradient">AI-Powered</span>
              <br />
              <span className="text-foreground">Meeting Intelligence</span>
            </h1>
            
            <p className="text-xl md:text-2xl lg:text-3xl text-muted-foreground mb-12 leading-relaxed max-w-4xl mx-auto">
              Transform your meetings into actionable insights with real-time transcription, 
              speaker identification, and AI-generated summaries.
            </p>
            
            <div className="flex justify-center">
              <Button 
                variant="hero" 
                size="lg"
                onClick={() => setCurrentView('app')}
                className="text-xl px-16 py-6 rounded-2xl font-bold tracking-wide"
              >
                <Sparkles className="h-6 w-6 mr-3" />
                Get Started
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-32 relative">
        <div className="absolute inset-0 gradient-subtle opacity-10"></div>
        <div className="container mx-auto px-4 relative">
          <div className="text-center mb-20 animate-slide-up">
            <h2 className="text-5xl md:text-6xl font-bold mb-6">
              Everything you need for 
              <span className="text-gradient"> smart meetings</span>
            </h2>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-3xl mx-auto">
              Powered by advanced AI to make every meeting more productive
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 lg:gap-12">
            <div className="glass-card rounded-2xl p-8 lg:p-10 text-center group hover:glow-shadow hover-lift animate-slide-up">
              <div className="relative mb-6">
                <Mic className="h-16 w-16 text-primary mx-auto group-hover:scale-110 transition-transform duration-300" />
                <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gradient">Real-time Transcription</h3>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Live transcription with speaker identification and timestamp accuracy
              </p>
            </div>

            <div className="glass-card rounded-2xl p-8 lg:p-10 text-center group hover:glow-shadow hover-lift animate-slide-up">
              <div className="relative mb-6">
                <Sparkles className="h-16 w-16 text-primary mx-auto group-hover:scale-110 transition-transform duration-300" />
                <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gradient">AI-Powered Analysis</h3>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Automatically extract key decisions, action items, and meeting insights
              </p>
            </div>

            <div className="glass-card rounded-2xl p-8 lg:p-10 text-center group hover:glow-shadow hover-lift animate-slide-up">
              <div className="relative mb-6">
                <FileText className="h-16 w-16 text-primary mx-auto group-hover:scale-110 transition-transform duration-300" />
                <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-primary/20 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              </div>
              <h3 className="text-2xl font-bold mb-4 text-gradient">Smart Summaries</h3>
              <p className="text-muted-foreground text-lg leading-relaxed">
                Get organized summaries with action items, decisions, and next steps
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 relative">
        <div className="absolute inset-0 gradient-subtle opacity-5"></div>
        <div className="container mx-auto px-4 relative">
          <div className="text-center">
            <div className="flex items-center justify-center space-x-3 mb-8">
              <div className="relative">
                <Sparkles className="h-8 w-8 text-primary" />
                <div className="absolute inset-0 h-8 w-8 rounded-full bg-primary/20 blur-md"></div>
              </div>
              <span className="text-2xl font-bold text-gradient">AI Meeting Assistant</span>
            </div>
            
            <div className="pt-8 border-t border-border/20 text-muted-foreground">
              <p className="text-lg">Built with React, TypeScript, Tailwind CSS, and Vercel</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;