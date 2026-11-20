"use client";

import * as React from "react";
import { Mic, Square, Trash2, Loader2, RefreshCw, AudioLines } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";

import {
  encodeAudioToBase64,
  formatDuration,
} from "@/lib/audio-handler";
import {
  formatTaskForUi,
  priorityVariant,
} from "@/lib/task-formatter";
import type { Priority, ParsedTask } from "@/lib/nl-parser";

type Mode = "task" | "memo";

interface TaskDto {
  id: string;
  title: string;
  dueAt: string | null;
  priority: string;
  project: string | null;
  contextTags: string[];
  recurrenceRule: string | null;
  rawTranscript: string | null;
  audioPath: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface VoiceMemoDto {
  id: string;
  audioPath: string;
  transcript: string | null;
  durationSec: number;
  createdAt: string;
}

interface StatsDto {
  tasks: number;
  voiceMemos: number;
  transcribed: number;
}

/** Convert a Date to a value usable by <input type="datetime-local">. */
function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function Page() {
  // --- Mode + capture state ---
  const [mode, setMode] = React.useState<Mode>("task");
  const [isRecording, setIsRecording] = React.useState(false);
  const [isTranscribing, setIsTranscribing] = React.useState(false);
  const [isParsing, setIsParsing] = React.useState(false);
  const [recordingSeconds, setRecordingSeconds] = React.useState(0);

  // --- Recording result state ---
  const [recordedBlob, setRecordedBlob] = React.useState<Blob | null>(null);
  const [recordedDurationSec, setRecordedDurationSec] = React.useState(0);
  const [transcript, setTranscript] = React.useState("");
  const [parsedTask, setParsedTask] = React.useState<ParsedTask | null>(null);
  const [parsedSource, setParsedSource] = React.useState<"heuristic" | "llm" | null>(null);

  // --- Editable preview state (task mode) ---
  const [editableTitle, setEditableTitle] = React.useState("");
  const [editableDueAt, setEditableDueAt] = React.useState("");
  const [editablePriority, setEditablePriority] = React.useState<Priority>("medium");
  const [editableProject, setEditableProject] = React.useState("");
  const [editableTags, setEditableTags] = React.useState("");
  const [editableRecurrence, setEditableRecurrence] = React.useState("");

  // --- Sidebar state ---
  const [recentTasks, setRecentTasks] = React.useState<TaskDto[]>([]);
  const [voiceMemos, setVoiceMemos] = React.useState<VoiceMemoDto[]>([]);
  const [stats, setStats] = React.useState<StatsDto>({
    tasks: 0,
    voiceMemos: 0,
    transcribed: 0,
  });
  const [projectFilter, setProjectFilter] = React.useState<string>("");
  const [priorityFilter, setPriorityFilter] = React.useState<string>("");
  const [transcribingMemoId, setTranscribingMemoId] = React.useState<string | null>(
    null,
  );

  // --- Refs (MediaRecorder plumbing) ---
  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = React.useRef<number | null>(null);

  // --- Refresh helpers ---
  const refreshTasks = React.useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (projectFilter) params.set("project", projectFilter);
      if (priorityFilter) params.set("priority", priorityFilter);
      const res = await fetch(`/api/tasks?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load tasks");
      const data = await res.json();
      setRecentTasks(Array.isArray(data.tasks) ? data.tasks : []);
    } catch (e) {
      console.error("[refreshTasks]", e);
    }
  }, [projectFilter, priorityFilter]);

  const refreshMemos = React.useCallback(async () => {
    try {
      const res = await fetch("/api/voice-memos");
      if (!res.ok) throw new Error("Failed to load voice memos");
      const data = await res.json();
      setVoiceMemos(Array.isArray(data.memos) ? data.memos : []);
    } catch (e) {
      console.error("[refreshMemos]", e);
    }
  }, []);

  const refreshStats = React.useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) throw new Error("Failed to load stats");
      const data = await res.json();
      setStats({
        tasks: data.tasks ?? 0,
        voiceMemos: data.voiceMemos ?? 0,
        transcribed: data.transcribed ?? 0,
      });
    } catch (e) {
      console.error("[refreshStats]", e);
    }
  }, []);

  // Initial load
  React.useEffect(() => {
    refreshTasks();
    refreshMemos();
    refreshStats();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fetch tasks when filters change
  React.useEffect(() => {
    refreshTasks();
  }, [refreshTasks]);

  // --- Recording helpers ---
  const discardRecording = React.useCallback(() => {
    setRecordedBlob(null);
    setRecordedDurationSec(0);
    setTranscript("");
    setParsedTask(null);
    setParsedSource(null);
    setEditableTitle("");
    setEditableDueAt("");
    setEditablePriority("medium");
    setEditableProject("");
    setEditableTags("");
    setEditableRecurrence("");
  }, []);

  const stopRecording = React.useCallback(() => {
    if (!isRecording) return;
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [isRecording]);

  const transcribeAndParse = React.useCallback(
    async (blob: Blob) => {
      try {
        setIsTranscribing(true);
        toast.info("Transcribing audio...");
        const base64 = await encodeAudioToBase64(blob);
        const res = await fetch("/api/transcribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audioBase64: base64 }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Transcribe failed (${res.status})`);
        }
        const data = await res.json();
        const t: string = data.transcript ?? "";
        setTranscript(t);
        toast.success("Transcript ready");
        setIsTranscribing(false);

        if (!t.trim()) {
          toast.error("Empty transcript — try speaking louder.");
          return;
        }

        setIsParsing(true);
        toast.info("Parsing task...");
        const parseRes = await fetch("/api/parse-task", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: t }),
        });
        if (!parseRes.ok) {
          const err = await parseRes.json().catch(() => ({}));
          throw new Error(err.error || `Parse failed (${parseRes.status})`);
        }
        const parsed = await parseRes.json();
        const task: ParsedTask = parsed.task;
        const source: "heuristic" | "llm" = parsed.source;
        setParsedTask(task);
        setParsedSource(source);
        setEditableTitle(task.title || "");
        setEditableDueAt(
          task.dueAt ? toLocalDateTimeInput(new Date(task.dueAt)) : "",
        );
        setEditablePriority(task.priority || "medium");
        setEditableProject(task.project || "");
        setEditableTags((task.contextTags ?? []).join(", "));
        setEditableRecurrence(task.recurrenceRule || "");
        setIsParsing(false);
        toast.success(
          `Task parsed via ${source === "llm" ? "LLM fallback" : "heuristic parser"}`,
        );
      } catch (e) {
        setIsTranscribing(false);
        setIsParsing(false);
        const msg = (e as Error).message;
        toast.error(msg);
        console.error("[transcribeAndParse]", e);
      }
    },
    [],
  );

  const startRecording = React.useCallback(async () => {
    if (isRecording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("Audio recording is not supported in this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      mr.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        const duration =
          (Date.now() - (startTimeRef.current ?? Date.now())) / 1000;
        setRecordedDurationSec(duration);
        if (duration < 0.5) {
          toast.error("Recording too short — try holding longer.");
          discardRecording();
          return;
        }
        setRecordedBlob(blob);
        if (mode === "task") {
          transcribeAndParse(blob);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingSeconds(0);
      timerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (e) {
      toast.error(`Microphone error: ${(e as Error).message}`);
      console.error("[startRecording]", e);
    }
  }, [discardRecording, isRecording, mode, transcribeAndParse]);

  // --- Save handlers ---
  const saveTask = React.useCallback(async () => {
    if (!editableTitle.trim()) {
      toast.error("Title is required.");
      return;
    }
    try {
      const body = {
        title: editableTitle.trim(),
        dueAt: editableDueAt
          ? new Date(editableDueAt).toISOString()
          : null,
        priority: editablePriority,
        project: editableProject.trim() || null,
        contextTags: editableTags
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
        recurrenceRule: editableRecurrence.trim() || null,
        rawTranscript: transcript || null,
        source: "voice",
      };
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      toast.success("Task saved.");
      discardRecording();
      refreshTasks();
      refreshMemos();
      refreshStats();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [
    discardRecording,
    editableDueAt,
    editablePriority,
    editableProject,
    editableRecurrence,
    editableTags,
    editableTitle,
    refreshMemos,
    refreshStats,
    refreshTasks,
    transcript,
  ]);

  const saveMemo = React.useCallback(async () => {
    if (!recordedBlob) return;
    try {
      const base64 = await encodeAudioToBase64(recordedBlob);
      const res = await fetch("/api/voice-memos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: base64,
          durationSec: recordedDurationSec,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Save failed (${res.status})`);
      }
      toast.success("Voice memo saved.");
      discardRecording();
      refreshMemos();
      refreshStats();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [discardRecording, recordedBlob, recordedDurationSec, refreshMemos, refreshStats]);

  const transcribeMemo = React.useCallback(
    async (id: string) => {
      setTranscribingMemoId(id);
      try {
        const res = await fetch(`/api/voice-memos/${id}/transcribe`, {
          method: "POST",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Transcribe failed (${res.status})`);
        }
        toast.success("Memo transcribed.");
        refreshMemos();
        refreshStats();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setTranscribingMemoId(null);
      }
    },
    [refreshMemos, refreshStats],
  );

  const deleteTask = React.useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Delete failed (${res.status})`);
        }
        toast.success("Task deleted.");
        refreshTasks();
        refreshStats();
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [refreshStats, refreshTasks],
  );

  // --- Mode switch — discard any in-progress recording/preview ---
  const onModeChange = React.useCallback(
    (v: string) => {
      if (isRecording) stopRecording();
      discardRecording();
      setMode(v as Mode);
    },
    [discardRecording, isRecording, stopRecording],
  );

  // --- Derived ---
  const uniqueProjects = React.useMemo(() => {
    const set = new Set<string>();
    recentTasks.forEach((t) => {
      if (t.project) set.add(t.project);
    });
    return Array.from(set).sort();
  }, [recentTasks]);

  const showInitialButton =
    !isRecording &&
    !isTranscribing &&
    !isParsing &&
    !parsedTask &&
    !recordedBlob;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Mic className="size-5 shrink-0" />
            <h1 className="text-base sm:text-lg font-semibold truncate">Voice-to-Task</h1>
            <Badge variant="secondary" className="hidden sm:inline-flex shrink-0">
              {stats.tasks} tasks · {stats.voiceMemos} memos · {stats.transcribed} transcribed
            </Badge>
          </div>
          <Tabs value={mode} onValueChange={onModeChange}>
            <TabsList>
              <TabsTrigger value="task" className="px-3">
                <Mic className="size-3.5" /> Task
              </TabsTrigger>
              <TabsTrigger value="memo" className="px-3">
                <AudioLines className="size-3.5" /> Voice memo
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_22rem] gap-4 p-4">
        {/* Capture panel */}
        <section
          className="flex flex-col items-center justify-center min-h-[60vh] lg:min-h-[calc(100vh-8rem)] gap-4"
          aria-label="Capture panel"
        >
          {showInitialButton && (
            <>
              <button
                type="button"
                onPointerDown={startRecording}
                onPointerUp={stopRecording}
                onPointerLeave={stopRecording}
                onPointerCancel={stopRecording}
                aria-label="Hold to record"
                className="select-none touch-none rounded-full w-56 h-56 sm:w-64 sm:h-64 text-base sm:text-lg font-medium bg-primary text-primary-foreground hover:opacity-90 active:scale-95 transition-all border-4 border-ring/30 shadow-lg"
              >
                Hold to record
              </button>
              <p className="text-sm text-muted-foreground text-center max-w-sm">
                Press and hold to capture. Release to stop. In <strong>Task</strong> mode the
                audio is transcribed and parsed into an editable task. In <strong>Voice memo</strong>{" "}
                mode it is saved raw for later transcription.
              </p>
            </>
          )}

          {isRecording && (
            <>
              <button
                type="button"
                onPointerUp={stopRecording}
                onPointerLeave={stopRecording}
                onPointerCancel={stopRecording}
                aria-label="Release to stop recording"
                className="select-none touch-none rounded-full w-56 h-56 sm:w-64 sm:h-64 text-base sm:text-lg font-medium bg-destructive text-white active:scale-95 transition-all border-4 border-destructive/40 shadow-lg"
              >
                <span className="flex flex-col items-center gap-2">
                  <Square className="size-7 fill-current" />
                  Release to stop
                </span>
              </button>
              <div
                className="flex items-end gap-1 h-12"
                aria-hidden="true"
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <div
                    key={i}
                    className="vtt-bar bg-destructive w-1.5 h-full rounded-full"
                  />
                ))}
              </div>
              <p className="text-2xl font-mono tabular-nums">
                {formatDuration(recordingSeconds)}
              </p>
            </>
          )}

          {(isTranscribing || isParsing) && (
            <div
              className="flex flex-col items-center gap-4"
              role="status"
              aria-live="polite"
            >
              <Loader2 className="size-12 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {isTranscribing
                  ? "Transcribing audio..."
                  : "Parsing task with heuristic + LLM fallback..."}
              </p>
            </div>
          )}

          {parsedTask && mode === "task" && !isTranscribing && !isParsing && (
            <Card className="w-full max-w-xl">
              <CardHeader>
                <CardTitle className="text-base">Parsed task</CardTitle>
                <CardDescription>
                  Source:{" "}
                  {parsedSource === "llm" ? "LLM fallback" : "heuristic parser"}{" "}
                  · review and edit before saving.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="title">Title</Label>
                  <Input
                    id="title"
                    value={editableTitle}
                    onChange={(e) => setEditableTitle(e.target.value)}
                    placeholder="Task title"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="dueAt">Due date</Label>
                    <Input
                      id="dueAt"
                      type="datetime-local"
                      value={editableDueAt}
                      onChange={(e) => setEditableDueAt(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>Priority</Label>
                    <Select
                      value={editablePriority}
                      onValueChange={(v) =>
                        setEditablePriority(v as Priority)
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="project">Project</Label>
                    <Input
                      id="project"
                      value={editableProject}
                      onChange={(e) => setEditableProject(e.target.value)}
                      placeholder="work, personal, ..."
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="recurrence">Recurrence</Label>
                    <Input
                      id="recurrence"
                      value={editableRecurrence}
                      onChange={(e) => setEditableRecurrence(e.target.value)}
                      placeholder="weekly:Sunday, daily, interval:3:week"
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="tags">Tags (comma-separated)</Label>
                  <Input
                    id="tags"
                    value={editableTags}
                    onChange={(e) => setEditableTags(e.target.value)}
                    placeholder="client, weekly, ..."
                  />
                </div>
                {transcript && (
                  <div className="text-xs text-muted-foreground italic border-l-2 border-border pl-2">
                    Transcript: &ldquo;{transcript}&rdquo;
                  </div>
                )}
              </CardContent>
              <CardFooter className="gap-2">
                <Button onClick={saveTask}>Save task</Button>
                <Button variant="outline" onClick={discardRecording}>
                  Discard
                </Button>
              </CardFooter>
            </Card>
          )}

          {recordedBlob && mode === "memo" && !isRecording && (
            <Card className="w-full max-w-xl">
              <CardHeader>
                <CardTitle className="text-base">Voice memo ready</CardTitle>
                <CardDescription>
                  Duration: {formatDuration(recordedDurationSec)} · saved raw,
                  no parsing.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <audio
                  src={URL.createObjectURL(recordedBlob)}
                  controls
                  className="w-full"
                />
              </CardContent>
              <CardFooter className="gap-2">
                <Button onClick={saveMemo}>Save memo</Button>
                <Button variant="outline" onClick={discardRecording}>
                  Discard
                </Button>
              </CardFooter>
            </Card>
          )}
        </section>

        {/* Sidebar */}
        <aside
          className="flex flex-col gap-4 lg:max-h-[calc(100vh-8rem)] lg:overflow-hidden"
          aria-label="Sidebar"
        >
          {/* Stats */}
          <Card className="py-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">At a glance</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-2 text-center">
              <div>
                <div className="text-2xl font-bold tabular-nums">
                  {stats.tasks}
                </div>
                <div className="text-xs text-muted-foreground">tasks</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums">
                  {stats.voiceMemos}
                </div>
                <div className="text-xs text-muted-foreground">memos</div>
              </div>
              <div>
                <div className="text-2xl font-bold tabular-nums">
                  {stats.transcribed}
                </div>
                <div className="text-xs text-muted-foreground">transcribed</div>
              </div>
            </CardContent>
          </Card>

          {/* Recent tasks */}
          <Card className="py-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Recent tasks</CardTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={refreshTasks}
                aria-label="Refresh tasks"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Select
                  value={projectFilter || "__all"}
                  onValueChange={(v) =>
                    setProjectFilter(v === "__all" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-full h-8" size="sm">
                    <SelectValue placeholder="All projects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">All projects</SelectItem>
                    {uniqueProjects.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={priorityFilter || "__all"}
                  onValueChange={(v) =>
                    setPriorityFilter(v === "__all" ? "" : v)
                  }
                >
                  <SelectTrigger className="w-full h-8" size="sm">
                    <SelectValue placeholder="Any priority" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">Any priority</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <ScrollArea className="max-h-72 overflow-y-auto vtt-scroll -mx-1 px-1">
                {recentTasks.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No tasks yet. Hold the button to capture one.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {recentTasks.map((t) => {
                      const fmt = formatTaskForUi({
                        title: t.title,
                        dueAt: t.dueAt,
                        priority: t.priority,
                        project: t.project,
                        contextTags: t.contextTags,
                        recurrenceRule: t.recurrenceRule,
                      });
                      return (
                        <li
                          key={t.id}
                          className="flex items-start gap-2 rounded-md border p-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {t.title}
                            </div>
                            <div className="flex flex-wrap gap-1 mt-1">
                              <Badge
                                variant={priorityVariant(t.priority)}
                                className="text-[10px]"
                              >
                                {fmt.priorityDisplay}
                              </Badge>
                              {t.project && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  /{t.project}
                                </Badge>
                              )}
                              {t.dueAt && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {fmt.dueAtDisplay}
                                </Badge>
                              )}
                              {t.recurrenceRule && (
                                <Badge
                                  variant="secondary"
                                  className="text-[10px]"
                                >
                                  {fmt.recurrenceDisplay}
                                </Badge>
                              )}
                              {t.contextTags?.map((tag) => (
                                <Badge
                                  key={tag}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  #{tag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteTask(t.id)}
                            aria-label={`Delete task ${t.title}`}
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Voice memos */}
          <Card className="py-4">
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">Voice memos</CardTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={refreshMemos}
                aria-label="Refresh voice memos"
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-72 overflow-y-auto vtt-scroll -mx-1 px-1">
                {voiceMemos.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">
                    No voice memos. Switch to Voice memo mode and record.
                  </div>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {voiceMemos.map((m) => (
                      <li
                        key={m.id}
                        className="flex items-start gap-2 rounded-md border p-2"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground">
                            {new Date(m.createdAt).toLocaleString()} ·{" "}
                            {formatDuration(m.durationSec)}
                          </div>
                          <div className="text-sm mt-1 break-words">
                            {m.transcript ? (
                              <span className="italic">
                                &ldquo;{m.transcript}&rdquo;
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                Not transcribed
                              </span>
                            )}
                          </div>
                        </div>
                        {!m.transcript && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={transcribingMemoId === m.id}
                            onClick={() => transcribeMemo(m.id)}
                          >
                            {transcribingMemoId === m.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              "Transcribe"
                            )}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </aside>
      </main>

      {/* Footer */}
      <footer className="border-t mt-auto px-4 py-2 text-xs text-muted-foreground text-center">
        Voice-to-Task — local-first. Mic audio is processed via z-ai ASR +
        heuristic parser with LLM fallback.
      </footer>
    </div>
  );
}
