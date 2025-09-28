import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Mic } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

interface TranscriptionSegment {
  id: string;
  speaker: string;
  text: string;
  timestamp: string;
  confidence?: number;
}

interface PaginatedTranscriptionProps {
  transcription: TranscriptionSegment[];
  itemsPerPage?: number;
}

const PaginatedTranscription: React.FC<PaginatedTranscriptionProps> = ({
  transcription,
  itemsPerPage = 5,
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  
  const totalPages = Math.ceil(transcription.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentTranscription = transcription.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  if (transcription.length === 0) {
    return (
      <ScrollArea className="flex-1 w-full">
        <div className="text-center text-muted-foreground py-8">
          <Mic className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Start recording or upload a file to see transcription</p>
        </div>
      </ScrollArea>
    );
  }

  return (
    <div className="flex-1 flex flex-col">
      <ScrollArea className="flex-1 w-full h-[400px]">
        <div className="space-y-4 p-1">
          {currentTranscription.map((segment) => (
            <div
              key={segment.id}
              className="p-4 rounded-lg bg-secondary/20 border border-secondary/30 min-h-[120px] flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-primary">
                    {segment.speaker}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {segment.timestamp}
                  </span>
                </div>
                <p className="text-foreground leading-relaxed">
                  {segment.text}
                </p>
              </div>
              {segment.confidence && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Confidence: {Math.round(segment.confidence * 100)}%
                </div>
              )}
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border/40">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1}-{Math.min(endIndex, transcription.length)} of {transcription.length}
          </div>
          
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => goToPage(pageNum)}
                    className="w-8 h-8 p-0"
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PaginatedTranscription;