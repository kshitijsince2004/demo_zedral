export type Tone = "success" | "warning" | "info" | "destructive" | "purple" | "muted" | "accent";

export const toneText: Record<Tone, string> = {
  success: "text-success",
  warning: "text-warning",
  info: "text-info",
  destructive: "text-destructive",
  purple: "text-purple",
  muted: "text-muted-foreground",
  accent: "text-accent-foreground",
};

export const toneBg: Record<Tone, string> = {
  success: "bg-success/10",
  warning: "bg-warning/15",
  info: "bg-info/10",
  destructive: "bg-destructive/10",
  purple: "bg-purple/10",
  muted: "bg-muted",
  accent: "bg-accent/10",
};

export const toneBorder: Record<Tone, string> = {
  success: "border-success/30",
  warning: "border-warning/40",
  info: "border-info/30",
  destructive: "border-destructive/30",
  purple: "border-purple/30",
  muted: "border-border",
  accent: "border-accent/40",
};

export const toneRail: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  info: "bg-info",
  destructive: "bg-destructive",
  purple: "bg-purple",
  muted: "bg-muted-foreground",
  accent: "bg-accent",
};
