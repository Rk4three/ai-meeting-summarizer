import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, File, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  isProcessing?: boolean;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, isProcessing }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      // Check file size (max 100MB)
      if (file.size > 100 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select a file smaller than 100MB",
          variant: "destructive",
        });
        return;
      }

      setSelectedFile(file);
      onFileSelect(file);
      toast({
        title: "File uploaded",
        description: `${file.name} is ready for processing`,
      });
    }
  }, [onFileSelect, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'audio/*': ['.mp3', '.wav', '.m4a', '.flac'],
      'video/*': ['.mp4', '.mov', '.avi', '.mkv'],
    },
    multiple: false,
  });

  const removeFile = () => {
    setSelectedFile(null);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="w-full">
      {!selectedFile ? (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 hover-lift ${
            isDragActive 
              ? 'border-primary bg-primary/5 glow-shadow gradient-subtle' 
              : 'border-border hover:border-primary/50 hover:bg-primary/5'
          }`}
        >
          <input {...getInputProps()} />
          <div className="relative mb-6">
            <Upload className="mx-auto h-16 w-16 text-primary" />
            <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-primary/20 blur-xl opacity-50"></div>
          </div>
          <h3 className="text-xl font-bold mb-3 text-gradient">
            {isDragActive ? 'Drop your file here' : 'Upload your meeting file'}
          </h3>
          <p className="text-muted-foreground mb-6 text-lg">
            Drag & drop an audio or video file, or click to browse
          </p>
          <p className="text-sm text-muted-foreground mb-6">
            Supports MP3, WAV, MP4, MOV (up to 100MB)
          </p>
          <Button variant="premium" className="interactive-scale">
            <Upload className="h-5 w-5 mr-2" />
            Select File
          </Button>
        </div>
      ) : (
        <div className="rounded-2xl p-6 border border-border/50 bg-card hover-lift">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <div className="relative">
                <File className="h-10 w-10 text-primary" />
                <div className="absolute inset-0 h-10 w-10 rounded-full bg-primary/20 blur-md"></div>
              </div>
              <div>
                <h4 className="font-semibold text-lg">{selectedFile.name}</h4>
                <p className="text-sm text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            {!isProcessing && (
              <Button
                variant="ghost"
                size="icon"
                onClick={removeFile}
                className="text-muted-foreground hover:text-foreground hover-lift"
              >
                <X className="h-5 w-5" />
              </Button>
            )}
          </div>
          
          {isProcessing && (
            <div className="mt-6">
              <div className="flex items-center space-x-3 text-sm text-muted-foreground mb-3">
                <div className="animate-pulse-glow w-3 h-3 bg-primary rounded-full"></div>
                <span className="font-medium">Processing your file...</span>
              </div>
              <div className="w-full bg-secondary/50 rounded-full h-3 overflow-hidden">
                <div className="gradient-primary h-3 rounded-full animate-pulse w-2/5 transition-all duration-1000"></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default FileUpload;