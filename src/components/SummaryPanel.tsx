import React, { useState } from 'react';
import { Brain, FileText, Target, CheckCircle, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';

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

interface SummaryPanelProps {
  summary?: MeetingSummary;
  isLoading?: boolean;
}

const SummaryPanel: React.FC<SummaryPanelProps> = ({ summary, isLoading }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCopy = async (text: string, section: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(section);
      setTimeout(() => setCopiedSection(null), 2000);
      toast({
        title: "Copied to clipboard",
        description: `${section} has been copied`,
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleExportSummary = () => {
    if (!summary) return;

    const content = `MEETING SUMMARY
Generated on ${new Date().toLocaleDateString()}

OVERVIEW
${summary.overview}

KEY DECISIONS
${summary.keyDecisions.map((decision, i) => `${i + 1}. ${decision}`).join('\n')}

ACTION ITEMS
${summary.actionItems.map((item, i) => `${i + 1}. ${item.task}${item.assignee ? ` (Assigned to: ${item.assignee})` : ''}${item.dueDate ? ` (Due: ${item.dueDate})` : ''} [Priority: ${item.priority}]`).join('\n')}

KEY TOPICS DISCUSSED
${summary.keyTopics.map((topic, i) => `${i + 1}. ${topic}`).join('\n')}

NEXT STEPS
${summary.nextSteps.map((step, i) => `${i + 1}. ${step}`).join('\n')}`;

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `meeting-summary-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "Summary exported",
      description: "Your meeting summary has been downloaded",
    });
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'text-red-400 bg-red-400/10 border-red-400/20';
      case 'medium': return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20';
      case 'low': return 'text-green-400 bg-green-400/10 border-green-400/20';
      default: return 'text-muted-foreground bg-muted/10 border-muted/20';
    }
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="relative mb-6">
            <Brain className="h-16 w-16 text-primary mx-auto animate-float" />
            <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-primary/20 blur-xl animate-pulse"></div>
          </div>
          <h3 className="text-xl font-semibold mb-3 text-gradient">AI is analyzing your meeting...</h3>
          <p className="text-muted-foreground">This may take a few moments</p>
          <div className="mt-6 w-full bg-secondary/50 rounded-full h-3 overflow-hidden">
            <div className="gradient-primary h-3 rounded-full animate-pulse w-3/5 transition-all duration-2000"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="relative mb-6">
            <Brain className="h-16 w-16 text-muted-foreground/50 mx-auto" />
            <div className="absolute inset-0 h-16 w-16 mx-auto rounded-full bg-muted/10 blur-xl"></div>
          </div>
          <h3 className="text-xl font-semibold mb-3 text-muted-foreground">No summary available</h3>
          <p className="text-muted-foreground">Upload or record audio to generate AI insights</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gradient">AI Summary</h2>
        <Button
          variant="glass"
          onClick={handleExportSummary}
          className="hover-lift"
        >
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      <Tabs defaultValue="overview" className="flex-1 flex flex-col">
        <TabsList className="grid w-full grid-cols-4 mb-6 glass-card">
          <TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger>
          <TabsTrigger value="decisions" className="text-xs">Decisions</TabsTrigger>
          <TabsTrigger value="actions" className="text-xs">Actions</TabsTrigger>
          <TabsTrigger value="topics" className="text-xs">Topics</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0">
          <TabsContent value="overview" className="h-full">
            <div className="glass-card rounded-xl p-6 h-full hover-lift">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <FileText className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">Meeting Overview</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(summary.overview, 'Overview')}
                  className={copiedSection === 'Overview' ? 'text-green-500' : ''}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-muted-foreground leading-relaxed text-base">
                {summary.overview}
              </p>
            </div>
          </TabsContent>

          <TabsContent value="decisions" className="h-full">
            <div className="glass-card rounded-xl p-6 h-full hover-lift">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <CheckCircle className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">Key Decisions</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(summary.keyDecisions.join('\n'), 'Decisions')}
                  className={copiedSection === 'Decisions' ? 'text-green-500' : ''}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-3">
                {summary.keyDecisions.length > 0 ? (
                  summary.keyDecisions.map((decision, index) => (
                    <div key={index} className="p-4 rounded-lg bg-secondary/20 border border-border/30">
                      <div className="flex items-start space-x-3">
                        <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary mt-0.5">
                          {index + 1}
                        </div>
                        <p className="text-foreground leading-relaxed">{decision}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-center py-8">No decisions identified in this meeting</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="actions" className="h-full">
            <div className="glass-card rounded-xl p-6 h-full hover-lift">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Target className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">Action Items</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(summary.actionItems.map(item => `${item.task}${item.assignee ? ` (${item.assignee})` : ''}`).join('\n'), 'Action Items')}
                  className={copiedSection === 'Action Items' ? 'text-green-500' : ''}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-3">
                {summary.actionItems.length > 0 ? (
                  summary.actionItems.map((item) => (
                    <div key={item.id} className="p-4 rounded-lg bg-secondary/20 border border-border/30">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <p className="text-foreground font-medium mb-2">{item.task}</p>
                          <div className="flex items-center space-x-4 text-sm">
                            {item.assignee && (
                              <span className="text-muted-foreground">
                                Assigned to: <span className="text-foreground font-medium">{item.assignee}</span>
                              </span>
                            )}
                            {item.dueDate && (
                              <span className="text-muted-foreground">
                                Due: <span className="text-foreground">{item.dueDate}</span>
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getPriorityColor(item.priority)}`}>
                          {item.priority}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-center py-8">No action items identified in this meeting</p>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="topics" className="h-full">
            <div className="glass-card rounded-xl p-6 h-full hover-lift">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-2">
                  <Brain className="h-5 w-5 text-primary" />
                  <h3 className="font-semibold text-lg">Key Topics & Next Steps</h3>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy([...summary.keyTopics, ...summary.nextSteps].join('\n'), 'Topics & Steps')}
                  className={copiedSection === 'Topics & Steps' ? 'text-green-500' : ''}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="space-y-6">
                <div>
                  <h4 className="font-medium text-primary mb-3">Topics Discussed</h4>
                  <div className="grid gap-2">
                    {summary.keyTopics.length > 0 ? (
                      summary.keyTopics.map((topic, index) => (
                        <div key={index} className="p-3 rounded-lg bg-secondary/20 border border-border/30">
                          <div className="flex items-center space-x-3">
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                              {index + 1}
                            </div>
                            <span className="text-foreground">{topic}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No key topics identified</p>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="font-medium text-primary mb-3">Next Steps</h4>
                  <div className="grid gap-2">
                    {summary.nextSteps.length > 0 ? (
                      summary.nextSteps.map((step, index) => (
                        <div key={index} className="p-3 rounded-lg bg-secondary/20 border border-border/30">
                          <div className="flex items-center space-x-3">
                            <div className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                              {index + 1}
                            </div>
                            <span className="text-foreground">{step}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground">No next steps identified</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
};

export default SummaryPanel;