# 3-Day Sprint Plan: AI Interview Platform MVP

**Objective**: Fully functioning E2E platform (localhost demo) by EOD Wednesday with ALL core features
**Team**: 1 full-stack developer
**Stack**: NextJS 14 + Supabase + TailwindCSS + SendGrid (email)
**Scope**: Admin → Org → Candidate → Assessment → Interview → Decision + Email + Recording + AI Reports + Excel Export

---

## 🎯 Critical Success Factors

1. **NO auth complexity** - Mock user by ID in localStorage
2. **Mock AI** - Return realistic-sounding hardcoded Q&A scores
3. **Email logging** - SendGrid mock (console logs + DB records)
4. **Recording mock** - Placeholder video blob, no real processing
5. **Proctoring flags** - Tab-switch detection + console logging
6. **Happy path + happy sad paths** - Handle no-show, abandoned attempts
7. **Use components** - Shadcn UI buttons/forms pre-built
8. **Localhost only** - No deployment overhead

---

## 📅 DAY 1: BACKEND FOUNDATION (8 hours)

### Hour 0-1: Setup

```bash
# Create project
npx create-next-app@latest vip --typescript --tailwind --supabase
cd vip

# Install deps
npm install @supabase/supabase-js @supabase/auth-helpers-nextjs uuid

# Create Supabase project locally (optional)
npx supabase init
npx supabase start
```

### Hour 1-2: Seed Database

**Tasks:**
1. Export schema from `00_DATABASE_SCHEMA.sql` → Supabase
2. Seed mock data:
   - 1 organization (TechCorp)
   - 1 HR user (hr@techcorp.com / password: demo123)
   - 1 job (Senior Engineer)
   - 1 interview (scheduled: tomorrow 10:00 AM UTC)
   - 3 interview slots
   - 1 assessment question set with 10 MCQ
   - 1 fallback question set

**File**: `sql/seed.sql`

```sql
-- Copy from schema, then add INSERT statements below
INSERT INTO organizations (name, email) VALUES ('TechCorp Inc', 'hr@techcorp.com');
INSERT INTO users (auth_id, email, role, organization_id) VALUES ('mock-uuid-1', 'hr@techcorp.com', 'HR', 1);
-- ... etc
```

### Hour 2-3: Supabase Client Setup

**File**: `lib/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGc...';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Helper functions for quick data access
export async function getCurrentUser() {
  // For MVP: return mock user from localStorage
  const userId = localStorage.getItem('userId') || 'hr-user-1';
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', parseInt(userId))
    .single();
  return data;
}

export async function getInterview(id: number) {
  const { data } = await supabase
    .from('interviews')
    .select('*, jobs(*), interview_slots(*)')
    .eq('id', id)
    .single();
  return data;
}

export async function getApplications(interviewId: number) {
  const { data } = await supabase
    .from('applications')
    .select('*, assessment_attempts(*), interview_sessions(*), ai_reports(*), hr_decisions(*)')
    .eq('interview_id', interviewId);
  return data;
}
```

### Hour 3-5: Interview CRUD Endpoints

**File**: `app/api/interviews/[id]/route.ts`

```typescript
import { supabase } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const interview = await supabase
    .from('interviews')
    .select('*, jobs(*), interview_slots(*), assessment_question_sets(*)')
    .eq('id', params.id)
    .single();
  return NextResponse.json(interview.data);
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const body = await req.json();
  const { data } = await supabase
    .from('interviews')
    .update(body)
    .eq('id', params.id)
    .select();
  return NextResponse.json(data);
}

// POST /api/interviews → create
// POST /api/interviews/[id]/publish → publish interview
// POST /api/interviews/[id]/questions → add question
```

### Hour 5-7: Application Form Endpoint

**File**: `app/api/apply/route.ts`

```typescript
export async function POST(req: NextRequest) {
  const { interview_id, candidate_name, candidate_email, candidate_phone, slot_preferences } = await req.json();

  // Save application
  const { data: app } = await supabase
    .from('applications')
    .insert({
      interview_id,
      candidate_name,
      candidate_email,
      candidate_phone,
      status: 'APPLIED'
    })
    .select()
    .single();

  // Save slot preferences
  for (let i = 0; i < slot_preferences.length; i++) {
    await supabase
      .from('application_slot_preferences')
      .insert({
        application_id: app.id,
        preference_rank: i + 1,
        preferred_slot_id: slot_preferences[i]
      });
  }

  return NextResponse.json({ success: true, application_id: app.id });
}
```

### Hour 7-8: Mock Auth + Context

**File**: `lib/auth-context.tsx`

```typescript
'use client';
import { createContext, useContext, useState } from 'react';

interface User {
  id: number;
  email: string;
  role: 'ADMIN' | 'ORG_ADMIN' | 'HR';
  organization_id: number;
}

const AuthContext = createContext<{ user: User | null; login: (id: number) => void }>({
  user: null,
  login: () => {}
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = (userId: number) => {
    // Mock: hardcode user from DB
    localStorage.setItem('userId', userId.toString());
    setUser({ id: userId, email: 'hr@techcorp.com', role: 'HR', organization_id: 1 });
  };

  return <AuthContext.Provider value={{ user, login }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
```

**EOD Day 1: Supabase DB + 5 API endpoints + mock auth working ✓**

---

## 📅 DAY 2: FRONTEND + CORE E2E (12 hours)

### Hour 0-2: HR Dashboard + Interview Builder (Enhanced)

**File**: `app/dashboard/page.tsx`

```typescript
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import InterviewForm from '@/components/InterviewForm';

export default async function DashboardPage() {
  const user = { id: 1, role: 'HR' }; // Mock

  const { data: interviews } = await supabase
    .from('interviews')
    .select('*')
    .eq('organization_id', 1);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">HR Dashboard</h1>
      <InterviewForm />
      <div className="mt-8">
        {interviews?.map(i => (
          <div key={i.id} className="border p-4 rounded mb-4">
            <h2>{i.title}</h2>
            <p>Status: {i.status}</p>
            <button className="btn">Edit</button>
            <button className="btn">View Candidates</button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### Hour 2-3: Candidate Application Form

**File**: `app/interviews/[id]/apply/page.tsx`

```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ApplyPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    slots: [] as number[]
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/apply', {
      method: 'POST',
      body: JSON.stringify({
        interview_id: params.id,
        candidate_name: form.name,
        candidate_email: form.email,
        candidate_phone: form.phone,
        slot_preferences: form.slots
      })
    });
    const data = await res.json();
    router.push(`/assessment/${data.application_id}`);
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-8">
      <input
        type="text"
        placeholder="Full Name"
        value={form.name}
        onChange={e => setForm({ ...form, name: e.target.value })}
        className="block w-full mb-4 border p-2"
      />
      <input
        type="email"
        placeholder="Email"
        value={form.email}
        onChange={e => setForm({ ...form, email: e.target.value })}
        className="block w-full mb-4 border p-2"
      />
      <button type="submit" className="bg-blue-500 text-white px-4 py-2 rounded">
        Apply
      </button>
    </form>
  );
}
```

### Hour 3-5: Assessment Page (MCQ + Timer)

**File**: `app/assessment/[id]/page.tsx`

```typescript
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Timer from '@/components/Timer';

export default function AssessmentPage({ params }: { params: { id: string } }) {
  const [application, setApplication] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [responses, setResponses] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Get application
      const { data: app } = await supabase
        .from('applications')
        .select('*, interviews(*)')
        .eq('id', params.id)
        .single();

      setApplication(app);

      // Create assessment attempt
      const token = Math.random().toString(36).substring(7);
      const { data: att } = await supabase
        .from('assessment_attempts')
        .insert({
          application_id: params.id,
          started_at: new Date().toISOString(),
          status: 'ASSESSMENT_IN_PROGRESS',
          session_token: token,
          session_valid_from: new Date().toISOString(),
          session_valid_until: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      setAttempt(att);

      // Get questions (shuffle)
      const { data: qs } = await supabase
        .from('assessment_questions')
        .select('*')
        .eq('question_set_id', app.interviews.question_set_id);

      setQuestions(qs || []);
    };

    init();
  }, [params.id]);

  const handleSubmit = async () => {
    // Calculate score
    let correct = 0;
    questions.forEach(q => {
      const selected = responses[q.id];
      const option = q.options.find((o: any) => o.label === selected);
      if (option?.is_correct) correct++;
    });

    const score = (correct / questions.length) * 100;

    // Save responses + score
    for (const qId in responses) {
      await supabase
        .from('assessment_responses')
        .insert({
          assessment_attempt_id: attempt.id,
          question_id: qId,
          selected_option_label: responses[qId],
          is_correct: questions.find(q => q.id === parseInt(qId))?.options.find(
            (o: any) => o.label === responses[qId]
          )?.is_correct
        });
    }

    // Update attempt
    await supabase
      .from('assessment_attempts')
      .update({ submitted_at: new Date().toISOString(), status: 'COMPLETED', score })
      .eq('id', attempt.id);

    setSubmitted(true);
  };

  if (!application) return <div>Loading...</div>;
  if (submitted) return <div className="p-8 text-center"><h1>Assessment Complete!</h1></div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex justify-between mb-8">
        <h1 className="text-2xl font-bold">Assessment</h1>
        <Timer seconds={20 * 60} onEnd={handleSubmit} />
      </div>

      {questions.map((q, i) => (
        <div key={q.id} className="mb-8 border p-4 rounded">
          <h3 className="font-bold mb-4">Q{i + 1}: {q.question_text}</h3>
          {q.options.map((opt: any) => (
            <label key={opt.label} className="block mb-2">
              <input
                type="radio"
                name={`q${q.id}`}
                value={opt.label}
                checked={responses[q.id] === opt.label}
                onChange={e => setResponses({ ...responses, [q.id]: e.target.value })}
                className="mr-2"
              />
              {opt.label}: {opt.text}
            </label>
          ))}
        </div>
      ))}

      <button onClick={handleSubmit} className="bg-green-500 text-white px-6 py-2 rounded">
        Submit Assessment
      </button>
    </div>
  );
}
```

### Hour 5-6: Interview Session (Q&A)

**File**: `app/interview/[id]/page.tsx`

```typescript
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import Timer from '@/components/Timer';

const HARDCODED_QUESTIONS = [
  'Tell me about your most complex project.',
  'How do you handle tight deadlines?',
  'Describe a time you learned a new technology.',
  'What are your career goals?'
];

export default function InterviewPage({ params }: { params: { id: string } }) {
  const [session, setSession] = useState<any>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const init = async () => {
      // Get assessment attempt to link interview
      const { data: app } = await supabase
        .from('applications')
        .select('*, assessment_attempts(*)')
        .eq('id', params.id)
        .single();

      const token = Math.random().toString(36).substring(7);
      const { data: sess } = await supabase
        .from('interview_sessions')
        .insert({
          application_id: params.id,
          assessment_attempt_id: app.assessment_attempts[0].id,
          started_at: new Date().toISOString(),
          status: 'INTERVIEW_IN_PROGRESS',
          session_token: token,
          session_valid_from: new Date().toISOString(),
          session_valid_until: new Date(Date.now() + 80 * 60 * 1000).toISOString()
        })
        .select()
        .single();

      setSession(sess);
    };

    init();
  }, [params.id]);

  const handleNext = async () => {
    // Save response
    await supabase
      .from('interview_responses')
      .insert({
        interview_session_id: session.id,
        question_text: HARDCODED_QUESTIONS[currentQIndex],
        candidate_answer: answer,
        asked_at: new Date().toISOString(),
        answered_at: new Date().toISOString()
      });

    if (currentQIndex < HARDCODED_QUESTIONS.length - 1) {
      setCurrentQIndex(currentQIndex + 1);
      setAnswer('');
    } else {
      // End interview
      await supabase
        .from('interview_sessions')
        .update({ ended_at: new Date().toISOString(), status: 'COMPLETED' })
        .eq('id', session.id);

      setSubmitted(true);
    }
  };

  if (!session) return <div>Initializing...</div>;
  if (submitted) return <div className="p-8 text-center"><h1>Interview Complete! Results coming soon.</h1></div>;

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="flex justify-between mb-8">
        <h1 className="text-2xl font-bold">Interview</h1>
        <Timer seconds={40 * 60} onEnd={handleNext} />
      </div>

      <div className="mb-8 p-4 bg-gray-100 rounded">
        <p className="text-sm text-gray-600 mb-2">
          Question {currentQIndex + 1} of {HARDCODED_QUESTIONS.length}
        </p>
        <h2 className="text-lg font-bold">{HARDCODED_QUESTIONS[currentQIndex]}</h2>
      </div>

      <textarea
        value={answer}
        onChange={e => setAnswer(e.target.value)}
        placeholder="Type your answer here..."
        className="w-full h-32 border p-4 rounded mb-4"
      />

      <button
        onClick={handleNext}
        className="bg-blue-500 text-white px-6 py-2 rounded"
      >
        {currentQIndex === HARDCODED_QUESTIONS.length - 1 ? 'Finish' : 'Next'}
      </button>
    </div>
  );
}
```

### Hour 6-7: HR Evaluation Dashboard

**File**: `app/candidates/[interviewId]/page.tsx`

```typescript
export default async function CandidatesPage({ params }: { params: { interviewId: string } }) {
  const { data: apps } = await supabase
    .from('applications')
    .select(`
      *,
      assessment_attempts(score),
      interview_sessions(score),
      hr_decisions(*)
    `)
    .eq('interview_id', params.interviewId);

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Candidates</h1>
      <table className="w-full border-collapse border">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2 text-left">Name</th>
            <th className="border p-2">Assessment Score</th>
            <th className="border p-2">Interview Score</th>
            <th className="border p-2">Decision</th>
            <th className="border p-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {apps?.map(app => (
            <tr key={app.id} className="border">
              <td className="border p-2">{app.candidate_name}</td>
              <td className="border p-2 text-center">{app.assessment_attempts[0]?.score.toFixed(1)}%</td>
              <td className="border p-2 text-center">{app.interview_sessions[0]?.score?.toFixed(1) || 'N/A'}</td>
              <td className="border p-2 text-center">{app.hr_decisions[0]?.decision || 'Pending'}</td>
              <td className="border p-2 text-center">
                <a href={`/candidates/${app.id}`} className="text-blue-500 underline">
                  View
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

### Hour 7-8: Decision Page + Mock Email

**File**: `app/candidates/[id]/page.tsx`

```typescript
'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function CandidateDetailPage({ params }: { params: { id: string } }) {
  const [decision, setDecision] = useState<'ACCEPT' | 'REJECT' | null>(null);

  const handleDecide = async (choice: 'ACCEPT' | 'REJECT') => {
    // Save decision
    await supabase
      .from('hr_decisions')
      .insert({
        application_id: params.id,
        decision: choice,
        decided_by: 1,
        notes: ''
      });

    // Mock email
    console.log(`📧 EMAIL SENT: ${choice} email to candidate`);

    setDecision(choice);
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Candidate Details</h1>

      {decision ? (
        <div className="bg-green-100 border border-green-300 p-4 rounded text-center">
          <p>Decision saved: {decision}</p>
          <p className="text-sm text-gray-600">Email logged to console</p>
        </div>
      ) : (
        <div className="flex gap-4">
          <button
            onClick={() => handleDecide('ACCEPT')}
            className="bg-green-500 text-white px-6 py-3 rounded font-bold"
          >
            ✓ Accept
          </button>
          <button
            onClick={() => handleDecide('REJECT')}
            className="bg-red-500 text-white px-6 py-3 rounded font-bold"
          >
            ✗ Reject
          </button>
        </div>
      )}
    </div>
  );
}
```

**EOD Day 2: Full E2E flow, decisions working ✓**

---

## 📅 DAY 3: POLISH + ADVANCED FEATURES (12 hours)

### Hour 0-2: Email Notification System

**File**: `lib/email.ts`

```typescript
import nodemailer from 'nodemailer';

// For MVP: use Ethereal Email (fake SMTP) or log to console
const transporter = nodemailer.createTransport({
  host: 'localhost',
  port: 1025, // Mailhog on docker
  secure: false
});

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  eventType: string
) {
  try {
    const info = await transporter.sendMail({
      from: 'noreply@vip.com',
      to,
      subject,
      html
    });
    console.log(`✉️  EMAIL [${eventType}]: ${to} - ${subject}`);
    
    // Log to DB for later viewing
    const { supabase } = require('./supabase');
    await supabase
      .from('notification_deliveries')
      .insert({
        event_type: eventType,
        recipient_email: to,
        subject,
        body: html,
        status: 'SENT',
        sent_at: new Date().toISOString()
      });

    return info;
  } catch (error) {
    console.error(`❌ EMAIL FAILED:`, error);
    return null;
  }
}

// Email templates
export const emailTemplates = {
  orgApproved: (orgName: string) => ({
    subject: `Welcome to VIP - ${orgName} Approved`,
    html: `<h1>Welcome to Virtual Interview Platform!</h1><p>Your organization has been approved.</p>`
  }),
  
  interviewPublished: (jobTitle: string, interviewUrl: string) => ({
    subject: `New Interview: ${jobTitle}`,
    html: `<h1>${jobTitle} Interview</h1><p><a href="${interviewUrl}">Apply here</a></p>`
  }),

  candidateApplied: (candidateName: string) => ({
    subject: `Application Received - VIP`,
    html: `<h1>Thanks for applying, ${candidateName}!</h1><p>We'll assign you a slot soon.</p>`
  }),

  slotAssigned: (candidateName: string, slotTime: string) => ({
    subject: `Assessment Scheduled`,
    html: `<h1>Your assessment is scheduled!</h1><p>Time: ${slotTime}</p>`
  }),

  assessmentReminder: (candidateName: string, slotTime: string) => ({
    subject: `Reminder: Assessment in 1 hour`,
    html: `<h1>Quick reminder, ${candidateName}!</h1><p>Your assessment starts at ${slotTime}</p>`
  }),

  interviewReminder: (candidateName: string, slotTime: string) => ({
    subject: `Reminder: Interview in 1 hour`,
    html: `<h1>Quick reminder, ${candidateName}!</h1><p>Your interview starts at ${slotTime}</p>`
  }),

  assessmentComplete: (candidateName: string, score: number) => ({
    subject: `Assessment Completed - Score: ${score}%`,
    html: `<h1>Great job!</h1><p>Your score: ${score}%</p><p>Proceeding to interview...</p>`
  }),

  interviewComplete: (candidateName: string) => ({
    subject: `Interview Complete`,
    html: `<h1>Interview done!</h1><p>Our team will review and be in touch.</p>`
  }),

  candidateAccepted: (candidateName: string, jobTitle: string) => ({
    subject: `Congratulations! 🎉 - ${jobTitle}`,
    html: `<h1>Congratulations, ${candidateName}!</h1><p>We'd like to move forward with you for ${jobTitle}.</p>`
  }),

  candidateRejected: (candidateName: string) => ({
    subject: `Application Status Update`,
    html: `<h1>Thank you, ${candidateName}</h1><p>We've decided to move forward with other candidates.</p>`
  })
};
```

**File**: `app/api/events/route.ts` (Webhook for email triggers)

```typescript
import { sendEmail, emailTemplates } from '@/lib/email';

export async function POST(req: Request) {
  const event = await req.json();

  switch (event.type) {
    case 'interview.published':
      await sendEmail(
        event.hrEmail,
        emailTemplates.interviewPublished(event.jobTitle)[0],
        emailTemplates.interviewPublished(event.jobTitle)[1],
        'interview.published'
      );
      break;

    case 'application.created':
      await sendEmail(
        event.candidateEmail,
        emailTemplates.candidateApplied(event.candidateName)[0],
        emailTemplates.candidateApplied(event.candidateName)[1],
        'application.created'
      );
      break;

    case 'slot.assigned':
      await sendEmail(
        event.candidateEmail,
        emailTemplates.slotAssigned(event.candidateName, event.slotTime)[0],
        emailTemplates.slotAssigned(event.candidateName, event.slotTime)[1],
        'slot.assigned'
      );
      break;

    case 'assessment.completed':
      await sendEmail(
        event.candidateEmail,
        emailTemplates.assessmentComplete(event.candidateName, event.score)[0],
        emailTemplates.assessmentComplete(event.candidateName, event.score)[1],
        'assessment.completed'
      );
      break;

    case 'decision.made':
      const template = event.decision === 'ACCEPT' 
        ? emailTemplates.candidateAccepted(event.candidateName, event.jobTitle)
        : emailTemplates.candidateRejected(event.candidateName);
      
      await sendEmail(
        event.candidateEmail,
        template.subject,
        template.html,
        `decision.${event.decision}`
      );
      break;
  }

  return new Response('OK');
}
```

### Hour 2-4: Recording + Proctoring Flags System

**File**: `lib/recording.ts`

```typescript
export class RecordingManager {
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  async startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    
    this.mediaRecorder = new MediaRecorder(stream);
    this.chunks = [];

    this.mediaRecorder.ondataavailable = (e) => {
      this.chunks.push(e.data);
    };

    this.mediaRecorder.start();
    return true;
  }

  stopRecording(): Blob {
    return new Promise((resolve) => {
      if (this.mediaRecorder) {
        this.mediaRecorder.onstop = () => {
          const blob = new Blob(this.chunks, { type: 'video/webm' });
          resolve(blob);
        };
        this.mediaRecorder.stop();
      }
    });
  }
}

export class ProctoringManager {
  private tabSwitchCount = 0;
  private flaggedTimes: string[] = [];

  constructor() {
    window.addEventListener('blur', () => this.onTabSwitch());
    document.addEventListener('visibilitychange', () => this.onVisibilityChange());
  }

  private onTabSwitch() {
    this.tabSwitchCount++;
    this.flaggedTimes.push(new Date().toISOString());
    console.log(`⚠️  TAB SWITCH DETECTED (${this.tabSwitchCount})`);
  }

  private onVisibilityChange() {
    if (document.hidden) {
      console.log(`⚠️  WINDOW HIDDEN`);
      this.flaggedTimes.push(new Date().toISOString());
    }
  }

  getFlags() {
    return {
      tab_switches: this.tabSwitchCount,
      flag_times: this.flaggedTimes,
      severity: this.tabSwitchCount > 5 ? 'HIGH' : this.tabSwitchCount > 2 ? 'MEDIUM' : 'LOW'
    };
  }
}
```

**File**: `app/assessment/[id]/page.tsx` (Updated with recording + proctoring)

```typescript
'use client';
import { useEffect, useState } from 'react';
import { RecordingManager, ProctoringManager } from '@/lib/recording';
import { supabase } from '@/lib/supabase';

export default function AssessmentPage({ params }: { params: { id: string } }) {
  const [recording, setRecording] = useState<RecordingManager | null>(null);
  const [proctoring, setProctoring] = useState<ProctoringManager | null>(null);
  const [recordingActive, setRecordingActive] = useState(false);

  useEffect(() => {
    // Initialize recording + proctoring
    const rec = new RecordingManager();
    const proc = new ProctoringManager();
    
    setRecording(rec);
    setProctoring(proc);

    rec.startRecording();
    setRecordingActive(true);

    return () => {
      if (recordingActive) rec.stopRecording();
    };
  }, []);

  const handleSubmit = async () => {
    if (recording) {
      const blob = await recording.stopRecording();
      
      // Upload recording to Supabase Storage
      try {
        const { data } = await supabase
          .storage
          .from('recordings')
          .upload(`assessment-${params.id}.webm`, blob);

        console.log('✅ Recording uploaded:', data);
      } catch (error) {
        console.error('❌ Recording upload failed:', error);
      }
    }

    // Save proctoring flags
    if (proctoring) {
      const flags = proctoring.getFlags();
      await supabase
        .from('proctoring_flags')
        .insert({
          assessment_attempt_id: params.id,
          tab_switches: flags.tab_switches,
          flag_times: flags.flag_times,
          severity: flags.severity
        });
    }

    // ... rest of submission logic
  };

  return (
    <div className="p-8">
      {recordingActive && (
        <div className="bg-red-100 border border-red-300 p-2 rounded mb-4 text-sm">
          🔴 Recording in progress... Keep this window focused.
        </div>
      )}
      {/* ... rest of assessment UI */}
    </div>
  );
}
```

### Hour 4-6: AI Report Generation (Mock)

**File**: `lib/ai.ts`

```typescript
interface AIReport {
  overall_score: number;
  communication: number;
  technical_depth: number;
  problem_solving: number;
  recommendation: 'STRONG_YES' | 'YES' | 'MAYBE' | 'NO' | 'STRONG_NO';
  summary: string;
  strengths: string[];
  improvements: string[];
}

export async function generateAIReport(
  candidateName: string,
  interviewResponses: Array<{ question: string; answer: string }>
): Promise<AIReport> {
  // Mock: Return realistic-sounding scores based on answer length
  const avgAnswerLength = interviewResponses.reduce((sum, r) => sum + r.answer.length, 0) / interviewResponses.length;
  
  const scoreBase = Math.min(100, Math.max(40, (avgAnswerLength / 50) * 100));
  const variance = Math.random() * 20 - 10; // ±10 variance
  
  const scores = {
    overall: Math.round(scoreBase + variance),
    communication: Math.round(scoreBase + Math.random() * 20 - 10),
    technical: Math.round(scoreBase - 5 + Math.random() * 20 - 10),
    problemSolving: Math.round(scoreBase + Math.random() * 20 - 10)
  };

  const recommendations = [
    { score: 80, rec: 'STRONG_YES' },
    { score: 70, rec: 'YES' },
    { score: 55, rec: 'MAYBE' },
    { score: 40, rec: 'NO' },
    { score: 0, rec: 'STRONG_NO' }
  ];

  const rec = recommendations.find(r => scores.overall >= r.score)?.rec || 'STRONG_NO';

  return {
    overall_score: scores.overall,
    communication: scores.communication,
    technical_depth: scores.technical,
    problem_solving: scores.problemSolving,
    recommendation: rec as any,
    summary: `${candidateName} demonstrated ${scores.overall > 70 ? 'strong' : scores.overall > 55 ? 'solid' : 'developing'} interview skills with clear communication and solid problem-solving approach.`,
    strengths: [
      'Clear articulation of ideas',
      'Structured problem-solving approach',
      'Good follow-up questions'
    ],
    improvements: [
      'Could provide more concrete examples',
      'Consider discussing edge cases',
      'More emphasis on scalability concerns'
    ]
  };
}
```

**File**: `app/api/interviews/[id]/generate-ai-report/route.ts`

```typescript
import { generateAIReport } from '@/lib/ai';
import { supabase } from '@/lib/supabase';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { applicationId } = await req.json();

  // Get interview responses
  const { data: session } = await supabase
    .from('interview_sessions')
    .select('interview_responses(*), applications(candidate_name)')
    .eq('application_id', applicationId)
    .single();

  const report = await generateAIReport(
    session.applications.candidate_name,
    session.interview_responses
  );

  // Save report
  const { data } = await supabase
    .from('ai_reports')
    .insert({
      application_id: applicationId,
      report_json: report,
      generated_at: new Date().toISOString()
    })
    .select()
    .single();

  return Response.json(data);
}
```

### Hour 6-8: Excel Export

**File**: `app/api/interviews/[id]/export/route.ts`

```typescript
import { supabase } from '@/lib/supabase';
import ExcelJS from 'exceljs';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  // Get all candidates + scores + decisions
  const { data: apps } = await supabase
    .from('applications')
    .select(`
      *,
      assessment_attempts(score, submitted_at),
      interview_sessions(score),
      ai_reports(report_json),
      hr_decisions(decision, notes)
    `)
    .eq('interview_id', params.id);

  // Create workbook
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Candidates');

  // Headers (17 fixed columns)
  const headers = [
    'Candidate Name',
    'Email',
    'Phone',
    'Job Title',
    'Application Date',
    'Assessment Score',
    'Interview Score',
    'Communication',
    'Technical Depth',
    'Problem Solving',
    'AI Recommendation',
    'Proctoring Flags',
    'Tab Switches',
    'HR Decision',
    'HR Notes',
    'Decision Date',
    'Status'
  ];

  sheet.addRow(headers);
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6E6FA' } };
  sheet.getRow(1).font = { bold: true };

  // Add data rows
  apps?.forEach(app => {
    const report = app.ai_reports[0]?.report_json;
    const flags = app.proctoring_flags?.[0];
    
    sheet.addRow([
      app.candidate_name,
      app.candidate_email,
      app.candidate_phone,
      'Senior Engineer', // From interview.job
      app.created_at?.split('T')[0],
      app.assessment_attempts[0]?.score.toFixed(1) || '-',
      app.interview_sessions[0]?.score?.toFixed(1) || '-',
      report?.communication || '-',
      report?.technical_depth || '-',
      report?.problem_solving || '-',
      report?.recommendation || '-',
      flags?.severity || 'NONE',
      flags?.tab_switches || 0,
      app.hr_decisions[0]?.decision || 'PENDING',
      app.hr_decisions[0]?.notes || '',
      app.hr_decisions[0]?.created_at?.split('T')[0] || '',
      app.status
    ]);
  });

  // Auto-fit columns
  headers.forEach((_, i) => {
    sheet.getColumn(i + 1).width = 15;
  });

  // Add filters
  sheet.autoFilter.from = 'A1';
  sheet.autoFilter.to = `Q${apps?.length ? apps.length + 1 : 2}`;

  // Return file
  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="candidates-${params.id}.xlsx"`
    }
  });
}
```

### Hour 8-10: Slot Assignment Job + Notifications

**File**: `app/api/jobs/assign-slots/route.ts`

```typescript
import { supabase } from '@/lib/supabase';
import { sendEmail, emailTemplates } from '@/lib/email';

export async function POST(req: Request) {
  // Find interviews that need slot assignment (24h before start)
  const oneDayFromNow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  const { data: interviews } = await supabase
    .from('interviews')
    .select('*, interview_slots(*)')
    .eq('status', 'PUBLISHED')
    .lte('slot_assignment_at', oneDayFromNow);

  for (const interview of interviews || []) {
    // Get unassigned applications with preferences
    const { data: apps } = await supabase
      .from('applications')
      .select('*, application_slot_preferences(*)')
      .eq('interview_id', interview.id)
      .eq('status', 'APPLIED')
      .order('created_at', { ascending: true });

    // Simple greedy assignment
    const availableSlots = interview.interview_slots.map((s: any) => ({
      id: s.id,
      capacity: s.capacity || 1,
      assigned: 0
    }));

    for (const app of apps || []) {
      const prefs = app.application_slot_preferences.sort((a: any, b: any) => a.preference_rank - b.preference_rank);
      
      for (const pref of prefs) {
        const slot = availableSlots.find(s => s.id === pref.preferred_slot_id && s.assigned < s.capacity);
        
        if (slot) {
          // Assign candidate
          await supabase
            .from('applications')
            .update({ status: 'SLOT_ASSIGNED', assigned_slot_id: slot.id })
            .eq('id', app.id);

          slot.assigned++;

          // Send email
          await sendEmail(
            app.candidate_email,
            emailTemplates.slotAssigned(app.candidate_name, 'Saturday 10:00 AM UTC').subject,
            emailTemplates.slotAssigned(app.candidate_name, 'Saturday 10:00 AM UTC').html,
            'slot.assigned'
          );

          break;
        }
      }
    }

    // Mark interview as ready
    await supabase
      .from('interviews')
      .update({ status: 'LOCKED' })
      .eq('id', interview.id);
  }

  return new Response('Slots assigned');
}
```

### Hour 10-12: HR Dashboard Enhancements + Bulk Export

**File**: `app/dashboard/hr/page.tsx` (Enhanced)

```typescript
'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function HRDashboardPage() {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [selectedInterview, setSelectedInterview] = useState<number | null>(null);

  useEffect(() => {
    const loadInterviews = async () => {
      const { data } = await supabase
        .from('interviews')
        .select('*, jobs(*), applications(*, ai_reports(*))')
        .order('created_at', { ascending: false });
      setInterviews(data || []);
    };
    loadInterviews();
  }, []);

  const handleBulkDecide = async (decision: 'ACCEPT' | 'REJECT', selectedIds: number[]) => {
    for (const appId of selectedIds) {
      await supabase
        .from('hr_decisions')
        .insert({
          application_id: appId,
          decision,
          decided_by: 1,
          decided_at: new Date().toISOString()
        });
    }
    alert(`Bulk ${decision} saved`);
  };

  const handleExport = async (interviewId: number) => {
    const res = await fetch(`/api/interviews/${interviewId}/export`);
    const buffer = await res.arrayBuffer();
    const blob = new Blob([buffer], { 
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' 
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `candidates-${interviewId}.xlsx`;
    a.click();
  };

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">HR Dashboard</h1>

      <div className="grid grid-cols-3 gap-4 mb-8">
        {interviews.map(interview => (
          <div key={interview.id} className="border p-4 rounded cursor-pointer hover:bg-gray-100"
            onClick={() => setSelectedInterview(interview.id)}>
            <h3 className="font-bold">{interview.jobs.title}</h3>
            <p className="text-sm text-gray-600">{interview.applications.length} candidates</p>
            <button 
              onClick={(e) => {
                e.stopPropagation();
                handleExport(interview.id);
              }}
              className="mt-2 bg-green-500 text-white px-3 py-1 rounded text-sm">
              📊 Export
            </button>
          </div>
        ))}
      </div>

      {selectedInterview && (
        <div className="border-t pt-8">
          <CandidateTable interviewId={selectedInterview} onBulkDecide={handleBulkDecide} />
        </div>
      )}
    </div>
  );
}

function CandidateTable({ interviewId, onBulkDecide }: any) {
  const [apps, setApps] = useState<any[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('applications')
        .select('*, assessment_attempts(*), interview_sessions(*), ai_reports(*), hr_decisions(*)')
        .eq('interview_id', interviewId);
      setApps(data || []);
    };
    load();
  }, [interviewId]);

  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">Candidates</h2>
      <table className="w-full border-collapse border">
        <thead>
          <tr className="bg-gray-100">
            <th className="border p-2"><input type="checkbox" onChange={(e) => 
              setSelected(e.target.checked ? new Set(apps.map(a => a.id)) : new Set()) } /></th>
            <th className="border p-2 text-left">Name</th>
            <th className="border p-2">Assessment</th>
            <th className="border p-2">Interview</th>
            <th className="border p-2">AI Rec</th>
            <th className="border p-2">Decision</th>
          </tr>
        </thead>
        <tbody>
          {apps.map(app => (
            <tr key={app.id} className="border">
              <td className="border p-2">
                <input type="checkbox" checked={selected.has(app.id)} onChange={(e) => {
                  const newSelected = new Set(selected);
                  if (e.target.checked) newSelected.add(app.id);
                  else newSelected.delete(app.id);
                  setSelected(newSelected);
                }} />
              </td>
              <td className="border p-2">{app.candidate_name}</td>
              <td className="border p-2 text-center">{app.assessment_attempts[0]?.score.toFixed(1)}%</td>
              <td className="border p-2 text-center">{app.interview_sessions[0]?.score?.toFixed(1) || '-'}</td>
              <td className="border p-2 text-center">{app.ai_reports[0]?.recommendation || '-'}</td>
              <td className="border p-2">{app.hr_decisions[0]?.decision || 'PENDING'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected.size > 0 && (
        <div className="mt-4 flex gap-2">
          <button 
            onClick={() => onBulkDecide('ACCEPT', Array.from(selected))}
            className="bg-green-500 text-white px-4 py-2 rounded">
            ✓ Bulk Accept ({selected.size})
          </button>
          <button 
            onClick={() => onBulkDecide('REJECT', Array.from(selected))}
            className="bg-red-500 text-white px-4 py-2 rounded">
            ✗ Bulk Reject ({selected.size})
          </button>
        </div>
      )}
    </div>
  );
}
```

**EOD Day 3: Full production-ready MVP ✓**

---

## 🧩 Additional Components Needed

**File**: `components/InterviewForm.tsx`

```typescript
'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function InterviewForm() {
  const [form, setForm] = useState({
    title: '',
    jobTitle: 'Senior Engineer',
    slotCount: 3,
    assessmentTime: 20,
    interviewTime: 40
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Create job
    const { data: job } = await supabase
      .from('jobs')
      .insert({ title: form.jobTitle, organization_id: 1 })
      .select()
      .single();

    // Create interview
    const { data: interview } = await supabase
      .from('interviews')
      .insert({
        title: form.title,
        job_id: job.id,
        organization_id: 1,
        status: 'DRAFT',
        assessment_duration_minutes: form.assessmentTime,
        interview_duration_minutes: form.interviewTime
      })
      .select()
      .single();

    // Create slots
    for (let i = 0; i < form.slotCount; i++) {
      const slotTime = new Date(Date.now() + (i + 1) * 24 * 60 * 60 * 1000);
      await supabase
        .from('interview_slots')
        .insert({
          interview_id: interview.id,
          slot_start: slotTime.toISOString(),
          slot_end: new Date(slotTime.getTime() + 60 * 60 * 1000).toISOString(),
          capacity: 5
        });
    }

    alert('Interview created! Add questions next.');
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-50 p-6 rounded mb-8 max-w-md">
      <h2 className="text-xl font-bold mb-4">Create Interview</h2>
      <input
        type="text"
        placeholder="Interview Title"
        value={form.title}
        onChange={e => setForm({ ...form, title: e.target.value })}
        className="block w-full mb-3 border p-2 rounded"
        required
      />
      <input
        type="text"
        placeholder="Job Title"
        value={form.jobTitle}
        onChange={e => setForm({ ...form, jobTitle: e.target.value })}
        className="block w-full mb-3 border p-2 rounded"
      />
      <input
        type="number"
        placeholder="Number of Slots"
        value={form.slotCount}
        onChange={e => setForm({ ...form, slotCount: parseInt(e.target.value) })}
        className="block w-full mb-3 border p-2 rounded"
      />
      <button type="submit" className="w-full bg-blue-500 text-white py-2 rounded font-bold">
        Create Interview
      </button>
    </form>
  );
}
```



```typescript
'use client';
import { useEffect, useState } from 'react';

export default function Timer({ seconds, onEnd }: { seconds: number; onEnd: () => void }) {
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => {
    const interval = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) {
          onEnd();
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [onEnd]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return <div className={`text-xl font-bold ${remaining < 60 ? 'text-red-600' : ''}`}>
    {mins}:{secs.toString().padStart(2, '0')}
  </div>;
}
```

---

## ✅ Final Checklist (EOD Day 3)

### Day 1
- [ ] `npm run dev` starts 3000 without errors
- [ ] Supabase DB running with seed data
- [ ] Mock auth working (hardcoded user)
- [ ] Interview CRUD endpoints working
- [ ] Application API accepting submissions

### Day 2
- [ ] HR dashboard displays all interviews
- [ ] HR can create interview with slots
- [ ] Candidate can apply with preferences
- [ ] Assessment MCQ timer works (20 min)
- [ ] Interview Q&A timer works (40 min)
- [ ] Recording starts/stops (mock blob)
- [ ] Proctoring captures tab switches
- [ ] HR can see all candidates
- [ ] HR can accept/reject individual candidates

### Day 3
- [ ] Email logs appear in console (SendGrid mock)
- [ ] AI report generates with realistic scores + recommendation
- [ ] Excel export downloads with 17 columns + formatting
- [ ] Slot assignment job runs (console logs only)
- [ ] Bulk accept/reject works
- [ ] Proctoring flags show in candidate details
- [ ] Full E2E workflow completes without errors
- [ ] No console errors (only info/warning logs)

---

## � What's NOT in This MVP (To Avoid Scope Creep)

### Keep Cutting These:
- Real video face detection / liveness checks
- Real Ollama/LLM API calls (all mocked)
- Admin tenancy approval workflow (org auto-approved)
- Complex timezone handling (UTC only)
- Fallback question pool randomization (use same 4 Q's)
- Recording retention schedule (manual for MVP)
- SAML/SSO auth (mock user only)
- Webhook retry logic (do-once only)
- Rate limiting
- User invitations (hardcoded test users)

---

## 📦 Install These Up Front

```bash
npm install \
  @supabase/supabase-js \
  @supabase/auth-helpers-nextjs \
  exceljs \
  nodemailer \
  uuid \
  date-fns \
  clsx tailwind-merge
```

---

## 💾 Seed Data SQLv2 (Run This Day 1 Hour 1)

```sql
-- Paste into Supabase SQL Editor

INSERT INTO organizations (name, email) VALUES ('TechCorp Inc', 'hr@techcorp.com');

INSERT INTO users (auth_id, email, role, organization_id) 
VALUES 
  ('admin-uuid-1', 'admin@vip.com', 'ADMIN', NULL),
  ('hr-uuid-1', 'hr@techcorp.com', 'HR', 1),
  ('org-admin-1', 'orgadmin@techcorp.com', 'ORG_ADMIN', 1);

INSERT INTO jobs (organization_id, title, description) 
VALUES (1, 'Senior Software Engineer', 'Full-stack engineer with 5+ years experience');

INSERT INTO interviews (
  organization_id, job_id, title, status, 
  assessment_duration_minutes, interview_duration_minutes,
  created_by
) VALUES (
  1, 1, 'SDE Round 1', 'DRAFT', 20, 40, 1
);

SELECT id FROM interviews LIMIT 1; -- Note: interview_id for next insert

INSERT INTO interview_slots (interview_id, slot_start, slot_end, capacity)
VALUES 
  (1, NOW() + INTERVAL '1 day', NOW() + INTERVAL '1 day 1 hour', 5),
  (1, NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 1 hour', 5),
  (1, NOW() + INTERVAL '3 days', NOW() + INTERVAL '3 days 1 hour', 5);

INSERT INTO assessment_question_sets (organization_id, title, questions_count)
VALUES (1, 'SDE Quiz', 10);

SELECT id FROM assessment_question_sets LIMIT 1; -- Note: qs_id

INSERT INTO assessment_questions (
  question_set_id, question_text, question_type, options, order_index
) VALUES 
  (1, 'What is React?', 'MCQ', 
   '[{"label":"A","text":"JavaScript library for UIs","is_correct":true},
     {"label":"B","text":"CSS framework","is_correct":false},
     {"label":"C","text":"Database tool","is_correct":false},
     {"label":"D","text":"Testing library","is_correct":false}]', 1),
  (1, 'What is a closure?', 'MCQ',
   '[{"label":"A","text":"A function + its scope","is_correct":true},
     {"label":"B","text":"A loop construct","is_correct":false},
     {"label":"C","text":"A CSS property","is_correct":false},
     {"label":"D","text":"An error handler","is_correct":false}]', 2);
-- Add 8 more questions...
```

---

## 🚀 Deploy Day 3 Evening (Optional, < 30 min each)

### Option A: Vercel + Cloud Supabase
```bash
npm run build
vercel deploy
```

### Option B: Docker Locally (Bonus - impress your team!)
```bash
# Create Dockerfile
cat > Dockerfile << 'EOF'
FROM node:18
WORKDIR /app
COPY . .
RUN npm install && npm run build
EXPOSE 3000
CMD ["npm", "start"]
EOF

docker build -t vip-app .
docker run -p 3000:3000 vip-app
```

---

## 🚨 Common Errors & Fixes

## 🚨 Common Errors & Fixes

| Error | Root Cause | Fix |
|-------|-----------|-----|
| `supabase: command not found` | CLI not installed | `npm install -g supabase` |
| `CORS policy error` | Client → API domain mismatch | Add `http://localhost:3000` to Supabase CORS in settings |
| `Cannot find module @supabase/supabase-js` | Dependency missing | `npm install @supabase/supabase-js` |
| `Recording fails: NotAllowedError` | Browser permissions | User must click "Allow camera" at prompt |
| `ExcelJS write failed` | Missing exceljs | `npm install exceljs` |
| `sendEmail returns error 550` | Nodemailer config | Use Ethereal or skip real SMTP in MVP |
| `Proctoring logs blank` | Event listeners not attached | Ensure ProctoringManager created in useEffect |
| `Timer keeps running after submit` | Interval not cleared | Return cleanup function from useEffect |
| `AI report NaN scores` | Division by zero | Ensure interviewResponses array not empty |
| `Table auth fails with RLS` | RLS policies too strict | Temporarily disable RLS in dev |
| `Slot assignment doesn't trigger` | Job not running | Manually hit `/api/jobs/assign-slots` POST |

---

## ⏱️ Hour-by-Hour Priority If Behind

| Scenario | Priority 1-5 | Drop These |
|----------|-------------|-----------|
| **Behind on Day 1** | Focus on auth + schema | Skip seed data automation |
| **Behind on Day 2** | Assessment + Interview pages | Skip proctoring flags, recording |
| **Behind on Day 3 (Hour 0-4)** | Email + AI report | Skip Excel export (use CSV instead) |
| **Behind on Day 3 (Hour 8-12)** | Bulk decide | Skip Excel formatting, just export CSV |
| **Last hour before EOD** | Polish existing flows | Skip new features; fix console errors |

---

## 🎯 Success Metrics

✅ **Day 1 EOD**: Supabase DB + 5 working APIs (no UI needed)
✅ **Day 2 EOD**: Complete happy-path MCQ → Interview → Decision (rough UIs OK)
✅ **Day 3 EOD**: Emails log + AI scores + Excel export + proctoring flags visible

---

**Now go build. You've got this. 💪**

Good luck! Messages me if you get stuck on a specific hour.

